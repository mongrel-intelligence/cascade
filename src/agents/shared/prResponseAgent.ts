import { githubClient } from '../../github/client.js';
import type { CascadeConfig, ProjectConfig } from '../../types/index.js';
import type { TrackingContext } from '../utils/tracking.js';
import type { BuilderType } from './builderFactory.js';
import type {
	GitHubAgentContext,
	GitHubAgentInput,
	InitialCommentResult,
	RepoIdentifier,
} from './githubAgent.js';
import { createInitialPRComment } from './githubAgent.js';
import { resolveModelConfig } from './modelResolution.js';
import {
	formatPRComments,
	formatPRDetails,
	formatPRDiff,
	formatPRIssueComments,
	formatPRReviews,
} from './prFormatting.js';
import {
	injectContextFiles,
	injectDirectoryListing,
	injectSquintContext,
	injectSyntheticCall,
} from './syntheticCalls.js';

// ============================================================================
// Shared Types
// ============================================================================

export interface PRResponseAgentInput extends GitHubAgentInput {
	triggerCommentId: number;
	triggerCommentBody: string;
	triggerCommentPath: string;
	triggerCommentUrl: string;
	acknowledgmentCommentId?: number;
}

export interface PRResponseContextData extends GitHubAgentContext {
	contextFiles: Awaited<ReturnType<typeof resolveModelConfig>>['contextFiles'];
	prDetailsFormatted: string;
	commentsFormatted: string;
	reviewsFormatted: string;
	issueCommentsFormatted: string;
	diffFormatted: string;
}

// ============================================================================
// Context Builder
// ============================================================================

export async function buildPRResponseContext(
	owner: string,
	repo: string,
	prNumber: number,
	prBranch: string,
	repoDir: string,
	project: ProjectConfig,
	config: CascadeConfig,
	log: { info: (msg: string, ctx?: Record<string, unknown>) => void },
	agentType: string,
	promptBuilder: (prBranch: string, prNumber: number, owner: string, repo: string) => string,
	modelOverride?: string,
): Promise<PRResponseContextData> {
	const { systemPrompt, model, maxIterations, contextFiles } = await resolveModelConfig({
		agentType,
		project,
		config,
		repoDir,
		modelOverride,
		configKey: 'review',
	});

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

	const prDetailsFormatted = formatPRDetails(prDetails);
	const commentsFormatted = formatPRComments(prComments);
	const reviewsFormatted = formatPRReviews(prReviews);
	const issueCommentsFormatted = formatPRIssueComments(prIssueComments);
	const diffFormatted = formatPRDiff(prDiff);

	const prompt = promptBuilder(prBranch, prNumber, owner, repo);

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

// ============================================================================
// Prompt Builder
// ============================================================================

export function buildPRResponsePrompt(
	prBranch: string,
	prNumber: number,
	owner: string,
	repo: string,
	instructionLine: string,
	gadgetNames: string,
): string {
	return `You are on the branch \`${prBranch}\` for PR #${prNumber}.

${instructionLine}

## GitHub Context

Owner: ${owner}
Repo: ${repo}
PR Number: ${prNumber}

Use these values when calling GitHub gadgets (${gadgetNames}).`;
}

// ============================================================================
// Initial Comment Handler
// ============================================================================

export async function postInitialPRResponseComment(
	input: PRResponseAgentInput,
	id: RepoIdentifier,
	headerMessage: string,
): Promise<InitialCommentResult> {
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
}

// ============================================================================
// Synthetic Call Injection
// ============================================================================

/** Default comment descriptions used by respond-to-review. */
const DEFAULT_COMMENT_DESCRIPTIONS = {
	prComments: 'Pre-fetching line-specific review comments to address',
	prReviews: 'Pre-fetching review submissions (approve/request changes with body text)',
	prIssueComments: 'Pre-fetching general PR comments (issue-style conversation)',
};

export interface InjectPRResponseSyntheticCallsParams {
	builder: BuilderType;
	ctx: PRResponseContextData;
	trackingContext: TrackingContext;
	repoDir: string;
	id: RepoIdentifier;
	input: PRResponseAgentInput;
}

export interface InjectPRResponseSyntheticCallsOptions {
	/** Callback to inject additional synthetic calls before the standard PR data calls. */
	preSyntheticCalls?: (
		builder: BuilderType,
		trackingContext: TrackingContext,
		input: PRResponseAgentInput,
	) => BuilderType;
	/** Override default comment descriptions for specific calls. */
	commentDescriptions?: Partial<typeof DEFAULT_COMMENT_DESCRIPTIONS>;
}

export function injectPRResponseSyntheticCalls(
	params: InjectPRResponseSyntheticCallsParams,
	options?: InjectPRResponseSyntheticCallsOptions,
): BuilderType {
	const { ctx, trackingContext, repoDir, input } = params;
	const { owner, repo } = params.id;
	const descriptions = { ...DEFAULT_COMMENT_DESCRIPTIONS, ...options?.commentDescriptions };

	let b = injectDirectoryListing(params.builder, trackingContext);

	if (options?.preSyntheticCalls) {
		b = options.preSyntheticCalls(b, trackingContext, input);
	}

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
		{ comment: descriptions.prComments, owner, repo, prNumber: input.prNumber },
		ctx.commentsFormatted,
		'gc_pr_comments',
	);

	b = injectSyntheticCall(
		b,
		trackingContext,
		'GetPRReviews',
		{ comment: descriptions.prReviews, owner, repo, prNumber: input.prNumber },
		ctx.reviewsFormatted,
		'gc_pr_reviews',
	);

	b = injectSyntheticCall(
		b,
		trackingContext,
		'GetPRIssueComments',
		{ comment: descriptions.prIssueComments, owner, repo, prNumber: input.prNumber },
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
}
