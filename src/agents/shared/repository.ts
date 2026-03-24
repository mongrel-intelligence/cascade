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
	prBranch?: string;
	warmTsCache?: boolean;
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
	prBranch?: string,
): Promise<void> {
	const branch = prBranch ?? project.baseBranch ?? 'main';

	log.info('Refreshing snapshot workspace', { repoDir, branch, agentType });

	// Fetch latest refs from origin (tolerates transient network errors)
	const fetchResult = await runCommand('git', ['fetch', 'origin'], repoDir);
	if (fetchResult.exitCode !== 0) {
		log.warn('git fetch exited with non-zero code (continuing)', {
			exitCode: fetchResult.exitCode,
			stderr: fetchResult.stderr.slice(-500),
		});
	}

	// Reset to the remote tracking branch to discard any stale local changes
	const resetResult = await runCommand('git', ['reset', '--hard', `origin/${branch}`], repoDir);
	if (resetResult.exitCode !== 0) {
		log.warn('git reset --hard exited with non-zero code (continuing)', {
			exitCode: resetResult.exitCode,
			stderr: resetResult.stderr.slice(-500),
		});
	}

	// Checkout the target branch (no-op when already on the correct branch)
	const checkoutResult = await runCommand('git', ['checkout', branch], repoDir);
	if (checkoutResult.exitCode !== 0) {
		log.warn('git checkout exited with non-zero code (continuing)', {
			exitCode: checkoutResult.exitCode,
			stderr: checkoutResult.stderr.slice(-500),
		});
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
	const { project, log, agentType, prBranch, warmTsCache } = options;

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
			await refreshSnapshotWorkspace(snapshotDir, project, log, agentType, prBranch);
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

	// Checkout PR branch if provided
	if (prBranch) {
		log.info('Checking out PR branch', { prBranch });
		await runCommand('git', ['checkout', prBranch], repoDir);
	}

	// Run project-specific setup script if it exists (handles dependency installation)
	const setupScriptPath = join(repoDir, '.cascade', 'setup.sh');
	if (existsSync(setupScriptPath)) {
		log.info('Running project setup script', { path: '.cascade/setup.sh', agentType });
		const setupResult = await runCommand('bash', [setupScriptPath], repoDir, {
			AGENT_PROFILE_NAME: agentType,
		});
		log.info('Setup script completed', {
			exitCode: setupResult.exitCode,
			stdout: setupResult.stdout.slice(-500),
			stderr: setupResult.stderr.slice(-500),
		});
		if (setupResult.exitCode !== 0) {
			log.warn('Setup script exited with non-zero code', { exitCode: setupResult.exitCode });
		}
	}

	await maybeWarmTsCache(repoDir, warmTsCache, log);

	return repoDir;
}
