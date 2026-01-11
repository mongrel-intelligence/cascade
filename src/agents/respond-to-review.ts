import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeFile } from '@llmist/cli/gadgets';
import { AgentBuilder, LLMist, createLogger } from 'llmist';

import { getCompactionConfig } from '../config/compactionConfig.js';
import { getIterationTrailingMessage } from '../config/hintConfig.js';
import { getRateLimitForModel } from '../config/rateLimits.js';
import { getRetryConfig } from '../config/retryConfig.js';
import { EditFile } from '../gadgets/EditFile.js';
import { ListDirectory } from '../gadgets/ListDirectory.js';
import { ReadFile } from '../gadgets/ReadFile.js';
import { Sleep } from '../gadgets/Sleep.js';
import {
	GetPRComments,
	GetPRDetails,
	GetPRDiff,
	ReplyToReviewComment,
} from '../gadgets/github/index.js';
import { Tmux } from '../gadgets/tmux.js';
import { githubClient } from '../github/client.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { cleanupLogDirectory, cleanupLogFile, createFileLogger } from '../utils/fileLogger.js';
import { clearWatchdogCleanup, setWatchdogCleanup } from '../utils/lifecycle.js';
import type { LLMCallLogger } from '../utils/llmLogging.js';
import { calculateCost, logLLMCallStart, logLLMMetrics } from '../utils/llmMetrics.js';
import { logger } from '../utils/logging.js';
import {
	cleanupTempDir,
	cloneRepo,
	createTempDir,
	runCommand as execCommand,
} from '../utils/repo.js';
import { getSystemPrompt } from './prompts/index.js';
import { runAgentLoop } from './utils/agentLoop.js';
import {
	type DependencyInstallResult,
	getLogLevel,
	installDependencies,
	readContextFiles,
} from './utils/index.js';
import { createAgentLogger } from './utils/logging.js';
import {
	type TrackingContext,
	createTrackingContext,
	incrementLLMIteration,
	recordSyntheticInvocationId,
} from './utils/tracking.js';

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
// Repository Setup
// ============================================================================

interface RepoSetupResult {
	repoDir: string;
	installResult: DependencyInstallResult | null;
}

async function setupRepository(
	project: ProjectConfig,
	prBranch: string,
	log: ReturnType<typeof createAgentLogger>,
): Promise<RepoSetupResult> {
	// Clone repo to temp directory
	const repoDir = createTempDir(project.id);
	cloneRepo(project, repoDir);

	// Checkout the PR branch
	log.info('Checking out PR branch', { prBranch });
	await execCommand('git', ['checkout', prBranch], repoDir);

	// Install dependencies
	log.info('Checking for dependencies to install', { repoDir });
	const installResult = await installDependencies(repoDir);
	if (installResult) {
		log.info('Dependencies installed', {
			packageManager: installResult.packageManager,
			success: installResult.success,
		});
	}

	// Run project-specific setup script if it exists
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

	return { repoDir, installResult };
}

// ============================================================================
// PR Data Formatting
// ============================================================================

type PRDetails = Awaited<ReturnType<typeof githubClient.getPR>>;
type PRComments = Awaited<ReturnType<typeof githubClient.getPRReviewComments>>;
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
// Context Building
// ============================================================================

