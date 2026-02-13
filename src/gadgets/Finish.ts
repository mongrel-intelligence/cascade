import { execSync } from 'node:child_process';
import { Gadget, TaskCompletionSignal, z } from 'llmist';
import { githubClient } from '../github/client.js';
import { getSessionState } from './sessionState.js';

function hasUncommittedChanges(): boolean {
	try {
		const status = execSync('git status --porcelain', { encoding: 'utf-8' });
		return status.trim().length > 0;
	} catch {
		return true; // Assume uncommitted if check fails
	}
}

async function findPRForCurrentBranch(): Promise<string | null> {
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

function hasUnpushedCommits(): boolean {
	try {
		// Check if local branch is ahead of remote
		const result = execSync('git rev-list @{upstream}..HEAD --count 2>/dev/null', {
			encoding: 'utf-8',
		});
		return Number.parseInt(result.trim(), 10) > 0;
	} catch {
		// If no upstream or error, check if there are any local commits not on remote
		try {
			const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
			const result = execSync(`git rev-list origin/${branch}..HEAD --count 2>/dev/null`, {
				encoding: 'utf-8',
			});
			return Number.parseInt(result.trim(), 10) > 0;
		} catch {
			return true; // Assume unpushed if check fails
		}
	}
}

export class Finish extends Gadget({
	name: 'Finish',
	description:
		'Call this gadget when you have completed all tasks and want to end the session. This should be your final gadget call.',
	schema: z.object({
		comment: z.string().min(1).describe('A brief summary of what was accomplished'),
	}),
	examples: [
		{
			params: { comment: 'Created PR with all requested changes and tests passing' },
			output: 'Session ended: Created PR with all requested changes and tests passing',
			comment: 'End session after completing all work',
		},
	],
}) {
	override async execute(params: this['params']): Promise<never> {
		const state = getSessionState();

		// For implementation agent, require PR creation (with fallback check for ad-hoc PRs)
		if (state.agentType === 'implementation' && !state.prCreated) {
			const prUrl = await findPRForCurrentBranch();
			if (!prUrl) {
				throw new Error(
					'Cannot finish implementation session without creating a PR. ' +
						'You must call CreatePR to submit your changes before calling Finish.',
				);
			}
			// PR exists but wasn't created via CreatePR gadget — allow finishing
		}

		// For review agent, require review submission
		if (state.agentType === 'review' && !state.reviewSubmitted) {
			throw new Error(
				'Cannot finish review session without submitting a review. ' +
					'You must call CreatePRReview to submit your review before calling Finish.',
			);
		}

		// For respond-to-review and respond-to-ci agents, require clean git state and pushed changes
		if (state.agentType === 'respond-to-review' || state.agentType === 'respond-to-ci') {
			if (hasUncommittedChanges()) {
				throw new Error(
					`Cannot finish ${state.agentType} session with uncommitted changes. You must commit your changes (git add && git commit) before calling Finish.`,
				);
			}
			if (hasUnpushedCommits()) {
				throw new Error(
					`Cannot finish ${state.agentType} session without pushing changes. You must push your commits (git push) before calling Finish.`,
				);
			}
		}

		throw new TaskCompletionSignal(params.comment);
	}
}
