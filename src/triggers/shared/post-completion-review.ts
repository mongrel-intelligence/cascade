import { githubClient } from '../../github/client.js';
import {
	buildReviewDispatchKey,
	claimReviewDispatch,
} from '../../triggers/github/review-dispatch-dedup.js';
import type { AgentResult, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { extractPRNumber } from '../../utils/prUrl.js';
import { parseRepoFullName } from '../../utils/repo.js';
import type { TriggerResult } from '../types.js';

/**
 * Build a review dispatch intent after a successful implementation run, if the
 * PR's CI is green and no review has been dispatched yet.
 *
 * Best-effort: lookup, CI, and dedup errors are logged but never break the
 * implementation pipeline.
 */
export async function buildPostCompletionReviewDispatch(
	agentResult: AgentResult & { prUrl?: string },
	project: ProjectConfig,
	workItemId: string | undefined,
): Promise<TriggerResult | null> {
	if (!agentResult.success || !agentResult.prUrl || !project.repo) return null;

	try {
		const prNumber = extractPRNumber(agentResult.prUrl);
		if (!prNumber) return null;

		const { owner, repo } = parseRepoFullName(project.repo);
		const pr = await githubClient.getPR(owner, repo, prNumber);
		const headSha = pr.headSha;
		if (!headSha) return null;

		const checkStatus = await githubClient.getCheckSuiteStatus(owner, repo, headSha);
		if (!checkStatus.allPassing) {
			logger.debug('Skipping post-completion review: CI not all passing', {
				prNumber,
				workItemId,
			});
			return null;
		}

		const dedupKey = buildReviewDispatchKey(owner, repo, prNumber, headSha);
		if (!(await claimReviewDispatch(dedupKey, 'post-completion-hook', { prNumber, headSha }))) {
			logger.info('Skipping post-completion review: already dispatched', {
				prNumber,
				workItemId,
				dedupKey,
			});
			return null;
		}

		logger.info('Post-completion review dispatch: firing review for implementation PR', {
			prNumber,
			workItemId,
			headSha,
		});

		return {
			agentType: 'review',
			agentInput: {
				prNumber,
				prBranch: pr.headRef,
				repoFullName: project.repo,
				headSha,
				triggerType: 'ci-success',
				triggerEvent: 'scm:check-suite-success',
				workItemId,
			},
			prNumber,
			prUrl: agentResult.prUrl,
			prTitle: pr.title,
			workItemId,
		};
	} catch (err) {
		logger.warn('Post-completion review dispatch failed (non-fatal)', {
			prUrl: agentResult.prUrl,
			workItemId,
			error: String(err),
		});
		return null;
	}
}
