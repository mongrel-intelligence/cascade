import { githubClient } from '../../github/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { type GitHubCheckSuitePayload, isGitHubCheckSuitePayload } from './types.js';
import { extractTrelloCardId, hasTrelloCardUrl } from './utils.js';

export class CheckSuiteFailureTrigger implements TriggerHandler {
	name = 'check-suite-failure';
	description = 'Triggers review agent when check suite fails on a PR with Trello card';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'github') return false;
		if (!isGitHubCheckSuitePayload(ctx.payload)) return false;

		const payload = ctx.payload;

		// Only trigger on completed check suites with failure conclusion
		if (payload.action !== 'completed') return false;
		if (payload.check_suite.conclusion !== 'failure') return false;

		// Must have at least one associated PR
		if (payload.check_suite.pull_requests.length === 0) return false;

		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const payload = ctx.payload as GitHubCheckSuitePayload;
		const [owner, repo] = payload.repository.full_name.split('/');

		// Get the first associated PR (usually there's only one)
		const prRef = payload.check_suite.pull_requests[0];
		const prNumber = prRef.number;

		// Fetch PR to check for Trello card URL
		const prDetails = await githubClient.getPR(owner, repo, prNumber);

		if (!hasTrelloCardUrl(prDetails.body)) {
			logger.info('PR does not have Trello card URL, skipping check failure trigger', {
				prNumber,
			});
			return null;
		}

		const cardId = extractTrelloCardId(prDetails.body);

		logger.info('Check suite failure on PR with Trello card', {
			prNumber,
			cardId,
			conclusion: payload.check_suite.conclusion,
		});

		return {
			agentType: 'review',
			agentInput: {
				prNumber,
				prBranch: prRef.head.ref,
				repoFullName: payload.repository.full_name,
				triggerType: 'check-failure',
			},
			prNumber,
			cardId: cardId || undefined,
		};
	}
}
