import { listDirectory, writeFile } from '@llmist/cli/gadgets';
import { AgentBuilder, LLMist, createLogger } from 'llmist';

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
	generateDirectoryListing,
	getLogLevel,
	installDependencies,
	readContextFiles,
	startPostgres,
} from './utils/index.js';
import { createAgentLogger } from './utils/logging.js';

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
	// Start PostgreSQL if available (for local database testing)
	await startPostgres();

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
	const directoryListing = await generateDirectoryListing(repoDir, 3);
	const prompt = buildReviewPrompt(directoryListing, prBranch, prNumber, owner, repo);

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
	directoryListing: string | null,
	prBranch: string,
	prNumber: number,
	owner: string,
	repo: string,
): string {
	const directorySection = directoryListing
		? `Here is the codebase directory structure:

<codebase_structure>
${directoryListing}
</codebase_structure>

`
		: '';

	return `${directorySection}You are on the branch \`${prBranch}\` for PR #${prNumber}.

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
): BuilderType {
	let llmCallCounter = 0;

	return new AgentBuilder(client)
		.withModel(ctx.model)
		.withTemperature(0)
		.withSystem(ctx.systemPrompt)
		.withMaxIterations(ctx.maxIterations)
		.withLogger(llmistLogger)
		.withHooks({
			observers: {
				// Log the exact request being sent to the LLM
				onLLMCallReady: async (context) => {
					if (context.subagentContext) return;
					llmCallCounter++;
					llmCallLogger.logRequest(llmCallCounter, context.options.messages);
				},
				// Log the raw response from the LLM
				onLLMCallComplete: async (context) => {
					if (context.subagentContext) return;
					llmCallLogger.logResponse(llmCallCounter, context.rawResponse);
				},
			},
		})
		.withGadgets(
			// Filesystem gadgets
			listDirectory,
			new ReadFile(),
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
): BuilderType {
	// Inject PR details
	let builder = initialBuilder.withSyntheticGadgetCall(
		'GetPRDetails',
		{ owner, repo, prNumber },
		ctx.prDetailsFormatted,
		'gc_pr_details',
	);

	// Inject PR comments
	builder = builder.withSyntheticGadgetCall(
		'GetPRComments',
		{ owner, repo, prNumber },
		ctx.commentsFormatted,
		'gc_pr_comments',
	);

	// Inject context files
	for (let i = 0; i < ctx.contextFiles.length; i++) {
		const file = ctx.contextFiles[i];
		builder = builder.withSyntheticGadgetCall(
			'ReadFile',
			{ filePath: file.path },
			file.content,
			`gc_init_${i + 1}`,
		);
	}

	// Inject dependency install result
	if (installResult) {
		builder = injectDependencyResult(builder, installResult);
	}

	return builder;
}

// ============================================================================
// Agent Execution Loop
// ============================================================================

interface AgentRunResult {
	output: string;
	iterationCount: number;
	cost: number;
}

async function runAgentLoop(
	agent: ReturnType<BuilderType['ask']>,
	log: ReturnType<typeof createAgentLogger>,
): Promise<AgentRunResult> {
	const outputLines: string[] = [];
	let iterationCount = 0;

	for await (const event of agent.run()) {
		if (event.type === 'text') {
			log.debug('[Text]', { content: event.content.slice(0, 100) });
			outputLines.push(event.content);
		} else if (event.type === 'gadget_call') {
			iterationCount++;
			log.info('[Gadget]', {
				iteration: iterationCount,
				name: event.call.gadgetName,
				invocationId: event.call.invocationId,
			});
		} else if (event.type === 'gadget_result') {
			const level = event.result.error ? 'error' : 'info';
			log[level]('[Gadget result]', {
				name: event.result.gadgetName,
				ms: event.result.executionTimeMs,
				error: event.result.error,
			});
		} else if (event.type === 'stream_complete') {
			log.info('Stream complete', { iteration: iterationCount });
		}
	}

	const cost = agent.getTree()?.getTotalCost() ?? 0;

	return {
		output: outputLines.join('\n'),
		iterationCount,
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

			// Build agent with gadgets and synthetic calls
			let builder = createReviewAgentBuilder(client, ctx, llmistLogger, fileLogger.llmCallLogger);
			builder = injectReviewSyntheticCalls(
				builder,
				owner,
				repo,
				prNumber,
				ctx,
				setup.installResult,
			);

			// Run the agent
			const agent = builder.ask(ctx.prompt);
			const result = await runAgentLoop(agent, log);

			log.info('Review agent completed', {
				prNumber,
				iterations: result.iterationCount,
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
): ReturnType<typeof AgentBuilder.prototype.withGadgets> {
	const installOutput = installResult.success
		? `✓ Dependencies installed with ${installResult.packageManager}\n\n${installResult.output}`
		: `✗ Dependency install failed (${installResult.packageManager})\n\nError: ${installResult.error}`;

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
