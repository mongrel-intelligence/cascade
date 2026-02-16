import type { AgentResult } from '../types/index.js';
import { createPRAgentGadgets } from './shared/gadgets.js';
import { type GitHubAgentDefinition, executeGitHubAgent } from './shared/githubAgent.js';
import {
	type PRResponseAgentInput,
	type PRResponseContextData,
	buildPRResponseContext,
	buildPRResponsePrompt,
	injectPRResponseSyntheticCalls,
	postInitialPRResponseComment,
} from './shared/prResponseAgent.js';
import { injectSyntheticCall } from './shared/syntheticCalls.js';

const respondToPRCommentDefinition: GitHubAgentDefinition<
	PRResponseAgentInput,
	PRResponseContextData
> = {
	agentType: 'respond-to-pr-comment',
	headerMessage: '🤖 Working on your request...',
	initialCommentDescription: 'Acknowledge PR comment request',
	timeoutMessage: '⚠️ PR comment agent timed out while working on the request.',
	loggerPrefix: 'pr-comment',

	getGadgets: () => createPRAgentGadgets({ includeReviewComments: true }),

	postInitialComment: postInitialPRResponseComment,

	buildContext: ({ owner, repo }, input, repoDir, log) =>
		buildPRResponseContext(
			owner,
			repo,
			input.prNumber,
			input.prBranch,
			repoDir,
			input.project,
			input.config,
			log,
			'respond-to-pr-comment',
			(prBranch, prNumber, o, r) =>
				buildPRResponsePrompt(
					prBranch,
					prNumber,
					o,
					r,
					'A user @mentioned you in a PR comment. Read their request and execute it.',
					'GetPRComments, ReplyToReviewComment, PostPRComment, UpdatePRComment',
				),
			input.modelOverride,
		),

	async injectSyntheticCalls(params) {
		return injectPRResponseSyntheticCalls(params, {
			preSyntheticCalls: (builder, trackingContext, input) =>
				injectSyntheticCall(
					builder,
					trackingContext,
					'TriggeringComment',
					{
						comment:
							'The @mention comment that triggered this agent — this is your primary instruction',
						commentId: input.triggerCommentId,
						url: input.triggerCommentUrl,
						path: input.triggerCommentPath || '(general PR comment)',
					},
					input.triggerCommentBody,
					'gc_triggering_comment',
				),
			commentDescriptions: {
				prComments: 'Pre-fetching line-specific review comments for context',
				prReviews: 'Pre-fetching review submissions for context',
				prIssueComments: 'Pre-fetching general PR comments for context',
			},
		});
	},
};

export async function executeRespondToPRCommentAgent(
	input: PRResponseAgentInput,
): Promise<AgentResult> {
	return executeGitHubAgent(respondToPRCommentDefinition, input);
}
