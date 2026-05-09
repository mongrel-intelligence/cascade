import type { CreatedPR } from '../../github/client.js';
import { logger } from '../../utils/logging.js';
import { parsePrNumberFromRef } from './utils.js';

export interface CheckSuitePullRequestRef {
	number: number;
}

export type CheckSuitePRResolution =
	| { ok: true; prNumber: number }
	| { ok: false; reason: 'unresolved' };

export interface ResolveCheckSuitePROptions {
	owner: string;
	repo: string;
	pullRequests: CheckSuitePullRequestRef[];
	headBranch: string | null | undefined;
	handlerName: string;
	lookupOpenPRByBranch: (owner: string, repo: string, branch: string) => Promise<CreatedPR | null>;
}

/**
 * Resolve a PR number from a check_suite payload.
 *
 * Resolution order intentionally mirrors the historical handler behavior:
 * direct `pull_requests[]`, then GitHub's `refs/pull/{N}/head` virtual ref,
 * then an open-PR lookup by plain branch name for suites that omit PR links.
 */
export async function resolveCheckSuitePRNumber(
	options: ResolveCheckSuitePROptions,
): Promise<CheckSuitePRResolution> {
	const { owner, repo, pullRequests, headBranch, handlerName, lookupOpenPRByBranch } = options;

	if (pullRequests.length > 0) {
		return { ok: true, prNumber: pullRequests[0].number };
	}

	const parsed = parsePrNumberFromRef(headBranch);
	if (parsed !== null) {
		return { ok: true, prNumber: parsed };
	}

	if (!headBranch) {
		logger.info('No pull_requests and no head_branch in payload, skipping', {
			handler: handlerName,
		});
		return { ok: false, reason: 'unresolved' };
	}

	const pr = await lookupOpenPRByBranch(owner, repo, headBranch);
	if (!pr) {
		logger.info('No open PR found for head branch, skipping', { handler: handlerName, headBranch });
		return { ok: false, reason: 'unresolved' };
	}
	return { ok: true, prNumber: pr.number };
}
