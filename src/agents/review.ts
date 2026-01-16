import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { auList, auRead } from 'au';
import { AgentBuilder, LLMist, createLogger } from 'llmist';

import { getCompactionConfig } from '../config/compactionConfig.js';
import { getIterationTrailingMessage } from '../config/hintConfig.js';
import { getRateLimitForModel } from '../config/rateLimits.js';
import { getRetryConfig } from '../config/retryConfig.js';
import { REVIEW_FILE_CONTENT_TOKEN_LIMIT, estimateTokens } from '../config/reviewConfig.js';
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
import { TodoDelete, TodoUpsert } from '../gadgets/todo/index.js';
import { githubClient } from '../github/client.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { cleanupLogDirectory, cleanupLogFile, createFileLogger } from '../utils/fileLogger.js';
import { clearWatchdogCleanup, setWatchdogCleanup } from '../utils/lifecycle.js';
import { logger } from '../utils/logging.js';
import {
	cleanupTempDir,
	cloneRepo,
	createTempDir,
	runCommand as execCommand,
} from '../utils/repo.js';
import { getSystemPrompt } from './prompts/index.js';
import { runAgentLoop } from './utils/agentLoop.js';
import { createObserverHooks } from './utils/hooks.js';
import { getLogLevel, readContextFiles } from './utils/index.js';
import { createAgentLogger } from './utils/logging.js';
import {
	type TrackingContext,
	createTrackingContext,
	recordSyntheticInvocationId,
} from './utils/tracking.js';

interface ReviewAgentInput extends AgentInput {
	prNumber: number;
	prBranch: string;
	repoFullName: string;
	project: ProjectConfig;
	config: CascadeConfig;
}

// ============================================================================
// PR Data Formatting
// ============================================================================

type PRDetails = Awaited<ReturnType<typeof githubClient.getPR>>;
type PRDiff = Awaited<ReturnType<typeof githubClient.getPRDiff>>;

function formatPRDetails(prDetails: PRDetails): string {
	return [
		`PR #${prDetails.number}: ${prDetails.title}`,
		`State: ${prDetails.state}`,
		`Branch: ${prDetails.headRef} -> ${prDetails.baseRef}`,
		`URL: ${prDetails.htmlUrl}`,
		'',
		'Description:',
		prDetails.body || '(no description)',
	].join('\n');
}