interface ReviewContextData {
	systemPrompt: string;
	model: string;
	maxIterations: number;
	contextFiles: Awaited<ReturnType<typeof readContextFiles>>;
	prDetailsFormatted: string;
	commentsFormatted: string;
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
	log: ReturnType<typeof createAgentLogger>,
): Promise<ReviewContextData> {
	// Get system prompt and model
	const systemPrompt =
		project.prompts?.['respond-to-review'] || getSystemPrompt('respond-to-review', {});
	const model =
		project.agentModels?.review ||
		project.model ||
		config.defaults.agentModels?.review ||
		config.defaults.model;
	const maxIterations = config.defaults.agentIterations?.review || config.defaults.maxIterations;

	// Read context files
	const contextFiles = await readContextFiles(repoDir);

	// Fetch PR details, comments, and diff
	log.info('Fetching PR details, comments, and diff', { owner, repo, prNumber });
	const prDetails = await githubClient.getPR(owner, repo, prNumber);
	const prComments = await githubClient.getPRReviewComments(owner, repo, prNumber);
	const prDiff = await githubClient.getPRDiff(owner, repo, prNumber);

	// Format PR data
	const prDetailsFormatted = formatPRDetails(prDetails);
	const commentsFormatted = formatPRComments(prComments);
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

type BuilderType = ReturnType<typeof AgentBuilder.prototype.withGadgets>;

function createRespondToReviewAgentBuilder(
	client: LLMist,
	ctx: ReviewContextData,
	llmistLogger: ReturnType<typeof createLogger>,
	llmCallLogger: LLMCallLogger,
	trackingContext: TrackingContext,
): BuilderType {
	// Track LLM call timing per iteration
	const llmCallStartTimes = new Map<number, number>();

	return new AgentBuilder(client)
		.withModel(ctx.model)
		.withTemperature(0)
		.withSystem(ctx.systemPrompt)
		.withMaxIterations(ctx.maxIterations)
		.withLogger(llmistLogger)
		.withRateLimits(getRateLimitForModel(ctx.model))
		.withRetry(getRetryConfig(llmistLogger))
		.withCompaction(getCompactionConfig('respond-to-review'))
		.withTrailingMessage(getIterationTrailingMessage())
		.withHooks({
			observers: {
				// Log the exact request being sent to the LLM
				onLLMCallReady: async (context) => {
					if (context.subagentContext) return;

					// Track timing
					llmCallStartTimes.set(context.iteration, Date.now());

					// Log with estimated input tokens
					logLLMCallStart(logger, context.iteration, context.options.messages);

					// Existing file logging
					incrementLLMIteration(trackingContext);
					const callNumber = trackingContext.metrics.llmIterations;
					llmCallLogger.logRequest(callNumber, context.options.messages);
				},
				// Log the raw response from the LLM
				onLLMCallComplete: async (context) => {
					if (context.subagentContext) return;

					// Calculate duration
					const startTime = llmCallStartTimes.get(context.iteration) ?? Date.now();
					const durationMs = Date.now() - startTime;
					llmCallStartTimes.delete(context.iteration);

					// Log metrics
					if (context.usage) {
						const cost = calculateCost(ctx.model, context.usage);
						logLLMMetrics(logger, {
							model: ctx.model,
							iteration: context.iteration,
							inputTokens: context.usage.inputTokens,
							outputTokens: context.usage.outputTokens,
							cachedTokens: context.usage.cachedInputTokens ?? 0,
							durationMs,
							cost,
						});
					}

					// Existing file logging
					const callNumber = trackingContext.metrics.llmIterations;
					llmCallLogger.logResponse(callNumber, context.rawResponse);
				},
			},
		})
		.withGadgets(
			// Filesystem gadgets
			new ListDirectory(),
			new ReadFile(),
			new EditFile(),
			writeFile,
			// Shell commands via tmux
			new Tmux(),
			new Sleep(),
			// GitHub gadgets
			new GetPRDetails(),
			new GetPRComments(),
			new GetPRDiff(),
			new ReplyToReviewComment(),
		);
}

function injectReviewSyntheticCalls(
	initialBuilder: BuilderType,
	owner: string,
	repo: string,
	prNumber: number,
	ctx: ReviewContextData,
	installResult: DependencyInstallResult | null,
	trackingContext: TrackingContext,
): BuilderType {
	let builder = initialBuilder;

	// Inject directory listing as synthetic ListDirectory call (first for codebase orientation)
	// Call the actual gadget to generate output (respects .gitignore by default)
	const listDirGadget = new ListDirectory();
	const listDirParams = { directoryPath: '.', maxDepth: 3, includeGitIgnored: false };
	const listDirResult = listDirGadget.execute(listDirParams);
	recordSyntheticInvocationId(trackingContext, 'gc_dir');
	builder = builder.withSyntheticGadgetCall(
		'ListDirectory',
		listDirParams,
		listDirResult,
		'gc_dir',
	);

	// Inject PR details
	recordSyntheticInvocationId(trackingContext, 'gc_pr_details');
	builder = builder.withSyntheticGadgetCall(
		'GetPRDetails',
		{ owner, repo, prNumber },
		ctx.prDetailsFormatted,
		'gc_pr_details',
	);

	// Inject PR comments
	recordSyntheticInvocationId(trackingContext, 'gc_pr_comments');
	builder = builder.withSyntheticGadgetCall(
		'GetPRComments',
		{ owner, repo, prNumber },
		ctx.commentsFormatted,
		'gc_pr_comments',
	);

	// Inject PR diff
	recordSyntheticInvocationId(trackingContext, 'gc_pr_diff');
	builder = builder.withSyntheticGadgetCall(
		'GetPRDiff',
		{ owner, repo, prNumber },
		ctx.diffFormatted,
		'gc_pr_diff',
	);

	// Inject context files
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

	// Inject dependency install result
	if (installResult) {
		builder = injectDependencyResult(builder, installResult, trackingContext);
	}

	return builder;
}

// ============================================================================
// Review Agent Execution
// ============================================================================

export async function executeRespondToReviewAgent(
	input: RespondToReviewAgentInput,
): Promise<AgentResult> {
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
		// For review agent, we post a comment to the PR instead of attaching logs to Trello
		await githubClient.createPRComment(
			owner,
			repo,
			prNumber,
			'⚠️ Review agent timed out while addressing feedback.',
		);
		logger.info('Posted timeout notice to PR', { prNumber });
	});

	try {
		// Setup repository
		const setup = await setupRepository(project, prBranch, log);
		repoDir = setup.repoDir;

		log.info('Running review agent', { prNumber, repoFullName, repoDir });

		// Build context
		const ctx = await buildReviewContext(
			owner,
			repo,
			prNumber,
			prBranch,
			repoDir,
			project,
			config,
			log,
		);

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

			// Create tracking context for iterations and gadget calls
			const trackingContext = createTrackingContext();

			// Build agent with gadgets and synthetic calls
			let builder = createRespondToReviewAgentBuilder(
				client,
				ctx,
				llmistLogger,
				fileLogger.llmCallLogger,
				trackingContext,
			);
			builder = injectReviewSyntheticCalls(
				builder,
				owner,
				repo,
				prNumber,
				ctx,
				setup.installResult,
				trackingContext,
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

		if (repoDir) {
			try {
				cleanupTempDir(repoDir);
			} catch (err) {
				logger.warn('Failed to cleanup temp directory', { repoDir, error: String(err) });
			}
		}
		cleanupLogFile(fileLogger.logPath);
		cleanupLogFile(fileLogger.llmistLogPath);
		cleanupLogDirectory(fileLogger.llmCallLogger.logDir);
	}
}

// ============================================================================
// Helpers
// ============================================================================

function injectDependencyResult(
	builder: ReturnType<typeof AgentBuilder.prototype.withGadgets>,
	installResult: DependencyInstallResult,
	trackingContext: TrackingContext,
): ReturnType<typeof AgentBuilder.prototype.withGadgets> {
	const installOutput = installResult.success
		? `✓ Dependencies installed with ${installResult.packageManager}\n\n${installResult.output}`
		: `✗ Dependency install failed (${installResult.packageManager})\n\nError: ${installResult.error}`;

	recordSyntheticInvocationId(trackingContext, 'gc_deps');
	return builder.withSyntheticGadgetCall(
		'Tmux',
		{
			action: 'start',
			session: 'deps-install',
			command: `${installResult.packageManager} install`,
		},
		installOutput,
		'gc_deps',
	);
}
