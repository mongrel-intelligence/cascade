import type { LLMist, createLogger } from 'llmist';
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
import { recordInitialComment } from '../gadgets/sessionState.js';
import { Tmux } from '../gadgets/tmux.js';
import { TodoDelete, TodoUpdateStatus, TodoUpsert } from '../gadgets/todo/index.js';
import { githubClient } from '../github/client.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { type BuilderType, createConfiguredBuilder } from './shared/builderFactory.js';
import { executeAgentLifecycle } from './shared/lifecycle.js';
import { resolveModelConfig } from './shared/modelResolution.js';
import { formatPRDetails, formatPRDiff } from './shared/prFormatting.js';
import { setupRepository } from './shared/repository.js';
import {
	injectAUContext,
	injectContextFiles,
	injectDirectoryListing,
	injectSyntheticCall,
} from './shared/syntheticCalls.js';
import type { TrackingContext } from './utils/tracking.js';

interface RespondToReviewAgentInput extends AgentInput {
	prNumber: number;
	prBranch: string;
	repoFullName: string;
	triggerCommentId: number;
	triggerCommentBody: string;
	triggerCommentPath: string;
	triggerCommentUrl: string;
	project: ProjectConfig;
	config: CascadeConfig;
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

interface ReviewContextData {
	systemPrompt: string;
	model: string;
	maxIterations: number;
	contextFiles: Awaited<ReturnType<typeof resolveModelConfig>>['contextFiles'];
	prDetailsFormatted: string;
	commentsFormatted: string;
	reviewsFormatted: string;
	issueCommentsFormatted: string;
	diffFormatted: string;
	prompt: string;
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
// Agent Builder
// ============================================================================

function getRespondToReviewGadgets() {
	return [
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
	];
}

function createRespondToReviewAgentBuilder(
	client: LLMist,
	ctx: ReviewContextData,
	llmistLogger: ReturnType<typeof createLogger>,
	trackingContext: TrackingContext,
	logWriter: (level: string, message: string, context?: Record<string, unknown>) => void,
	llmCallLogger: import('../utils/llmLogging.js').LLMCallLogger,
	repoDir: string,
): BuilderType {
	return createConfiguredBuilder({
		client,
		agentType: 'respond-to-review',
		model: ctx.model,
		systemPrompt: ctx.systemPrompt,
		maxIterations: ctx.maxIterations,
		llmistLogger,
		trackingContext,
		logWriter,
		llmCallLogger,
		repoDir,
		gadgets: getRespondToReviewGadgets(),
	});
}

async function injectReviewSyntheticCalls(
	initialBuilder: BuilderType,
	owner: string,
	repo: string,
	prNumber: number,
	ctx: ReviewContextData,
	trackingContext: TrackingContext,
	repoDir: string,
): Promise<BuilderType> {
	// Post initial "getting to work" comment on the PR
	const initialCommentBody = '🤖 Working on addressing the review feedback...';
	const initialComment = await githubClient.createPRComment(
		owner,
		repo,
		prNumber,
		initialCommentBody,
	);
	recordInitialComment(initialComment.id);
	let builder = injectSyntheticCall(
		initialBuilder,
		trackingContext,
		'PostPRComment',
		{ comment: 'Acknowledge review feedback', owner, repo, prNumber, body: initialCommentBody },
		`Comment posted (id: ${initialComment.id}): ${initialComment.htmlUrl}`,
		'gc_initial_comment',
	);

	// Inject directory listing
	builder = injectDirectoryListing(builder, trackingContext);

	// Inject PR details, comments, reviews, issue comments, and diff
	builder = injectSyntheticCall(
		builder,
		trackingContext,
		'GetPRDetails',
		{ comment: 'Pre-fetching PR details for context', owner, repo, prNumber },
		ctx.prDetailsFormatted,
		'gc_pr_details',
	);

	builder = injectSyntheticCall(
		builder,
		trackingContext,
		'GetPRComments',
		{ comment: 'Pre-fetching line-specific review comments to address', owner, repo, prNumber },
		ctx.commentsFormatted,
		'gc_pr_comments',
	);

	builder = injectSyntheticCall(
		builder,
		trackingContext,
		'GetPRReviews',
		{
			comment: 'Pre-fetching review submissions (approve/request changes with body text)',
			owner,
			repo,
			prNumber,
		},
		ctx.reviewsFormatted,
		'gc_pr_reviews',
	);

	builder = injectSyntheticCall(
		builder,
		trackingContext,
		'GetPRIssueComments',
		{
			comment: 'Pre-fetching general PR comments (issue-style conversation)',
			owner,
			repo,
			prNumber,
		},
		ctx.issueCommentsFormatted,
		'gc_pr_issue_comments',
	);

	builder = injectSyntheticCall(
		builder,
		trackingContext,
		'GetPRDiff',
		{ comment: 'Pre-fetching PR diff for context', owner, repo, prNumber },
		ctx.diffFormatted,
		'gc_pr_diff',
	);

	// Inject context files and AU context
	builder = injectContextFiles(builder, trackingContext, ctx.contextFiles);
	builder = await injectAUContext(builder, trackingContext, repoDir);

	return builder;
}

// ============================================================================
// Review Agent Execution
// ============================================================================

export async function executeRespondToReviewAgent(
	input: RespondToReviewAgentInput,
): Promise<AgentResult> {
	const { project, config, prNumber, prBranch, repoFullName, interactive, autoAccept } = input;

	// Parse owner/repo from repoFullName
	const [owner, repo] = repoFullName.split('/');
	if (!owner || !repo) {
		return { success: false, output: '', error: `Invalid repo format: ${repoFullName}` };
	}

	return executeAgentLifecycle<ReviewContextData>({
		loggerIdentifier: `review-${prNumber}`,

		onWatchdogTimeout: async () => {
			await githubClient.createPRComment(
				owner,
				repo,
				prNumber,
				'⚠️ Review agent timed out while addressing feedback.',
			);
			logger.info('Posted timeout notice to PR', { prNumber });
		},

		setupRepoDir: (log) =>
			setupRepository({ project, log, agentType: 'respond-to-review', prBranch }),

		buildContext: (repoDir, log) =>
			buildReviewContext(
				owner,
				repo,
				prNumber,
				prBranch,
				repoDir,
				project,
				config,
				log,
				input.modelOverride,
			),

		createBuilder: ({ client, ctx, llmistLogger, trackingContext, fileLogger, repoDir }) =>
			createRespondToReviewAgentBuilder(
				client,
				ctx,
				llmistLogger,
				trackingContext,
				fileLogger.write.bind(fileLogger),
				fileLogger.llmCallLogger,
				repoDir,
			),

		injectSyntheticCalls: ({ builder, ctx, trackingContext, repoDir }) =>
			injectReviewSyntheticCalls(builder, owner, repo, prNumber, ctx, trackingContext, repoDir),

		interactive,
		autoAccept,
	});
}
