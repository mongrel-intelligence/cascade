import { githubClient } from '../github/client.js';
import type { AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { createPRAgentGadgets } from './shared/gadgets.js';
import {
	type GitHubAgentContext,
	type GitHubAgentDefinition,
	type GitHubAgentInput,
	createInitialPRComment,
	executeGitHubAgent,
} from './shared/githubAgent.js';
import { resolveModelConfig } from './shared/modelResolution.js';
import {
	formatPRComments,
	formatPRDetails,
	formatPRDiff,
	formatPRIssueComments,
	formatPRReviews,
} from './shared/prFormatting.js';
import {
	injectContextFiles,
	injectDirectoryListing,
	injectSquintContext,
	injectSyntheticCall,
} from './shared/syntheticCalls.js';

interface RespondToPRCommentAgentInput extends GitHubAgentInput {
	triggerCommentId: number;
	triggerCommentBody: string;
	triggerCommentPath: string;
	triggerCommentUrl: string;
	acknowledgmentCommentId?: number;
}

// ============================================================================
// Context Building
// ============================================================================

interface PRCommentContextData extends GitHubAgentContext {
	contextFiles: Awaited<ReturnType<typeof resolveModelConfig>>['contextFiles'];
	prDetailsFormatted: string;
	commentsFormatted: string;
	reviewsFormatted: string;
	issueCommentsFormatted: string;
	diffFormatted: string;
}

async function buildPRCommentContext(
	owner: string,
	repo: string,
	prNumber: number,
	prBranch: string,
	repoDir: string,
	project: ProjectConfig,
	config: CascadeConfig,
	log: { info: (msg: string, ctx?: Record<string, unknown>) => void },
	modelOverride?: string,
): Promise<PRCommentContextData> {
	// respond-to-pr-comment shares model/iteration config with 'review' agent
	const { systemPrompt, model, maxIterations, contextFiles } = await resolveModelConfig({
		agentType: 'respond-to-pr-comment',
		project,
		config,
		repoDir,
		modelOverride,
		configKey: 'review',
	});

	// Fetch PR details, comments, reviews, issue comments, and diff
	log.info('Fetching PR details, comments, reviews, issue comments, and diff', {
		owner,
		repo,
		prNumber,
	});
	const prDetails = await githubClient.getPR(owner, repo, prNumber);
	const prComments = await githubClient.getPRReviewComments(owner, repo, prNumber);
	const prReviews = await githubClient.getPRReviews(owner, repo, prNumber);
	const prIssueComments = await githubClient.getPRIssueComments(owner, repo, prNumber);
	const prDiff = await githubClient.getPRDiff(owner, repo, prNumber);

	// Format PR data
	const prDetailsFormatted = formatPRDetails(prDetails);
	const commentsFormatted = formatPRComments(prComments);
	const reviewsFormatted = formatPRReviews(prReviews);
	const issueCommentsFormatted = formatPRIssueComments(prIssueComments);
	const diffFormatted = formatPRDiff(prDiff);

	// Build prompt
	const prompt = buildPRCommentPrompt(prBranch, prNumber, owner, repo);

	return {
		systemPrompt,
		model,
		maxIterations,
		contextFiles,
		prDetailsFormatted,
		commentsFormatted,
		reviewsFormatted,
		issueCommentsFormatted,
		diffFormatted,
		prompt,
	};
}

function buildPRCommentPrompt(
	prBranch: string,
	prNumber: number,
	owner: string,
	repo: string,
): string {
	return `You are on the branch \`${prBranch}\` for PR #${prNumber}.

A user @mentioned you in a PR comment. Read their request and execute it.

## GitHub Context

Owner: ${owner}
Repo: ${repo}
PR Number: ${prNumber}

Use these values when calling GitHub gadgets (GetPRComments, ReplyToReviewComment, PostPRComment, UpdatePRComment).`;
}

// ============================================================================
// Agent Definition
// ============================================================================

const respondToPRCommentDefinition: GitHubAgentDefinition<
	RespondToPRCommentAgentInput,
	PRCommentContextData
> = {
	agentType: 'respond-to-pr-comment',
	headerMessage: '🤖 Working on your request...',
	initialCommentDescription: 'Acknowledge PR comment request',
	timeoutMessage: '⚠️ PR comment agent timed out while working on the request.',
	loggerPrefix: 'pr-comment',

	getGadgets: () => createPRAgentGadgets({ includeReviewComments: true }),

	async postInitialComment(input, id, headerMessage) {
		if (input.acknowledgmentCommentId) {
			const comment = await githubClient.updatePRComment(
				id.owner,
				id.repo,
				input.acknowledgmentCommentId,
				headerMessage,
			);
			return { id: comment.id, htmlUrl: comment.htmlUrl, gadgetName: 'UpdatePRComment' };
		}
		return createInitialPRComment(input.prNumber, id, headerMessage);
	},

	buildContext: ({ owner, repo }, input, repoDir, log) =>
		buildPRCommentContext(
			owner,
			repo,
			input.prNumber,
			input.prBranch,
			repoDir,
			input.project,
			input.config,
			log,
			input.modelOverride,
		),

	async injectSyntheticCalls({
		builder,
		ctx,
		trackingContext,
		repoDir,
		id: { owner, repo },
		input,
	}) {
		let b = injectDirectoryListing(builder, trackingContext);

		// Inject the triggering comment prominently
		b = injectSyntheticCall(
			b,
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
		);

		b = injectSyntheticCall(
			b,
			trackingContext,
			'GetPRDetails',
			{ comment: 'Pre-fetching PR details for context', owner, repo, prNumber: input.prNumber },
			ctx.prDetailsFormatted,
			'gc_pr_details',
		);

		b = injectSyntheticCall(
			b,
			trackingContext,
			'GetPRComments',
			{
				comment: 'Pre-fetching line-specific review comments for context',
				owner,
				repo,
				prNumber: input.prNumber,
			},
			ctx.commentsFormatted,
			'gc_pr_comments',
		);

		b = injectSyntheticCall(
			b,
			trackingContext,
			'GetPRReviews',
			{
				comment: 'Pre-fetching review submissions for context',
				owner,
				repo,
				prNumber: input.prNumber,
			},
			ctx.reviewsFormatted,
			'gc_pr_reviews',
		);

		b = injectSyntheticCall(
			b,
			trackingContext,
			'GetPRIssueComments',
			{
				comment: 'Pre-fetching general PR comments for context',
				owner,
				repo,
				prNumber: input.prNumber,
			},
			ctx.issueCommentsFormatted,
			'gc_pr_issue_comments',
		);

		b = injectSyntheticCall(
			b,
			trackingContext,
			'GetPRDiff',
			{ comment: 'Pre-fetching PR diff for context', owner, repo, prNumber: input.prNumber },
			ctx.diffFormatted,
			'gc_pr_diff',
		);

		b = injectContextFiles(b, trackingContext, ctx.contextFiles);
		b = injectSquintContext(b, trackingContext, repoDir);

		return b;
	},
};

// ============================================================================
// PR Comment Agent Execution
// ============================================================================

export async function executeRespondToPRCommentAgent(
	input: RespondToPRCommentAgentInput,
): Promise<AgentResult> {
	return executeGitHubAgent(respondToPRCommentDefinition, input);
}
