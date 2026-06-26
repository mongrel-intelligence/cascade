import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { ProjectConfig } from '../../types/index.js';
import { cloneRepo, createTempDir, getWorkspaceDir, runCommand } from '../../utils/repo.js';
import type { AgentLogger } from '../utils/logging.js';
import { warmTypeScriptCache } from '../utils/setup.js';

export interface SetupRepositoryOptions {
	project: ProjectConfig;
	log: AgentLogger;
	agentType: string;
	/** PR number — when provided, drives `refs/pull/N/head` checkout instead of branch-name checkout. */
	prNumber?: number;
	/** Expected HEAD SHA — when provided, post-checkout verification compares `git rev-parse HEAD` against this. */
	prHeadSha?: string;
	/**
	 * @deprecated Retained for human-readable logging only. PR checkout uses `prNumber` via the canonical
	 * `refs/pull/N/head` ref. Branch names from forks are not on `origin` and cannot be checked out by name.
	 */
	prBranch?: string;
	warmTsCache?: boolean;
}

/**
 * Fetch a PR via its canonical pull-request ref and check out the resulting commit
 * on a detached HEAD. This works for PRs from same-repo branches AND from external
 * forks — the fork's branch name is irrelevant because GitHub mirrors every PR head
 * onto the base repo at `refs/pull/N/head`.
 *
 * Fail-loud: any non-zero git exit code throws. When `prHeadSha` is provided, the
 * post-checkout HEAD is verified to match.
 *
 * Provider-aware signature: GitHub is implemented today. GitLab support is deferred
 * until PR #1092 lands — the parameter is in the signature so the extension is a
 * one-line follow-up.
 */
export async function fetchAndCheckoutPR(
	repoDir: string,
	prNumber: number,
	prHeadSha: string | undefined,
	scmProvider: 'github' | 'gitlab' | undefined,
	log: AgentLogger,
): Promise<void> {
	const provider = scmProvider ?? 'github';
	if (provider !== 'github') {
		throw new Error(
			'fetchAndCheckoutPR: only GitHub is currently supported; GitLab support follows PR #1092 merge',
		);
	}

	const ref = `refs/pull/${prNumber}/head`;
	const refspec = `+${ref}:refs/remotes/pr/${prNumber}`;
	log.info('Fetching PR ref', { prNumber, ref });

	const fetchResult = await runCommand('git', ['fetch', 'origin', refspec], repoDir);
	if (fetchResult.exitCode !== 0) {
		throw new Error(
			`git fetch PR ref failed (exit ${fetchResult.exitCode}): ${fetchResult.stderr.slice(-500)}`,
		);
	}

	const checkoutResult = await runCommand(
		'git',
		['checkout', '--detach', `pr/${prNumber}`],
		repoDir,
	);
	if (checkoutResult.exitCode !== 0) {
		throw new Error(
			`git checkout PR failed (exit ${checkoutResult.exitCode}): ${checkoutResult.stderr.slice(-500)}`,
		);
	}

	if (prHeadSha) {
		const revParseResult = await runCommand('git', ['rev-parse', 'HEAD'], repoDir);
		const actualSha = revParseResult.stdout.trim();
		if (actualSha !== prHeadSha) {
			throw new Error(
				`HEAD SHA mismatch after PR checkout: expected ${prHeadSha}, got ${actualSha}`,
			);
		}
	}

	log.info('PR checked out', {
		prNumber,
		ref,
		headSha: prHeadSha ?? '(unverified)',
	});
}

/**
 * Resolve the path to the existing workspace directory for a snapshot-reuse run.
 *
 * Snapshot images bake the workspace into `/workspace/cascade-<projectId>-*`.
 * We locate the first matching directory rather than creating a new one so the
 * snapshot-resident installation artifacts are used as-is.
 *
 * Returns `null` when no baked-in workspace directory can be found.
 */
export function findSnapshotWorkspaceDir(projectId: string): string | null {
	const workspaceBase = getWorkspaceDir();
	const prefix = `cascade-${projectId}-`;
	try {
		const entries = readdirSync(workspaceBase);
		const match = entries.find((e) => {
			if (!e.startsWith(prefix)) return false;
			const suffix = e.slice(prefix.length);
			return /^\d+$/.test(suffix);
		});
		return match ? `${workspaceBase}/${match}` : null;
	} catch {
		return null;
	}
}

/**
 * Refresh an existing snapshot workspace via git fetch + reset + optional branch checkout.
 *
 * This is the "warm-start" path: the Docker image already contains the cloned repo,
 * installed dependencies, and any setup artifacts from the previous run.  We only
 * need to bring the working tree up to date with the remote.
 */
