import { githubClient } from '../../github/client.js';
import { isCascadeBot } from '../../github/personas.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { parseRepoFullName } from '../../utils/repo.js';
import { requirePersonaIdentities } from '../shared/gates.js';
import { skip } from '../shared/skip.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import { isGitHubIssueCommentPayload, isGitHubPRReviewCommentPayload } from './types.js';
import { resolveWorkItemDisplayData, resolveWorkItemId } from './utils.js';

/**
 * Trigger that fires when someone @mentions the reviewer bot in a PR comment.
 * Handles both issue_comment.created (PR conversation) and pull_request_review_comment.created (inline).
 * Returns null (falls through) when there's no @mention, allowing existing triggers to handle the event.
 */
export class PRCommentMentionTrigger implements TriggerHandler {
	name = 'pr-comment-mention';
	description =
		'Triggers respond-to-pr-comment agent when someone @mentions the reviewer bot in a PR comment';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'github') return false;

		// Match issue_comment.created on PRs
		if (isGitHubIssueCommentPayload(ctx.payload)) {
			if (ctx.payload.action !== 'created') return false;
			return ctx.payload.issue.pull_request !== undefined;
		}

		// Match pull_request_review_comment.created
		if (isGitHubPRReviewCommentPayload(ctx.payload)) {
			return ctx.payload.action === 'created';
		}

		return false;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Disabled-at-config returns null so the registry's first-match loop
		// continues to the next matcher — see `src/triggers/shared/trigger-check.ts`
		// for the disabled-shadowing contract.
		if (
			!(await checkTriggerEnabled(
				ctx.project.id,
				'respond-to-pr-comment',
				'scm:pr-comment-mention',
				this.name,
			))
		) {
			return null;
		}

		// Pre-extract prNumber from whichever payload type matches so subsequent
		// skip-reasons carry PR context (operator-friendly diagnostics).
		let prNumberHint: number | undefined;
		if (isGitHubIssueCommentPayload(ctx.payload)) {
			prNumberHint = ctx.payload.issue.number;
		} else if (isGitHubPRReviewCommentPayload(ctx.payload)) {
			prNumberHint = ctx.payload.pull_request.number;
		}

		// Require persona identities for @mention detection
		const personasResult = requirePersonaIdentities(ctx.personaIdentities, prNumberHint, this.name);
		if (!personasResult.ok) return personasResult.skip;
		const personas = personasResult.value;

		// The implementer persona is who humans @mention (it writes code and responds)
		const mentionTarget = personas.implementer;

		// Extract comment body from whichever payload type matched
		let commentBody: string;
		let commentId: number;
		let commentUrl: string;
		let commentPath: string;
		let commentAuthor: string;
		let prNumber: number;
		let prBranch: string;
		let headSha: string;
		let prUrl: string;
		let prTitle: string;
		let repoFullName: string;

		if (isGitHubIssueCommentPayload(ctx.payload)) {
			const payload = ctx.payload;
			commentBody = payload.comment.body;
			commentId = payload.comment.id;
			commentUrl = payload.comment.html_url;
			commentPath = '';
			commentAuthor = payload.comment.user.login;
			prNumber = payload.issue.number;
			repoFullName = payload.repository.full_name;

			// Need to fetch PR for branch info and PR metadata
			const { owner, repo } = parseRepoFullName(repoFullName);
			const prDetails = await githubClient.getPR(owner, repo, prNumber);
			prBranch = prDetails.headRef;
			headSha = prDetails.headSha;
			prUrl = prDetails.htmlUrl;
			prTitle = prDetails.title;
		} else if (isGitHubPRReviewCommentPayload(ctx.payload)) {
			const payload = ctx.payload;
			commentBody = payload.comment.body;
			commentId = payload.comment.id;
			commentUrl = payload.comment.html_url;
			commentPath = payload.comment.path;
			commentAuthor = payload.comment.user.login;
			prNumber = payload.pull_request.number;
			prBranch = payload.pull_request.head.ref;
			headSha = payload.pull_request.head.sha;
			prUrl = payload.pull_request.html_url;
			prTitle = payload.pull_request.title;
			repoFullName = payload.repository.full_name;
		} else {
			// Defensive — matches() ensured one of the two payloads, but the
			// type narrowing exists for completeness.
			return skip(
				this.name,
				'Comment payload was neither issue_comment nor pull_request_review_comment',
			);
		}

		// Check for @mention of the implementer persona (case-insensitive)
		const mentionPattern = new RegExp(`@${mentionTarget}\\b`, 'i');
		if (!mentionPattern.test(commentBody)) {
			logger.debug('No @mention in comment, skipping', { prNumber, mentionTarget });
			return skip(
				this.name,
				`Comment on PR #${prNumber} does not @mention ${mentionTarget} — not a respond-to-pr-comment trigger`,
			);
		}

		// Skip @mentions from any known bot persona
		if (isCascadeBot(commentAuthor, personas)) {
			logger.info('Skipping @mention from cascade bot', { prNumber, commentAuthor });
			return skip(
				this.name,
				`@mention on PR #${prNumber} is from cascade bot ${commentAuthor} (loop prevention)`,
			);
		}

		// Resolve work item from DB
		const workItemId = await resolveWorkItemId(ctx.project.id, prNumber);
		const { workItemUrl, workItemTitle } = await resolveWorkItemDisplayData(workItemId);

		logger.info('PR comment @mention detected, triggering respond-to-pr-comment agent', {
			prNumber,
			commentAuthor,
			mentionTarget,
			workItemId,
		});

		return {
			agentType: 'respond-to-pr-comment',
			agentInput: {
				prNumber,
				prBranch,
				repoFullName,
				headSha,
				triggerEvent: 'scm:pr-comment-mention',
				triggerCommentId: commentId,
				triggerCommentBody: commentBody,
				triggerCommentPath: commentPath,
				triggerCommentUrl: commentUrl,
				commentAuthor,
				workItemId,
			},
			prNumber,
			prUrl,
			prTitle,
			workItemId,
			workItemUrl,
			workItemTitle,
		};
	}
}