function formatPRDiff(prDiff: PRDiff): string {
	if (prDiff.length === 0) {
		return 'No files changed in this PR.';
	}

	const formatted = prDiff.map((f) => {
		const lines = [`## ${f.filename}`, `Status: ${f.status} | +${f.additions} -${f.deletions}`];
		if (f.patch) {
			lines.push('```diff', f.patch, '```');
		} else {
			lines.push('[Binary file or too large to display]');
		}
		return lines.join('\n');
	});

	return `${prDiff.length} file(s) changed:\n\n${formatted.join('\n\n')}`;
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
	contextFiles: Awaited<ReturnType<typeof readContextFiles>>;
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
	log: ReturnType<typeof createAgentLogger>,
): Promise<ReviewContextData> {
	// Get system prompt and model
	const systemPrompt = project.prompts?.review || getSystemPrompt('review', {});
	const model =
		project.agentModels?.review ||
		project.model ||
		config.defaults.agentModels?.review ||
		config.defaults.model;
	const maxIterations = config.defaults.agentIterations?.review || config.defaults.maxIterations;

	// Read context files from repo
	const contextFiles = await readContextFiles(repoDir);

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

type BuilderType = ReturnType<typeof AgentBuilder.prototype.withGadgets>;

function createReviewAgentBuilder(
	client: LLMist,
	ctx: ReviewContextData,
	llmistLogger: ReturnType<typeof createLogger>,
	trackingContext: TrackingContext,
	logWriter: (level: string, message: string, context?: Record<string, unknown>) => void,
	llmCallLogger: import('../utils/llmLogging.js').LLMCallLogger,
	repoDir: string,
): BuilderType {
	// Check if AU features should be enabled (repo has .au file at root)
	const auEnabled = existsSync(join(repoDir, '.au'));

	// Build gadget list
	const baseGadgets = [
		// Filesystem gadgets
		new ListDirectory(),
		new ReadFile(),
		// Shell commands via tmux
		new Tmux(),
		new Sleep(),
		// Task tracking gadgets
		new TodoUpsert(),
		new TodoDelete(),
		// GitHub gadgets (read + create review)
		new GetPRDetails(),
		new GetPRDiff(),
		new GetPRChecks(),
		new CreatePRReview(),
	];

	const allGadgets = auEnabled ? [...baseGadgets, auList, auRead] : baseGadgets;

	return new AgentBuilder(client)
		.withModel(ctx.model)
		.withTemperature(0)
		.withSystem(ctx.systemPrompt)
		.withMaxIterations(ctx.maxIterations)
		.withLogger(llmistLogger)
		.withRateLimits(getRateLimitForModel(ctx.model))
		.withRetry(getRetryConfig(llmistLogger))
		.withCompaction(getCompactionConfig('review'))
		.withTrailingMessage(getIterationTrailingMessage('review'))
		.withHooks({
			observers: createObserverHooks({
				model: ctx.model,
				logWriter,
				trackingContext,
				llmCallLogger,
			}),
		})
		.withGadgets(...allGadgets);
}

async function injectReviewSyntheticCalls(
	initialBuilder: BuilderType,
	owner: string,
	repo: string,
	prNumber: number,
	ctx: ReviewContextData,
	trackingContext: TrackingContext,
	auEnabled: boolean,
): Promise<BuilderType> {
	let builder = initialBuilder;

	// Inject PR details
	recordSyntheticInvocationId(trackingContext, 'gc_pr_details');
	builder = builder.withSyntheticGadgetCall(
		'GetPRDetails',
		{ owner, repo, prNumber },
		ctx.prDetailsFormatted,
		'gc_pr_details',
	);

	// Inject PR diff
	recordSyntheticInvocationId(trackingContext, 'gc_pr_diff');
	builder = builder.withSyntheticGadgetCall(
		'GetPRDiff',
		{ owner, repo, prNumber },
		ctx.diffFormatted,
		'gc_pr_diff',
	);

	// Inject PR check status
	recordSyntheticInvocationId(trackingContext, 'gc_pr_checks');
	builder = builder.withSyntheticGadgetCall(
		'GetPRChecks',
		{ owner, repo, prNumber },
		ctx.checkStatusFormatted,
		'gc_pr_checks',
	);

	// Inject context files (CLAUDE.md, README.md, etc.)
	for (let i = 0; i < ctx.contextFiles.length; i++) {
		const file = ctx.contextFiles[i];
		const invocationId = `gc_init_${i + 1}`;
		recordSyntheticInvocationId(trackingContext, invocationId);
		builder = builder.withSyntheticGadgetCall(
			'ReadFile',
			{ filePath: file.path },
			file.content,
			invocationId,
		);
	}

	// Inject full contents of PR changed files (up to token limit)
	for (let i = 0; i < ctx.fileContents.included.length; i++) {
		const file = ctx.fileContents.included[i];
		const invocationId = `gc_file_${i + 1}`;
		recordSyntheticInvocationId(trackingContext, invocationId);
		builder = builder.withSyntheticGadgetCall(
			'ReadFile',
			{ filePath: file.path },
			`path=${file.path}\n\n${file.content}`,
			invocationId,
		);
	}

	// Inject AU understanding if enabled (gives agent immediate codebase context)
	if (auEnabled) {
		const auListResult = (await auList.execute({ path: '.' })) as string;
		// Only inject if there's actual content
		if (auListResult && !auListResult.includes('No AU entries found')) {
			recordSyntheticInvocationId(trackingContext, 'gc_au_list');
			builder = builder.withSyntheticGadgetCall(
				'AUList',
				{ path: '.' },
				auListResult,
				'gc_au_list',
			);

			// Also inject root-level understanding for high-level context
			const auReadResult = (await auRead.execute({ paths: '.' })) as string;
			if (auReadResult && !auReadResult.includes('No understanding exists yet')) {
				recordSyntheticInvocationId(trackingContext, 'gc_au_read');
				builder = builder.withSyntheticGadgetCall(
					'AURead',
					{ paths: '.' },
					auReadResult,
					'gc_au_read',
				);
			}
		}
	}

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

	let repoDir: string | null = null;

	// Create file logger for this agent run
	const fileLogger = createFileLogger(`cascade-review-${prNumber}`);
	const log = createAgentLogger(fileLogger);

	// Register cleanup callback for watchdog timeout
	setWatchdogCleanup(async () => {
		fileLogger.close();
		await githubClient.createPRComment(
			owner,
			repo,
			prNumber,
			'⚠️ Review agent timed out while reviewing the PR.',
		);
		logger.info('Posted timeout notice to PR', { prNumber });
	});

	try {
		// Clone the target repository
		repoDir = createTempDir(project.id);
		cloneRepo(project, repoDir);

		// Checkout the PR branch
		log.info('Checking out PR branch', { prBranch });
		await execCommand('git', ['checkout', prBranch], repoDir);

		// Run project-specific setup script if it exists (handles dependency installation)
		const setupScriptPath = join(repoDir, '.cascade', 'setup.sh');
		if (existsSync(setupScriptPath)) {
			log.info('Running project setup script', { path: '.cascade/setup.sh' });
			const setupResult = await execCommand('bash', [setupScriptPath], repoDir);
			log.info('Setup script completed', {
				exitCode: setupResult.exitCode,
				stdout: setupResult.stdout.slice(-500),
				stderr: setupResult.stderr.slice(-500),
			});
			if (setupResult.exitCode !== 0) {
				log.warn('Setup script exited with non-zero code', { exitCode: setupResult.exitCode });
			}
		}

		log.info('Running review agent', { prNumber, repoFullName, repoDir });

		// Build context
		const ctx = await buildReviewContext(owner, repo, prNumber, repoDir, project, config, log);

		// Change to repo directory
		const originalCwd = process.cwd();
		process.chdir(repoDir);

		log.info('Starting llmist agent', {
			model: ctx.model,
			maxIterations: ctx.maxIterations,
			promptLength: ctx.prompt.length,
		});

		try {
			process.env.LLMIST_LOG_FILE = fileLogger.llmistLogPath;

			const client = new LLMist();
			const llmistLogger = createLogger({ minLevel: getLogLevel() });

			// Create tracking context
			const trackingContext = createTrackingContext();

			// Check if AU features should be enabled (repo has .au file at root)
			const auEnabled = existsSync(join(repoDir, '.au'));

			// Build agent with gadgets and synthetic calls
			let builder = createReviewAgentBuilder(
				client,
				ctx,
				llmistLogger,
				trackingContext,
				fileLogger.write.bind(fileLogger),
				fileLogger.llmCallLogger,
				repoDir,
			);
			builder = await injectReviewSyntheticCalls(
				builder,
				owner,
				repo,
				prNumber,
				ctx,
				trackingContext,
				auEnabled,
			);

			// Run the agent
			const agent = builder.ask(ctx.prompt);
			const result = await runAgentLoop(agent, log, trackingContext, interactive === true);

			log.info('Review agent completed', {
				prNumber,
				iterations: result.iterations,
				gadgetCalls: result.gadgetCalls,
				cost: result.cost,
			});

			fileLogger.close();
			const logBuffer = await fileLogger.getZippedBuffer();

			return {
				success: true,
				output: result.output,
				logBuffer,
				cost: result.cost,
			};
		} finally {
			process.chdir(originalCwd);
		}
	} catch (err) {
		logger.error('Review agent execution failed', { prNumber, error: String(err) });

		let logBuffer: Buffer | undefined;
		try {
			fileLogger.close();
			logBuffer = await fileLogger.getZippedBuffer();
		} catch {
			// Ignore log buffer errors
		}

		return {
			success: false,
			output: '',
			error: String(err),
			logBuffer,
		};
	} finally {
		clearWatchdogCleanup();

		// Skip cleanup in local mode to preserve logs for debugging
		const isLocalMode = process.env.CASCADE_LOCAL_MODE === 'true';

		if (repoDir && !isLocalMode) {
			try {
				cleanupTempDir(repoDir);
			} catch (err) {
				logger.warn('Failed to cleanup temp directory', { repoDir, error: String(err) });
			}
		}
		if (!isLocalMode) {
			cleanupLogFile(fileLogger.logPath);
			cleanupLogFile(fileLogger.llmistLogPath);
			cleanupLogDirectory(fileLogger.llmCallLogger.logDir);
		}
	}
}