async function refreshSnapshotWorkspace(
	repoDir: string,
	project: ProjectConfig,
	log: AgentLogger,
	agentType: string,
	prNumber?: number,
	prHeadSha?: string,
): Promise<void> {
	// PR-driven runs use the canonical refs/pull/N/head ref (works for forks).
	if (prNumber) {
		log.info('Refreshing snapshot workspace for PR', { repoDir, prNumber, agentType });
		await fetchAndCheckoutPR(repoDir, prNumber, prHeadSha, undefined, log);
		return;
	}

	// Non-PR runs: fetch + reset + checkout the project's base branch. Fail-loud.
	const branch = project.baseBranch ?? 'main';
	log.info('Refreshing snapshot workspace', { repoDir, branch, agentType });

	const fetchResult = await runCommand('git', ['fetch', 'origin'], repoDir);
	if (fetchResult.exitCode !== 0) {
		throw new Error(
			`git fetch failed (exit ${fetchResult.exitCode}): ${fetchResult.stderr.slice(-500)}`,
		);
	}

	const resetResult = await runCommand('git', ['reset', '--hard', `origin/${branch}`], repoDir);
	if (resetResult.exitCode !== 0) {
		throw new Error(
			`git reset --hard origin/${branch} failed (exit ${resetResult.exitCode}): ${resetResult.stderr.slice(-500)}`,
		);
	}

	const checkoutResult = await runCommand('git', ['checkout', branch], repoDir);
	if (checkoutResult.exitCode !== 0) {
		throw new Error(
			`git checkout ${branch} failed (exit ${checkoutResult.exitCode}): ${checkoutResult.stderr.slice(-500)}`,
		);
	}

	log.info('Snapshot workspace refreshed', { repoDir, branch });
}

/**
 * Warm the TypeScript compiler cache for a repo directory, logging the result.
 * Extracted to keep setupRepository within the cognitive-complexity limit.
 */
async function maybeWarmTsCache(
	repoDir: string,
	warmTsCache: boolean | undefined,
	log: AgentLogger,
): Promise<void> {
	if (!warmTsCache) return;
	log.info('Warming TypeScript cache', { repoDir });
	const tscResult = await warmTypeScriptCache(repoDir);
	if (tscResult) {
		log.info('TypeScript cache warmed', {
			durationMs: tscResult.durationMs,
			hadErrors: !!tscResult.error,
		});
	}
}

export async function setupRepository(options: SetupRepositoryOptions): Promise<string> {
	const { project, log, agentType, prNumber, prHeadSha, prBranch, warmTsCache } = options;

	// ── Snapshot-reuse path ────────────────────────────────────────────────────
	// When CASCADE_SNAPSHOT_REUSE=true the container image already contains the
	// repo, dependencies, and prior setup work.  Locate the baked-in workspace
	// and refresh it with fetch/reset semantics instead of cloning from scratch.
	if (process.env.CASCADE_SNAPSHOT_REUSE === 'true' && project.repo) {
		const snapshotDir = findSnapshotWorkspaceDir(project.id);
		if (snapshotDir) {
			log.info('Snapshot reuse detected — skipping clone', {
				projectId: project.id,
				agentType,
				snapshotDir,
			});
			await refreshSnapshotWorkspace(snapshotDir, project, log, agentType, prNumber, prHeadSha);
			await maybeWarmTsCache(snapshotDir, warmTsCache, log);
			return snapshotDir;
		}

		// Snapshot directory not found — fall through to cold-start clone
		log.warn('Snapshot reuse requested but no workspace directory found — falling back to clone', {
			projectId: project.id,
			agentType,
		});
	}

	// ── Cold-start path (clone) ────────────────────────────────────────────────

	// Create temp directory for all agents
	const repoDir = createTempDir(project.id);

	// Skip cloning if no repo is configured
	if (!project.repo) {
		log.info('No repo configured, skipping clone', { projectId: project.id, agentType });
		return repoDir;
	}

	// Clone repo to temp directory
	await cloneRepo(project, repoDir);

	// Checkout PR via canonical refs/pull/N/head ref (works for forks too)
	if (prNumber) {
		// scmProvider parameter reserved for future GitLab support (PR #1092 follow-up)
		await fetchAndCheckoutPR(repoDir, prNumber, prHeadSha, undefined, log);
	} else if (prBranch) {
		// prBranch without prNumber is a no-op now; log for visibility so misconfigured
		// callers can be diagnosed (the field is deprecated for checkout — pass prNumber).
		log.info('prBranch provided without prNumber — skipping branch-name checkout', { prBranch });
	}

	// Run project-specific setup script if it exists (handles dependency installation)
	const setupScriptPath = join(repoDir, '.cascade', 'setup.sh');
	if (existsSync(setupScriptPath)) {
		log.info('Running project setup script', { path: '.cascade/setup.sh', agentType });
		// The idle timeout stays disabled unconditionally: setup.sh may compile language
		// runtimes (e.g. Ruby via asdf/ruby-build) whose make output is suppressed, and may
		// run large npm ci installs that take 10-15+ min with no stdout. The wall timeout is
		// per-project configurable via `project.setupTimeoutMs`: unset or 0 disables it (the
		// global worker/watchdog container timeout is the safety net for truly hung setups),
		// while a positive value re-introduces a per-project wall bound. `runCommand` treats
		// `wallTimeoutMs <= 0` as disabled (see createSubprocessWatcher in src/utils/repo.ts).
		const setupWallTimeoutMs = project.setupTimeoutMs ?? 0;
		const setupResult = await runCommand(
			'bash',
			[setupScriptPath],
			repoDir,
			{ AGENT_PROFILE_NAME: agentType },
			{ idleTimeoutMs: 0, wallTimeoutMs: setupWallTimeoutMs },
		);
		log.info('Setup script completed', {
			exitCode: setupResult.exitCode,
			reason: setupResult.reason,
			stdout: setupResult.stdout.slice(-500),
			stderr: setupResult.stderr.slice(-500),
		});
		if (setupResult.exitCode !== 0) {
			log.warn('Setup script exited with non-zero code', {
				exitCode: setupResult.exitCode,
				reason: setupResult.reason,
			});
		}
	}

	await maybeWarmTsCache(repoDir, warmTsCache, log);

	return repoDir;
}
