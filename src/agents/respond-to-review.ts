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

const respondToReviewDefinition: GitHubAgentDefinition<
	PRResponseAgentInput,
	PRResponseContextData
> = {
	agentType: 'respond-to-review',
	initialCommentDescription: 'Acknowledge review feedback',
	timeoutMessage: '⚠️ Review agent timed out while addressing feedback.',
	loggerPrefix: 'review',

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
			'respond-to-review',
			(prBranch, prNumber, o, r) =>
				buildPRResponsePrompt(
					prBranch,
					prNumber,
					o,
					r,
					'Address the review comments and push your changes.',
					'GetPRComments, ReplyToReviewComment',
				),
			input.modelOverride,
		),

	async injectSyntheticCalls(params) {
		return injectPRResponseSyntheticCalls(params);
	},
};

export async function executeRespondToReviewAgent(
	input: PRResponseAgentInput,
): Promise<AgentResult> {
	return executeGitHubAgent(respondToReviewDefinition, input);
}
