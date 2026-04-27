import { execFileSync, execSync } from 'node:child_process';
import { githubClient } from '../../../github/client.js';
import { logger } from '../../../utils/logging.js';
import type { SessionHooks } from '../../sessionState.js';

export { writePushedChangesSidecar } from './sidecar.js';

// Drop stderr without going through a shell — the execFileSync equivalent of `2>/dev/null`.
// Captures stdout so the return value is still the command's output buffer.
const SUPPRESS_STDERR_OPTS = {
	encoding: 'utf-8' as const,
	stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'],
};

export function hasUncommittedChanges(): boolean {
	try {
		const status = execSync('git status --porcelain', { encoding: 'utf-8' });
		return status.trim().length > 0;
	} catch {
		return true;
	}
}

export async function findPRForCurrentBranch(): Promise<string | null> {
	try {
		const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
		const remote = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
		const match = remote.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
		if (!match) return null;
		const [, owner, repo] = match;
		const pr = await githubClient.getOpenPRByBranch(owner, repo, branch);
		return pr?.htmlUrl ?? null;
	} catch {
		return null;
	}
}

export function hasNewCommits(initialSha: string): boolean {
	try {
		const currentSha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
		return currentSha !== initialSha;
	} catch {
		// If git fails here, preceding checks (uncommitted/unpushed) would have
		// already caught real issues. Fail-open: assume work was done.
		return true;
	}
}

export function getCurrentBranch(): string | null {
	try {
		return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
	} catch {
		return null;
	}
}

export function getCurrentHeadSha(): string | null {
	try {
		return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
	} catch {
		return null;
	}
}

export function hasUnpushedCommits(prBranch?: string): boolean {
	// PR-checkout path: workers check out PRs in detached HEAD via `refs/pull/N/head`,
	// where `git rev-parse --abbrev-ref HEAD` returns the literal string "HEAD" and
	// `@{upstream}` is unset. The legacy fallback would compute
	// `git rev-list origin/HEAD..HEAD --count` (commits not on the default branch),
	// which falsely reports unpushed commits even when the PR branch is fully pushed.
	// When the caller knows the PR branch (passed in via SessionState), compare local
	// HEAD to the remote branch tip directly via ls-remote — robust to detached HEAD.
	//
	// Security: prBranch flows from `payload.pull_request.head.ref` (GitHub-controlled).
	// Git's ref-format rules permit `;`, `$`, `&`, `|`, `(`, `)`, backticks, etc., so
	// the branch name MUST NOT be shell-interpolated. We use execFileSync so the branch
	// is passed as a single argv element — no /bin/sh, no metacharacter expansion.
	if (prBranch) {
		try {
			const localHead = execFileSync('git', ['rev-parse', 'HEAD'], {
				encoding: 'utf-8',
			}).trim();
			let lsRemote: string;
			try {
				lsRemote = execFileSync(
					'git',
					['ls-remote', 'origin', `refs/heads/${prBranch}`],
					SUPPRESS_STDERR_OPTS,
				).trim();
			} catch (err) {
				// Fail-closed: ls-remote can fail for network, auth, or repo-config reasons.
				// Without this log line the agent gets a generic "you didn't push" error and
				// the operator can't tell network issues from real unpushed work — exactly
				// what made the ucho PR #84 incident take 22 min to diagnose.
				logger.warn('hasUnpushedCommits: ls-remote failed, treating as unpushed', {
					prBranch,
					error: String(err),
				});
				return true;
			}
			if (!lsRemote) return true;
			const remoteSha = lsRemote.split(/\s+/)[0];
			return localHead !== remoteSha;
		} catch (err) {
			logger.warn('hasUnpushedCommits: rev-parse HEAD failed, treating as unpushed', {
				prBranch,
				error: String(err),
			});
			return true;
		}
	}

	try {
		const result = execSync('git rev-list @{upstream}..HEAD --count 2>/dev/null', {
			encoding: 'utf-8',
		});
		return Number.parseInt(result.trim(), 10) > 0;
	} catch {
		try {
			// Defense in depth: even though `branch` here comes from a local-state-only
			// source (`git rev-parse --abbrev-ref HEAD`), keep the shape uniform — every
			// interpolated git command goes through execFileSync, never the shell.
			const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
				encoding: 'utf-8',
			}).trim();
			const result = execFileSync(
				'git',
				['rev-list', `origin/${branch}..HEAD`, '--count'],
				SUPPRESS_STDERR_OPTS,
			);
			return Number.parseInt(result.trim(), 10) > 0;
		} catch {
			return true;
		}
	}
}

export interface SessionState {
	agentType: string | null;
	prCreated: boolean;
	reviewSubmitted: boolean;
	hooks: SessionHooks;
	initialHeadSha?: string | null;
	/**
	 * The PR HEAD branch name (e.g. `feature/x`). When present, `hasUnpushedCommits`
	 * uses `git ls-remote` to compare local HEAD to the remote branch tip directly,
	 * sidestepping the detached-HEAD trap that breaks `@{upstream}` and
	 * `rev-parse --abbrev-ref HEAD` in PR checkouts (`refs/pull/N/head`).
	 */
	prBranch?: string | null;
}

export interface FinishValidationError {
	valid: false;
	error: string;
}

export interface FinishValidationSuccess {
	valid: true;
}

export type FinishValidationResult = FinishValidationError | FinishValidationSuccess;

function checkPushedChangesHook(state: SessionState): FinishValidationError | null {
	if (hasUncommittedChanges()) {
		return {
			valid: false,
			error:
				'Cannot finish session with uncommitted changes. You must commit your changes (git add && git commit) before calling Finish.',
		};
	}
	if (hasUnpushedCommits(state.prBranch ?? undefined)) {
		return {
			valid: false,
			error:
				'Cannot finish session without pushing changes. You must push your commits (git push) before calling Finish.',
		};
	}
	if (state.initialHeadSha && !hasNewCommits(state.initialHeadSha)) {
		return {
			valid: false,
			error:
				'Cannot finish session without making any changes. You must commit and push at least one change before calling Finish.',
		};
	}
	return null;
}

export async function validateFinish(state: SessionState): Promise<FinishValidationResult> {
	const hooks = state.hooks ?? {};

	if (hooks.requiresPR && !state.prCreated) {
		const prUrl = await findPRForCurrentBranch();
		if (!prUrl) {
			return {
				valid: false,
				error:
					'Cannot finish session without creating a PR. ' +
					'You must call CreatePR to submit your changes before calling Finish.',
			};
		}
	}

	if (hooks.requiresReview && !state.reviewSubmitted) {
		return {
			valid: false,
			error:
				'Cannot finish session without submitting a review. ' +
				'You must call CreatePRReview to submit your review before calling Finish.',
		};
	}

	if (hooks.requiresPushedChanges) {
		const pushedChangesError = checkPushedChangesHook(state);
		if (pushedChangesError) return pushedChangesError;
	}

	return { valid: true };
}
