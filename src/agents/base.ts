import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { listDirectory, writeFile } from '@llmist/cli/gadgets';
import { AgentBuilder, LLMist, createLogger } from 'llmist';

import { EditFile } from '../gadgets/EditFile.js';
import { ReadFile } from '../gadgets/ReadFile.js';
import { Sleep } from '../gadgets/Sleep.js';
import { Tmux } from '../gadgets/tmux.js';
import {
	AddChecklistToCard,
	CreateTrelloCard,
	GetMyRecentActivity,
	ListTrelloCards,
	PostTrelloComment,
	ReadTrelloCard,
	UpdateChecklistItem,
	UpdateTrelloCard,
	formatCardData,
} from '../gadgets/trello/index.js';
import { trelloClient } from '../trello/client.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { cleanupLogDirectory, cleanupLogFile, createFileLogger } from '../utils/fileLogger.js';
import { clearWatchdogCleanup, setWatchdogCleanup } from '../utils/lifecycle.js';
import type { LLMCallLogger } from '../utils/llmLogging.js';
import { logger } from '../utils/logging.js';
import { cleanupTempDir, cloneRepo, createTempDir, runCommand } from '../utils/repo.js';
import { type PromptContext, getSystemPrompt } from './prompts/index.js';
import {
	type DependencyInstallResult,
	generateDirectoryListing,
	getLogLevel,
	installDependencies,
	readContextFiles,
	warmTypeScriptCache,
} from './utils/index.js';
import { createAgentLogger } from './utils/logging.js';

export interface AgentContext {
	project: ProjectConfig;
	config: CascadeConfig;
	cardId: string;
	repoDir: string;
}

export interface AgentRunner {
	name: string;
	run: (ctx: AgentContext) => Promise<AgentResult>;
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
	log: ReturnType<typeof createAgentLogger>,
	prBranch?: string,
): Promise<RepoSetupResult> {
	// Clone repo to temp directory
	const repoDir = createTempDir(project.id);
	cloneRepo(project, repoDir);

	// Checkout PR branch if provided (for check-failure flow)
	if (prBranch) {
		log.info('Checking out PR branch', { prBranch });
		await runCommand('git', ['checkout', prBranch], repoDir);
	}

	// Install dependencies if package.json exists
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
		const setupResult = await runCommand('bash', [setupScriptPath], repoDir);
		log.info('Setup script completed', {
			exitCode: setupResult.exitCode,
			stdout: setupResult.stdout.slice(-500),
			stderr: setupResult.stderr.slice(-500),
		});
		if (setupResult.exitCode !== 0) {
			log.warn('Setup script exited with non-zero code', { exitCode: setupResult.exitCode });
		}
	}

	// Warm TypeScript cache to avoid slow first-run compilation during agent execution
	log.info('Warming TypeScript cache', { repoDir });
	const tscResult = await warmTypeScriptCache(repoDir);
	if (tscResult) {
		log.info('TypeScript cache warmed', {
			durationMs: tscResult.durationMs,
			hadErrors: !!tscResult.error,
		});
	}

	return { repoDir, installResult };
}

// ============================================================================
// Agent Context Building
// ============================================================================

interface AgentContextData {
	systemPrompt: string;
	model: string;
	maxIterations: number;
	contextFiles: Awaited<ReturnType<typeof readContextFiles>>;
	cardData: string;
	prompt: string;
}

