import { WriteFile } from '../gadgets/WriteFile.js';

import { AstGrep } from '../gadgets/AstGrep.js';
import { FileSearchAndReplace } from '../gadgets/FileSearchAndReplace.js';
import { Finish } from '../gadgets/Finish.js';
import { ListDirectory } from '../gadgets/ListDirectory.js';
import { ReadFile } from '../gadgets/ReadFile.js';
import { RipGrep } from '../gadgets/RipGrep.js';
import { Sleep } from '../gadgets/Sleep.js';
import {
	GetPRComments,
	GetPRDetails,
	GetPRDiff,
	PostPRComment,
	ReplyToReviewComment,
	UpdatePRComment,
} from '../gadgets/github/index.js';
import { Tmux } from '../gadgets/tmux.js';
import { TodoDelete, TodoUpdateStatus, TodoUpsert } from '../gadgets/todo/index.js';
import { githubClient } from '../github/client.js';
import type { AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import {
	type GitHubAgentContext,
	type GitHubAgentDefinition,
	type GitHubAgentInput,
	createInitialPRComment,
	executeGitHubAgent,
} from './shared/githubAgent.js';
import { resolveModelConfig } from './shared/modelResolution.js';
import { formatPRDetails, formatPRDiff } from './shared/prFormatting.js';
import {
	injectContextFiles,
	injectDirectoryListing,
	injectSquintContext,
	injectSyntheticCall,
} from './shared/syntheticCalls.js';

interface RespondToReviewAgentInput extends GitHubAgentInput {
	triggerCommentId: number;
	triggerCommentBody: string;
	triggerCommentPath: string;
	triggerCommentUrl: string;
	acknowledgmentCommentId?: number;
}

// ============================================================================
// PR Data Formatting
// ============================================================================

type PRComments = Awaited<ReturnType<typeof githubClient.getPRReviewComments>>;
type PRReviews = Awaited<ReturnType<typeof githubClient.getPRReviews>>;
type PRIssueComments = Awaited<ReturnType<typeof githubClient.getPRIssueComments>>;

function formatPRComments(prComments: PRComments): string {
	if (prComments.length === 0) {
		return 'No review comments found.';
	}

	return prComments
		.map((c) =>
			[
				`Comment #${c.id} by @${c.user.login}`,
				`File: ${c.path}${c.line ? `:${c.line}` : ''}`,
				`URL: ${c.htmlUrl}`,
				c.inReplyToId ? `In reply to: #${c.inReplyToId}` : null,
				'',
				c.body,
				'---',
			]
				.filter(Boolean)
				.join('\n'),
		)
		.join('\n\n');
}

function formatPRReviews(prReviews: PRReviews): string {
	// Filter to reviews that have body text (the main review comment)
	const reviewsWithBody = prReviews.filter((r) => r.body && r.body.trim().length > 0);

	if (reviewsWithBody.length === 0) {
		return 'No review submissions with body text.';
	}

	return reviewsWithBody
		.map((r) =>
			[
				`Review by @${r.user.login} (${r.state})`,
				`Submitted: ${r.submittedAt}`,
				'',
				r.body,
				'---',
			].join('\n'),
		)
		.join('\n\n');
}

function formatPRIssueComments(prIssueComments: PRIssueComments): string {
	if (prIssueComments.length === 0) {
		return 'No general PR comments found.';
	}

	return prIssueComments
		.map((c) =>
			[
				`Comment #${c.id} by @${c.user.login}`,
				`URL: ${c.htmlUrl}`,
				`Created: ${c.createdAt}`,
				'',
				c.body,
				'---',
			].join('\n'),
		)
		.join('\n\n');
}

// ============================================================================
// Context Building
// ============================================================================

interface ReviewContextData extends GitHubAgentContext {
	contextFiles: Awaited<ReturnType<typeof resolveModelConfig>>['contextFiles'];
	prDetailsFormatted: string;
	commentsFormatted: string;
	reviewsFormatted: string;
	issueCommentsFormatted: string;
	diffFormatted: string;
}

async function buildReviewContext(
	owner: string,
	repo: string,
	prNumber: number,
	prBranch: string,
	repoDir: string,
	project: ProjectConfig,
	config: CascadeConfig,
	log: { info: (msg: string, ctx?: Record<string, unknown>) => void },
	modelOverride?: string,
): Promise<ReviewContextData> {
	// respond-to-review shares model/iteration config with 'review' agent
	const { systemPrompt, model, maxIterations, contextFiles } = await resolveModelConfig({
		agentType: 'respond-to-review',
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
	const prompt = buildReviewPrompt(prBranch, prNumber, owner, repo);

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

function buildReviewPrompt(
	prBranch: string,
	prNumber: number,
	owner: string,
	repo: string,
): string {
	return `You are on the branch \`${prBranch}\` for PR #${prNumber}.

Address the review comments and push your changes.

## GitHub Context

Owner: ${owner}
Repo: ${repo}
PR Number: ${prNumber}

Use these values when calling GitHub gadgets (GetPRComments, ReplyToReviewComment).`;
}

// ============================================================================
// Agent Definition
// ============================================================================

const respondToReviewDefinition: GitHubAgentDefinition<
	RespondToReviewAgentInput,
	ReviewContextData
> = {
	agentType: 'respond-to-review',
	headerMessage: '🤖 Working on addressing the review feedback...',
	initialCommentDescription: 'Acknowledge review feedback',
	timeoutMessage: '⚠️ Review agent timed out while addressing feedback.',
	loggerPrefix: 'review',

	getGadgets: () => [
		new ListDirectory(),
		new ReadFile(),
		new FileSearchAndReplace(),
		new WriteFile(),
		new RipGrep(),
		new AstGrep(),
		new Tmux(),
		new Sleep(),
		new TodoUpsert(),
		new TodoUpdateStatus(),
		new TodoDelete(),
		new GetPRDetails(),
		new GetPRComments(),
		new GetPRDiff(),
		new ReplyToReviewComment(),
		new PostPRComment(),
		new UpdatePRComment(),
		new Finish(),
	],

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
		buildReviewContext(
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
				comment: 'Pre-fetching line-specific review comments to address',
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
				comment: 'Pre-fetching review submissions (approve/request changes with body text)',
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
				comment: 'Pre-fetching general PR comments (issue-style conversation)',
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
// Review Agent Execution
// ============================================================================

export async function executeRespondToReviewAgent(
	input: RespondToReviewAgentInput,
): Promise<AgentResult> {
	return executeGitHubAgent(respondToReviewDefinition, input);
}
