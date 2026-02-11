import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { createLogger } from 'llmist';

import { REVIEW_FILE_CONTENT_TOKEN_LIMIT, estimateTokens } from '../config/reviewConfig.js';
import { Finish } from '../gadgets/Finish.js';
import { ListDirectory } from '../gadgets/ListDirectory.js';
import { ReadFile } from '../gadgets/ReadFile.js';
import { Sleep } from '../gadgets/Sleep.js';
import {
	CreatePRReview,
	GetPRChecks,
	GetPRDetails,
	GetPRDiff,
	formatCheckStatus,
} from '../gadgets/github/index.js';
import { Tmux } from '../gadgets/tmux.js';
import { TodoDelete, TodoUpdateStatus, TodoUpsert } from '../gadgets/todo/index.js';
import { githubClient } from '../github/client.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { type BuilderType, createConfiguredBuilder } from './shared/builderFactory.js';
import { executeAgentLifecycle } from './shared/lifecycle.js';
import { resolveModelConfig } from './shared/modelResolution.js';
import { type PRDiff, formatPRDetails, formatPRDiff } from './shared/prFormatting.js';
import { setupRepository } from './shared/repository.js';
import {
	injectContextFiles,
	injectSquintContext,
	injectSyntheticCall,
} from './shared/syntheticCalls.js';
import type { TrackingContext } from './utils/tracking.js';

interface ReviewAgentInput extends AgentInput {
	prNumber: number;
	prBranch: string;
	repoFullName: string;
	project: ProjectConfig;
	config: CascadeConfig;
}

// ============================================================================
// PR File Contents Reading
// ============================================================================

interface PRFileContents {
	included: Array<{ path: string; content: string }>;
	skipped: string[];
}

async function readPRFileContents(repoDir: string, prDiff: PRDiff): Promise<PRFileContents> {
	const included: Array<{ path: string; content: string }> = [];
	const skipped: string[] = [];
	let totalTokens = 0;

	for (const file of prDiff) {
		// Skip deleted/binary files
		if (file.status === 'removed' || !file.patch) continue;

		const filePath = join(repoDir, file.filename);
		try {
			const content = await readFile(filePath, 'utf-8');
			const tokens = estimateTokens(content);

			if (totalTokens + tokens <= REVIEW_FILE_CONTENT_TOKEN_LIMIT) {
				included.push({ path: file.filename, content });
				totalTokens += tokens;
			} else {
				skipped.push(file.filename);
			}
		} catch {
			// File might not exist (renamed from), skip
		}
	}

	return { included, skipped };
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
	diffFormatted: string;
	checkStatusFormatted: string;
	fileContents: PRFileContents;
	prompt: string;
}

async function buildReviewContext(
	owner: string,
	repo: string,
	prNumber: number,
	repoDir: string,
	project: ProjectConfig,
	config: CascadeConfig,
	log: { info: (msg: string, ctx?: Record<string, unknown>) => void },
	modelOverride?: string,
): Promise<ReviewContextData> {
	const { systemPrompt, model, maxIterations, contextFiles } = await resolveModelConfig({
		agentType: 'review',
		project,
		config,
		repoDir,
		modelOverride,
	});

	// Fetch PR details, diff, and check status
	log.info('Fetching PR details, diff, and check status', { owner, repo, prNumber });
	const prDetails = await githubClient.getPR(owner, repo, prNumber);
	const prDiff = await githubClient.getPRDiff(owner, repo, prNumber);
	const checkStatus = await githubClient.getCheckSuiteStatus(owner, repo, prDetails.headSha);

	// Format PR data
	const prDetailsFormatted = formatPRDetails(prDetails);
	const diffFormatted = formatPRDiff(prDiff);
	const checkStatusFormatted = formatCheckStatus(prNumber, checkStatus);

	// Read full contents of changed files (up to token limit)
	log.info('Reading PR file contents', { fileCount: prDiff.length });
	const fileContents = await readPRFileContents(repoDir, prDiff);
	log.info('File contents loaded', {
		included: fileContents.included.length,
		skipped: fileContents.skipped.length,
	});

	// Build prompt (include skipped files note if any)
	const prompt = buildReviewPrompt(prNumber, owner, repo, fileContents.skipped);

	return {
		systemPrompt,
		model,
		maxIterations,
		contextFiles,
		prDetailsFormatted,
		diffFormatted,
		checkStatusFormatted,
		fileContents,
		prompt,
	};
}