async function buildAgentContext(
	agentType: string,
	cardId: string | undefined,
	repoDir: string,
	project: ProjectConfig,
	config: CascadeConfig,
	log: ReturnType<typeof createAgentLogger>,
	triggerType?: string,
	prContext?: { prNumber: number; prBranch: string; repoFullName: string; headSha: string },
	debugContext?: {
		logDir: string;
		originalCardId: string;
		originalCardName: string;
		originalCardUrl: string;
		detectedAgentType: string;
	},
): Promise<AgentContextData> {
	// Build prompt context for template rendering
	const promptContext: PromptContext = {
		cardId,
		cardUrl: cardId ? `https://trello.com/c/${cardId}` : undefined,
		projectId: project.id,
		storiesListId: project.trello?.lists?.stories,
		processedLabelId: project.trello?.labels?.processed,
		...(prContext && {
			prNumber: prContext.prNumber,
			prBranch: prContext.prBranch,
			repoFullName: prContext.repoFullName,
			headSha: prContext.headSha,
			triggerType,
		}),
		...(debugContext && {
			logDir: debugContext.logDir,
			originalCardId: debugContext.originalCardId,
			originalCardName: debugContext.originalCardName,
			originalCardUrl: debugContext.originalCardUrl,
			detectedAgentType: debugContext.detectedAgentType,
			debugListId: project.trello?.lists?.debug,
		}),
	};

	// Get system prompt and model
	const systemPrompt = project.prompts?.[agentType] || getSystemPrompt(agentType, promptContext);
	const model =
		project.agentModels?.[agentType] ||
		project.model ||
		config.defaults.agentModels?.[agentType] ||
		config.defaults.model;
	const maxIterations =
		config.defaults.agentIterations?.[agentType] || config.defaults.maxIterations;

	// Read context files (CLAUDE.md, AGENTS.md) for synthetic gadget calls
	const contextFiles = await readContextFiles(repoDir);

	// Pre-fetch card data for synthetic gadget call (only if cardId exists and not debug flow)
	let cardData = '';
	if (cardId && !debugContext) {
		log.info('Fetching card data for context', { cardId });
		cardData = await formatCardData(cardId, true);
	}

	// Generate directory listing for codebase context
	const directoryListing = await generateDirectoryListing(repoDir, 3);

	// Build different prompt based on flow
	let prompt: string;
	if (prContext) {
		prompt = buildCheckFailurePrompt(directoryListing, prContext);
	} else if (debugContext) {
		prompt = buildDebugPrompt(debugContext);
	} else {
		prompt = buildPrompt(directoryListing, cardId ?? '');
	}

	return { systemPrompt, model, maxIterations, contextFiles, cardData, prompt };
}

function buildPrompt(directoryListing: string | null, cardId: string): string {
	const directorySection = directoryListing
		? `Here is the codebase directory structure (pre-populated for context):

<codebase_structure>
${directoryListing}
</codebase_structure>

`
		: '';

	return `${directorySection}Analyze and process the Trello card with ID: ${cardId}. The card data (title, description, checklists, attachments, comments) has been pre-loaded above. Review it and proceed with your task.`;
}

function buildCheckFailurePrompt(
	directoryListing: string | null,
	prContext: { prNumber: number; prBranch: string; repoFullName: string; headSha: string },
): string {
	const [owner, repo] = prContext.repoFullName.split('/');
	const directorySection = directoryListing
		? `Here is the codebase directory structure:

<codebase_structure>
${directoryListing}
</codebase_structure>

`
		: '';

	return `${directorySection}You are on branch \`${prContext.prBranch}\` for PR #${prContext.prNumber}.

Your task is to fix the failing checks and push your changes.

## Instructions

1. **Investigate failures**: Use Tmux to run:
   \`gh run list --branch ${prContext.prBranch} --limit 5 --json databaseId,conclusion,status,workflowName\`

2. **Get failure details**: Find failed run ID and run:
   \`gh run view <run-id> --log-failed\`

3. **Analyze error types**:
   - Lint errors: Run \`npm run lint\` or \`pnpm run lint\`
   - Type errors: Run \`npm run typecheck\`
   - Test failures: Run \`npm test\`
   - Build errors: Run \`npm run build\`

4. **Fix issues**: Make targeted fixes following existing codebase patterns

5. **Verify locally**: Run the same checks that failed in CI before pushing

6. **Commit and push**:
   \`\`\`bash
   git add .
   git commit -m "fix: address failing checks"
   git push
   \`\`\`

The push will re-trigger checks automatically.

## GitHub Context
Owner: ${owner}
Repo: ${repo}
PR: #${prContext.prNumber}
Branch: ${prContext.prBranch}`;
}

