import { githubClient } from '../../github/client.js';
import { trelloClient } from '../../trello/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { type GitHubPullRequestPayload, isGitHubPullRequestPayload } from './types.js';
import { extractTrelloCardId, hasTrelloCardUrl } from './utils.js';

export class PRMergedTrigger implements TriggerHandler {
	name = 'pr-merged';
	description = 'Moves Trello card to MERGED list when PR is merged';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'github') return false;
		if (!isGitHubPullRequestPayload(ctx.payload)) return false;
		return ctx.payload.action === 'closed';
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const payload = ctx.payload as GitHubPullRequestPayload;
		const [owner, repo] = payload.repository.full_name.split('/');
		const prNumber = payload.pull_request.number;

		// Fetch full PR details to check merged status
		const prDetails = await githubClient.getPR(owner, repo, prNumber);

		if (!prDetails.merged) {
			logger.info('PR closed but not merged, skipping', { prNumber });
			return null;
		}

		// Check for Trello card URL
		const prBody = payload.pull_request.body || '';
		if (!hasTrelloCardUrl(prBody)) {
			logger.info('Merged PR has no Trello card URL', { prNumber });
			return null;
		}

		const cardId = extractTrelloCardId(prBody);
		if (!cardId) return null;

		const mergedListId = ctx.project.trello?.lists?.merged;

		if (!mergedListId) {
			logger.warn('No merged list configured for project', {
				projectId: ctx.project.id,
			});
			return null;
		}

		// Move card to MERGED list
		await trelloClient.moveCardToList(cardId, mergedListId);
		await trelloClient.addComment(
			cardId,
			`PR #${prNumber} has been merged to ${prDetails.baseRef}`,
		);

		logger.info('Moved card to merged list', { cardId, prNumber });

		return {
			agentType: '', // No agent needed
			agentInput: {},
			cardId,
			prNumber,
		};
	}
}
