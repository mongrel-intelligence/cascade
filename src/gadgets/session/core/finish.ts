import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { githubClient } from '../../../github/client.js';
import type { SessionHooks } from '../../sessionState.js';

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

export function writePushedChangesSidecar(sidecarPath: string | undefined): boolean {
	if (!sidecarPath || sidecarPath === 'undefined') return false;

	const branch = getCurrentBranch();
	const headSha = getCurrentHeadSha();
	if (!branch || !headSha) return false;

	try {
		writeFileSync(
			sidecarPath,
			JSON.stringify({
				source: 'cascade-tools session finish',
				branch,
				headSha,
			}),
		);
		return true;
	} catch {
		return false;
	}
}

export function hasUnpushedCommits(): boolean {
	try {
		const result = execSync('git rev-list @{upstream}..HEAD --count 2>/dev/null', {
			encoding: 'utf-8',
		});
		return Number.parseInt(result.trim(), 10) > 0;
	} catch {
		try {
			const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
			const result = execSync(`git rev-list origin/${branch}..HEAD --count 2>/dev/null`, {
				encoding: 'utf-8',
			});
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
}

export interface FinishValidationError {
	valid: false;
	error: string;
}

export interface FinishValidationSuccess {
	valid: true;
}

export type FinishValidationResult = FinishValidationError | FinishValidationSuccess;

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
		if (hasUncommittedChanges()) {
			return {
				valid: false,
				error:
					'Cannot finish session with uncommitted changes. You must commit your changes (git add && git commit) before calling Finish.',
			};
		}
		if (hasUnpushedCommits()) {
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
	}

	return { valid: true };
}
