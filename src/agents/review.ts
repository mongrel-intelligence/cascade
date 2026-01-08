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
import { GetPRComments, GetPRDetails, ReplyToReviewComment } from '../gadgets/github/index.js';
import { Tmux } from '../gadgets/tmux.js';
import { githubClient } from '../github/client.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { cleanupLogDirectory, cleanupLogFile, createFileLogger } from '../utils/fileLogger.js';
import { clearWatchdogCleanup, setWatchdogCleanup } from '../utils/lifecycle.js';
import type { LLMCallLogger } from '../utils/llmLogging.js';
import { logger } from '../utils/logging.js';
import {
	cleanupTempDir,
	cloneRepo,
	createTempDir,
	runCommand as execCommand,
} from '../utils/repo.js';
import { getSystemPrompt } from './prompts/index.js';
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
	incrementGadgetCall,
	incrementLLMIteration,
	isSyntheticCall,
	recordSyntheticInvocationId,
} from './utils/tracking.js';

interface ReviewAgentInput extends AgentInput {
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
	const systemPrompt = project.prompts?.review || getSystemPrompt('review', {});
	const model =
		project.agentModels?.review ||
		project.model ||
		config.defaults.agentModels?.review ||
		config.defaults.model;
	const maxIterations = config.defaults.agentIterations?.review || config.defaults.maxIterations;

	// Read context files
	const contextFiles = await readContextFiles(repoDir);

	// Fetch PR details and comments
	log.info('Fetching PR details and comments', { owner, repo, prNumber });
	const prDetails = await githubClient.getPR(owner, repo, prNumber);
	const prComments = await githubClient.getPRReviewComments(owner, repo, prNumber);

	// Format PR data
	const prDetailsFormatted = formatPRDetails(prDetails);
	const commentsFormatted = formatPRComments(prComments);

	// Build prompt
	const prompt = buildReviewPrompt(prBranch, prNumber, owner, repo);

	return {
		systemPrompt,
		model,
		maxIterations,
		contextFiles,
		prDetailsFormatted,
		commentsFormatted,
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

function createReviewAgentBuilder(
	client: LLMist,
	ctx: ReviewContextData,
	llmistLogger: ReturnType<typeof createLogger>,
	llmCallLogger: LLMCallLogger,
	trackingContext: TrackingContext,
): BuilderType {
	return new AgentBuilder(client)
		.withModel(ctx.model)
		.withTemperature(0)
		.withSystem(ctx.systemPrompt)
		.withMaxIterations(ctx.maxIterations)
		.withLogger(llmistLogger)
		.withRateLimits(getRateLimitForModel(ctx.model))
		.withRetry(getRetryConfig(llmistLogger))
		.withCompaction(getCompactionConfig('review'))
		.withTrailingMessage(getIterationTrailingMessage())
		.withHooks({
			observers: {
				// Log the exact request being sent to the LLM
				onLLMCallReady: async (context) => {
					if (context.subagentContext) return;
					incrementLLMIteration(trackingContext);
					const callNumber = trackingContext.metrics.llmIterations;
					llmCallLogger.logRequest(callNumber, context.options.messages);
				},
				// Log the raw response from the LLM
				onLLMCallComplete: async (context) => {
					if (context.subagentContext) return;
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
// Agent Execution Loop
// ============================================================================

/**
 * Truncate content to first 200 + last 200 chars if it exceeds 400 chars.
 */
function truncateContent(content: string, maxLen = 400): string {
	if (content.length <= maxLen) return content;
	const halfLen = maxLen / 2;
	return `${content.slice(0, halfLen)}...[${content.length - maxLen} truncated]...${content.slice(-halfLen)}`;
}

interface AgentRunResult {
	output: string;
	iterations: number; // LLM request cycles
	gadgetCalls: number; // Non-synthetic gadget calls
	cost: number;
}

async function runAgentLoop(
	agent: ReturnType<BuilderType['ask']>,
	log: ReturnType<typeof createAgentLogger>,
	trackingContext: TrackingContext,
): Promise<AgentRunResult> {
	const outputLines: string[] = [];

	for await (const event of agent.run()) {
		if (event.type === 'text') {
			log.debug('[Text]', { content: event.content.slice(0, 100) });
			outputLines.push(event.content);
		} else if (event.type === 'gadget_call') {
			const { gadgetName, invocationId, parameters } = event.call;

			// Check if this is a synthetic call
			const isSynthetic = isSyntheticCall(invocationId, trackingContext);

			// Only count real gadget calls
			if (!isSynthetic) {
				incrementGadgetCall(trackingContext);
			}

			// Build log context with both metrics
			const logContext: Record<string, unknown> = {
				iteration: trackingContext.metrics.llmIterations,
				gadget: trackingContext.metrics.gadgetCalls,
				name: gadgetName,
				invocationId,
			};

			// Add isSynthetic flag for debugging
			if (isSynthetic) {
				logContext.isSynthetic = true;
			}

			// Add gadget-specific details
			if (gadgetName === 'Tmux' && parameters) {
				logContext.params = parameters;
			} else if (gadgetName === 'ReadFile' && parameters?.filePath) {
				logContext.path = parameters.filePath;
			} else if (gadgetName === 'WriteFile' && parameters) {
				logContext.path = parameters.filePath;
				if (parameters.content) {
					logContext.content = truncateContent(String(parameters.content));
				}
			}

			log.info('[Gadget]', logContext);
		} else if (event.type === 'gadget_result') {
			const { gadgetName, executionTimeMs, error, result } = event.result;
			const level = error ? 'error' : 'info';

			const logContext: Record<string, unknown> = {
				name: gadgetName,
				ms: executionTimeMs,
				error,
			};

			// Add truncated output for Tmux and ReadFile
			if ((gadgetName === 'Tmux' || gadgetName === 'ReadFile') && result) {
				logContext.output = truncateContent(result);
			}

			log[level]('[Gadget result]', logContext);
		} else if (event.type === 'stream_complete') {
			log.info('Stream complete', {
				iterations: trackingContext.metrics.llmIterations,
				gadgetCalls: trackingContext.metrics.gadgetCalls,
			});
		}
	}

	const cost = agent.getTree()?.getTotalCost() ?? 0;

	return {
		output: outputLines.join('\n'),
		iterations: trackingContext.metrics.llmIterations,
		gadgetCalls: trackingContext.metrics.gadgetCalls,
		cost,
	};
}

// ============================================================================
// Review Agent Execution
// ============================================================================

export async function executeReviewAgent(input: ReviewAgentInput): Promise<AgentResult> {
	const { project, config, prNumber, prBranch, repoFullName } = input;

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
			let builder = createReviewAgentBuilder(
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
			const result = await runAgentLoop(agent, log, trackingContext);

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