function buildReviewPrompt(
	prNumber: number,
	owner: string,
	repo: string,
	skippedFiles: string[],
): string {
	let prompt = `Review PR #${prNumber} in ${owner}/${repo}.

Examine the code changes carefully and submit your review using CreatePRReview.

## GitHub Context

Owner: ${owner}
Repo: ${repo}
PR Number: ${prNumber}

Use these values when calling GitHub gadgets (GetPRDetails, GetPRDiff, CreatePRReview).`;

	if (skippedFiles.length > 0) {
		prompt += `\n\n## Files Not Pre-loaded

The following files exceeded the token limit and were not pre-loaded. Use ReadFile if you need their full contents:
${skippedFiles.map((f) => `- ${f}`).join('\n')}`;
	}

	return prompt;
}

// ============================================================================
// Agent Builder
// ============================================================================

function getReviewGadgets() {
	return [
		new ListDirectory(),
		new ReadFile(),
		new Tmux(),
		new Sleep(),
		new TodoUpsert(),
		new TodoUpdateStatus(),
		new TodoDelete(),
		new GetPRDetails(),
		new GetPRDiff(),
		new GetPRChecks(),
		new CreatePRReview(),
		new Finish(),
	];
}

function createReviewAgentBuilder(
	client: import('llmist').LLMist,
	ctx: ReviewContextData,
	llmistLogger: ReturnType<typeof createLogger>,
	trackingContext: TrackingContext,
	logWriter: (level: string, message: string, context?: Record<string, unknown>) => void,
	llmCallLogger: import('../utils/llmLogging.js').LLMCallLogger,
	repoDir: string,
): BuilderType {
	return createConfiguredBuilder({
		client,
		agentType: 'review',
		model: ctx.model,
		systemPrompt: ctx.systemPrompt,
		maxIterations: ctx.maxIterations,
		llmistLogger,
		trackingContext,
		logWriter,
		llmCallLogger,
		repoDir,
		gadgets: getReviewGadgets(),
		skipSessionState: true,
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
	// Inject PR details, diff, and check status
	let builder = injectSyntheticCall(
		initialBuilder,
		trackingContext,
		'GetPRDetails',
		{ comment: 'Pre-fetching PR details for review context', owner, repo, prNumber },
		ctx.prDetailsFormatted,
		'gc_pr_details',
	);

	builder = injectSyntheticCall(
		builder,
		trackingContext,
		'GetPRDiff',
		{ comment: 'Pre-fetching PR diff for code review', owner, repo, prNumber },
		ctx.diffFormatted,
		'gc_pr_diff',
	);

	builder = injectSyntheticCall(
		builder,
		trackingContext,
		'GetPRChecks',
		{ comment: 'Pre-fetching CI check status for review', owner, repo, prNumber },
		ctx.checkStatusFormatted,
		'gc_pr_checks',
	);

	// Inject context files (CLAUDE.md, README.md, etc.)
	builder = injectContextFiles(builder, trackingContext, ctx.contextFiles);

	// Inject full contents of PR changed files (up to token limit)
	for (let i = 0; i < ctx.fileContents.included.length; i++) {
		const file = ctx.fileContents.included[i];
		builder = injectSyntheticCall(
			builder,
			trackingContext,
			'ReadFile',
			{ comment: `Pre-fetching ${file.path} for review`, filePath: file.path },
			`path=${file.path}\n\n${file.content}`,
			`gc_file_${i + 1}`,
		);
	}

	builder = injectSquintContext(builder, trackingContext, repoDir);

	return builder;
}

// ============================================================================
// Review Agent Execution
// ============================================================================

export async function executeReviewAgent(input: ReviewAgentInput): Promise<AgentResult> {
	const { project, config, prNumber, prBranch, repoFullName, interactive } = input;

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
				'⚠️ Review agent timed out while reviewing the PR.',
			);
			logger.info('Posted timeout notice to PR', { prNumber });
		},

		setupRepoDir: (log) => setupRepository({ project, log, agentType: 'review', prBranch }),

		buildContext: (repoDir, log) =>
			buildReviewContext(owner, repo, prNumber, repoDir, project, config, log, input.modelOverride),

		createBuilder: ({ client, ctx, llmistLogger, trackingContext, fileLogger, repoDir }) =>
			createReviewAgentBuilder(
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
	});
}
