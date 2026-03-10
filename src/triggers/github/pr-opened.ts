import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { checkTriggerEnabledWithParams } from '../shared/trigger-check.js';
import { isGitHubPullRequestPayload } from './types.js';
import { evaluateAuthorMode, resolveWorkItemId } from './utils.js';

/**
 * Trigger that fires the review agent when a new PR is opened.
 * Resolves work item from DB (with PR body fallback); fires even without a linked work item.
 */
export class PROpenedTrigger implements TriggerHandler {
	name = 'pr-opened';
	description = 'Triggers review agent when a new PR is opened';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'github') return false;
		if (!isGitHubPullRequestPayload(ctx.payload)) return false;

		// Only trigger on newly opened PRs
		if (ctx.payload.action !== 'opened') return false;

		// Skip draft PRs - wait until they're ready for review
		if (ctx.payload.pull_request.draft) return false;

		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Check trigger config + get parameters in a single DB call
		const triggerConfig = await checkTriggerEnabledWithParams(
			ctx.project.id,
			'review',
			'scm:pr-opened',
			this.name,
		);
		if (!triggerConfig.enabled) {
			return null;
		}

		const payload = ctx.payload as {
			pull_request: {
				number: number;
				title: string;
				body: string | null;
				html_url: string;
				head: { ref: string; sha: string };
				user: { login: string };
			};
			repository: { full_name: string };
		};

		const prNumber = payload.pull_request.number;
		const prAuthor = payload.pull_request.user.login;

		// Gate on PR author based on configured authorMode parameter
		const authorResult = evaluateAuthorMode(
			prAuthor,
			ctx.personaIdentities,
			triggerConfig.parameters,
			this.name,
		);
		if (!authorResult) {
			return null;
		}
		if (!authorResult.shouldTrigger) {
			logger.info('PR author does not match configured authorMode, skipping', {
				handler: this.name,
				prNumber,
				prAuthor,
				isImplementerPR: authorResult.isImplementerPR,
				authorMode: authorResult.authorMode,
			});
			return null;
		}

		const prBody = payload.pull_request.body || '';

		// Resolve work item from DB (with PR body fallback)
		const workItemId = await resolveWorkItemId(ctx.project.id, prNumber, prBody, ctx.project);

		logger.info('New PR opened, triggering review agent', {
			prNumber,
			prTitle: payload.pull_request.title,
			workItemId,
		});

		return {
			agentType: 'review',
			agentInput: {
				prNumber,
				prBranch: payload.pull_request.head.ref,
				repoFullName: payload.repository.full_name,
				headSha: payload.pull_request.head.sha,
				triggerType: 'pr-opened',
				triggerEvent: 'scm:pr-opened',
				cardId: workItemId,
			},
			prNumber,
			workItemId,
		};
	}
}