function buildDebugPrompt(debugContext: {
	logDir: string;
	originalCardName: string;
	originalCardUrl: string;
	detectedAgentType: string;
}): string {
	return `Analyze the ${debugContext.detectedAgentType} agent session logs in directory: ${debugContext.logDir}

Original card: "${debugContext.originalCardName}"
Link: ${debugContext.originalCardUrl}

Start by listing the contents of the log directory, then read and analyze the logs to identify issues.`;
}

// ============================================================================
// Agent Builder Creation
// ============================================================================

type BuilderType = ReturnType<typeof AgentBuilder.prototype.withGadgets>;

function createAgentBuilderWithGadgets(
	client: LLMist,
	ctx: AgentContextData,
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
			new EditFile(),
			writeFile,
			// Shell commands via tmux (no timeout issues)
			new Tmux(),
			new Sleep(),
			// Trello gadgets
			new ReadTrelloCard(),
			new PostTrelloComment(),
			new UpdateTrelloCard(),
			new CreateTrelloCard(),
			new ListTrelloCards(),
			new GetMyRecentActivity(),
			new AddChecklistToCard(),
			new UpdateChecklistItem(),
		);
}

function injectSyntheticCalls(
	initialBuilder: BuilderType,
	cardId: string | undefined,
	cardData: string,
	contextFiles: AgentContextData['contextFiles'],
	installResult: DependencyInstallResult | null,
): BuilderType {
	let builder = initialBuilder;

	// Inject card data as synthetic ReadTrelloCard call (only if cardId exists)
	if (cardId && cardData) {
		builder = builder.withSyntheticGadgetCall(
			'ReadTrelloCard',
			{ cardId, includeComments: true },
			cardData,
			'gc_card',
		);
	}

	// Inject context files as synthetic ReadFile gadget calls
	for (let i = 0; i < contextFiles.length; i++) {
		const file = contextFiles[i];
		builder = builder.withSyntheticGadgetCall(
			'ReadFile',
			{ filePath: file.path },
			file.content,
			`gc_init_${i + 1}`,
		);
	}

	// Inject dependency install result as synthetic Tmux call
	if (installResult) {
		builder = injectDependencyResult(builder, installResult);
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
			const { gadgetName, invocationId, parameters } = event.call;

			// Build log context with gadget-specific details
			const logContext: Record<string, unknown> = {
				iteration: iterationCount,
				name: gadgetName,
				invocationId,
			};

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
// Agent Execution
// ============================================================================

export async function executeAgent(
	agentType: string,
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig },
): Promise<AgentResult> {
	const { project, config, cardId, triggerType } = input;

	// Extract PR context if this is check-failure flow
	const prContext =
		triggerType === 'check-failure'
			? {
					prNumber: input.prNumber as number,
					prBranch: input.prBranch as string,
					repoFullName: input.repoFullName as string,
					headSha: input.headSha as string,
				}
			: undefined;

	// cardId is optional for check-failure and debug flows
	const isDebugAgent = input.logDir && typeof input.logDir === 'string';
	if (!cardId && !prContext && !isDebugAgent) {
		return { success: false, output: '', error: 'No card ID or PR context provided' };
	}

	let repoDir: string | null = null;

	// Create file logger - use PR number for check-failure, originalCardId for debug, cardId for features
	const debugCardId = isDebugAgent ? (input.originalCardId as string) : undefined;
	const identifier = prContext
		? `${agentType}-pr${prContext.prNumber}`
		: `${agentType}-${cardId || debugCardId}`;
	const fileLogger = createFileLogger(`cascade-${identifier}`);
	const log = createAgentLogger(fileLogger);

	// Register cleanup callback for watchdog timeout (upload logs before force exit)
	setWatchdogCleanup(async () => {
		fileLogger.close();
		// Only upload to Trello if we have a cardId
		if (cardId) {
			const logBuffer = await fileLogger.getZippedBuffer();
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const logName = `${agentType}-timeout-${timestamp}.zip`;
			await trelloClient.addAttachmentFile(cardId, logBuffer, logName);
			logger.info('Uploaded timeout log to card', { cardId, logName });
		}
	});

	try {
		let installResult: DependencyInstallResult | null = null;

		// Check if this is debug agent with pre-extracted logs
		if (input.logDir && typeof input.logDir === 'string') {
			// Debug agent: use log directory instead of repo
			repoDir = input.logDir;
			log.info('Using log directory (no repo setup)', { logDir: input.logDir, agentType });
		} else {
			// Normal agents: setup repository (checkout PR branch if provided)
			const setup = await setupRepository(project, log, prContext?.prBranch);
			repoDir = setup.repoDir;
			installResult = setup.installResult;
		}

		log.info('Running agent', {
			agentType,
			cardId,
			prNumber: prContext?.prNumber,
			prBranch: prContext?.prBranch,
			repoDir,
		});

		// Extract debug context if this is debug agent
		const debugContext =
			agentType === 'debug' && input.logDir
				? {
						logDir: input.logDir,
						originalCardId: input.originalCardId as string,
						originalCardName: input.originalCardName as string,
						originalCardUrl: input.originalCardUrl as string,
						detectedAgentType: input.detectedAgentType as string,
					}
				: undefined;

		// Build agent context (with PR context if check-failure flow, or debug context if debug agent)
		const ctx = await buildAgentContext(
			agentType,
			cardId,
			repoDir,
			project,
			config,
			log,
			triggerType,
			prContext,
			debugContext,
		);

		// Change to repo directory (llmist gadgets use process.cwd() for path validation)
		const originalCwd = process.cwd();
		process.chdir(repoDir);

		log.info('Starting llmist agent', {
			model: ctx.model,
			maxIterations: ctx.maxIterations,
			promptLength: ctx.prompt.length,
		});

		try {
			// Configure llmist to write to separate log file for better debugging
			process.env.LLMIST_LOG_FILE = fileLogger.llmistLogPath;

			// Create llmist client and logger
			const client = new LLMist();
			const llmistLogger = createLogger({ minLevel: getLogLevel() });

			// Build the agent with gadgets and synthetic calls
			let builder = createAgentBuilderWithGadgets(
				client,
				ctx,
				llmistLogger,
				fileLogger.llmCallLogger,
			);
			builder = injectSyntheticCalls(
				builder,
				cardId,
				ctx.cardData,
				ctx.contextFiles,
				installResult,
			);

			// Run the agent
			const agent = builder.ask(ctx.prompt);
			const result = await runAgentLoop(agent, log);

			log.info('Agent completed', { cardId, iterations: result.iterationCount, cost: result.cost });

			// Extract PR URL from output (gh pr create outputs the URL)
			const prUrlMatch = result.output.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
			const prUrl = prUrlMatch ? prUrlMatch[0] : undefined;
			if (prUrl) {
				log.info('PR URL extracted', { prUrl });
			}

			// Get zipped log buffer before returning
			fileLogger.close();
			const logBuffer = await fileLogger.getZippedBuffer();

			return {
				success: true,
				output: result.output,
				prUrl,
				logBuffer,
				cost: result.cost,
			};
		} finally {
			// Restore original working directory
			process.chdir(originalCwd);
		}
	} catch (err) {
		logger.error('Agent execution failed', { agentType, error: String(err) });

		// Get zipped log buffer before returning (if logger exists)
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
		// Clear watchdog cleanup callback (no longer needed)
		clearWatchdogCleanup();

		// Cleanup temp directory
		if (repoDir) {
			try {
				cleanupTempDir(repoDir);
			} catch (err) {
				logger.warn('Failed to cleanup temp directory', { repoDir, error: String(err) });
			}
		}
		// Cleanup log files (buffer already extracted)
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
