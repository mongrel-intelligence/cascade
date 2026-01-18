import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { auList, auRead } from 'au';
import { AgentBuilder, LLMist, createLogger } from 'llmist';
import { WriteFile } from '../gadgets/WriteFile.js';

import { getCompactionConfig } from '../config/compactionConfig.js';
import { CUSTOM_MODELS } from '../config/customModels.js';
import { getIterationTrailingMessage } from '../config/hintConfig.js';
import { getRateLimitForModel } from '../config/rateLimits.js';
import { getRetryConfig } from '../config/retryConfig.js';
import { EditFile } from '../gadgets/EditFile.js';
import { Finish } from '../gadgets/Finish.js';
import { ListDirectory } from '../gadgets/ListDirectory.js';
import { ReadFile } from '../gadgets/ReadFile.js';
import { Sleep } from '../gadgets/Sleep.js';
import { CreatePR } from '../gadgets/github/index.js';
import { Tmux } from '../gadgets/tmux.js';
import { TodoDelete, TodoUpdateStatus, TodoUpsert } from '../gadgets/todo/index.js';
import {
	AddChecklistToCard,
	CreateTrelloCard,
	// GetMyRecentActivity, // Temporarily disabled
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
import { logger } from '../utils/logging.js';
import { cleanupTempDir, cloneRepo, createTempDir, runCommand } from '../utils/repo.js';
import { type PromptContext, getSystemPrompt } from './prompts/index.js';
import { runAgentLoop } from './utils/agentLoop.js';
import { createObserverHooks } from './utils/hooks.js';
import { getLogLevel, readContextFiles, warmTypeScriptCache } from './utils/index.js';
import { createAgentLogger } from './utils/logging.js';
import {
	type TrackingContext,
	createTrackingContext,
	recordSyntheticInvocationId,
} from './utils/tracking.js';

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

async function setupRepository(
	project: ProjectConfig,
	log: ReturnType<typeof createAgentLogger>,
	agentType: string,
	prBranch?: string,
): Promise<string> {
	// Clone repo to temp directory
	const repoDir = createTempDir(project.id);
	cloneRepo(project, repoDir);

	// Checkout PR branch if provided (for check-failure flow)
	if (prBranch) {
		log.info('Checking out PR branch', { prBranch });
		await runCommand('git', ['checkout', prBranch], repoDir);
	}

	// Run project-specific setup script if it exists (handles dependency installation)
	const setupScriptPath = join(repoDir, '.cascade', 'setup.sh');
	if (existsSync(setupScriptPath)) {
		log.info('Running project setup script', { path: '.cascade/setup.sh', agentType });
		const setupResult = await runCommand('bash', [setupScriptPath], repoDir, {
			AGENT_PROFILE_NAME: agentType,
		});
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

	return repoDir;
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

	// Build different prompt based on flow
	let prompt: string;
	if (prContext) {
		prompt = buildCheckFailurePrompt(prContext);
	} else if (debugContext) {
		prompt = buildDebugPrompt(debugContext);
	} else {
		prompt = buildPrompt(cardId ?? '');
	}

	return { systemPrompt, model, maxIterations, contextFiles, cardData, prompt };
}

function buildPrompt(cardId: string): string {
	return `Analyze and process the Trello card with ID: ${cardId}. The card data (title, description, checklists, attachments, comments) has been pre-loaded above. Review it and proceed with your task.`;
}

function buildCheckFailurePrompt(prContext: {
	prNumber: number;
	prBranch: string;
	repoFullName: string;
	headSha: string;
}): string {
	const [owner, repo] = prContext.repoFullName.split('/');

	return `You are on branch \`${prContext.prBranch}\` for PR #${prContext.prNumber}.

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
	trackingContext: TrackingContext,
	agentType: string,
	logWriter: (level: string, message: string, context?: Record<string, unknown>) => void,
	llmCallLogger: import('../utils/llmLogging.js').LLMCallLogger,
	repoDir: string,
): BuilderType {
	// Check if AU features should be enabled (repo has .au file at root)
	const auEnabled = existsSync(join(repoDir, '.au'));

	// Planning agent is read-only - no file editing capabilities
	const isReadOnlyAgent = agentType === 'planning';

	// Build gadget list
	const baseGadgets = [
		// Filesystem gadgets (read-only for planning)
		new ListDirectory(),
		new ReadFile(),
		...(isReadOnlyAgent ? [] : [new EditFile(), new WriteFile()]),
		// Shell commands via tmux (no timeout issues)
		new Tmux(),
		new Sleep(),
		// Task tracking gadgets
		new TodoUpsert(),
		new TodoUpdateStatus(),
		new TodoDelete(),
		// GitHub gadgets (no PR creation for planning)
		...(isReadOnlyAgent ? [] : [new CreatePR()]),
		// Trello gadgets
		new ReadTrelloCard(),
		new PostTrelloComment(),
		new UpdateTrelloCard(),
		new CreateTrelloCard(),
		new ListTrelloCards(),
		// new GetMyRecentActivity(), // Temporarily disabled
		new AddChecklistToCard(),
		new UpdateChecklistItem(),
		// Session control
		new Finish(),
	];

	const allGadgets = auEnabled ? [...baseGadgets, auList, auRead] : baseGadgets;

	const builder = new AgentBuilder(client)
		.withModel(ctx.model)
		.withTemperature(0)
		.withSystem(ctx.systemPrompt)
		.withMaxIterations(ctx.maxIterations)
		.withLogger(llmistLogger)
		.withRateLimits(getRateLimitForModel(ctx.model))
		.withRetry(getRetryConfig(llmistLogger))
		.withCompaction(getCompactionConfig(agentType))
		.withTrailingMessage(getIterationTrailingMessage(agentType))
		.withTextOnlyHandler('acknowledge')
		.withHooks({
			observers: createObserverHooks({
				model: ctx.model,
				logWriter,
				trackingContext,
				llmCallLogger,
			}),
		})
		.withGadgets(...allGadgets);

	// Implementation agent uses sequential execution to ensure file operations
	// are properly ordered (e.g., EditFile then ReadFile on same file)
	if (agentType === 'implementation') {
		return builder.withGadgetExecutionMode('sequential');
	}

	return builder;
}

async function injectSyntheticCalls(
	initialBuilder: BuilderType,
	cardId: string | undefined,
	cardData: string,
	contextFiles: AgentContextData['contextFiles'],
	trackingContext: TrackingContext,
	auEnabled: boolean,
): Promise<BuilderType> {
	let builder = initialBuilder;

	// Inject directory listing as synthetic ListDirectory call (first for codebase orientation)
	// Call the actual gadget to generate output (respects .gitignore by default)
	// Use maxDepth=5 to give agents better visibility into nested structures
	const listDirGadget = new ListDirectory();
	const listDirParams = {
		comment: 'Pre-fetching codebase structure for context',
		directoryPath: '.',
		maxDepth: 5,
		includeGitIgnored: false,
	};
	const listDirResult = listDirGadget.execute(listDirParams);
	recordSyntheticInvocationId(trackingContext, 'gc_dir');
	builder = builder.withSyntheticGadgetCall(
		'ListDirectory',
		listDirParams,
		listDirResult,
		'gc_dir',
	);

	// Inject card data as synthetic ReadTrelloCard call (only if cardId exists)
	if (cardId && cardData) {
		recordSyntheticInvocationId(trackingContext, 'gc_card');
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
		const invocationId = `gc_init_${i + 1}`;
		recordSyntheticInvocationId(trackingContext, invocationId);
		builder = builder.withSyntheticGadgetCall(
			'ReadFile',
			{ comment: `Pre-fetching ${file.path} for project context`, filePath: file.path },
			file.content,
			invocationId,
		);
	}

	// Inject AU understanding if enabled (gives agent immediate codebase context)
	if (auEnabled) {
		const auListResult = (await auList.execute({
			comment: 'Pre-fetching AU entries for context',
			path: '.',
			maxDepth: 10,
		})) as string;
		// Only inject if there's actual content
		if (auListResult && !auListResult.includes('No AU entries found')) {
			recordSyntheticInvocationId(trackingContext, 'gc_au_list');
			builder = builder.withSyntheticGadgetCall(
				'AUList',
				{ comment: 'Pre-fetching AU entries for context', path: '.', maxDepth: 10 },
				auListResult,
				'gc_au_list',
			);

			// Also inject root-level understanding for high-level context
			const auReadResult = (await auRead.execute({
				comment: 'Pre-fetching root-level understanding',
				paths: '.',
			})) as string;
			if (auReadResult && !auReadResult.includes('No understanding exists yet')) {
				recordSyntheticInvocationId(trackingContext, 'gc_au_read');
				builder = builder.withSyntheticGadgetCall(
					'AURead',
					{ comment: 'Pre-fetching root-level understanding', paths: '.' },
					auReadResult,
					'gc_au_read',
				);
			}
		}
	}

	return builder;
}

// ============================================================================
// Agent Execution
// ============================================================================

interface PRContext {
	prNumber: number;
	prBranch: string;
	repoFullName: string;
	headSha: string;
}

function extractPRContext(input: AgentInput): PRContext | undefined {
	if (input.triggerType !== 'check-failure') return undefined;
	return {
		prNumber: input.prNumber as number,
		prBranch: input.prBranch as string,
		repoFullName: input.repoFullName as string,
		headSha: input.headSha as string,
	};
}

function extractDebugContext(agentType: string, input: AgentInput) {
	if (agentType !== 'debug' || !input.logDir) return undefined;
	return {
		logDir: input.logDir,
		originalCardId: input.originalCardId as string,
		originalCardName: input.originalCardName as string,
		originalCardUrl: input.originalCardUrl as string,
		detectedAgentType: input.detectedAgentType as string,
	};
}

function getLoggerIdentifier(
	agentType: string,
	cardId: string | undefined,
	prContext: PRContext | undefined,
	debugCardId: string | undefined,
): string {
	if (prContext) return `${agentType}-pr${prContext.prNumber}`;
	return `${agentType}-${cardId || debugCardId}`;
}

async function setupWorkingDirectory(
	input: AgentInput,
	project: ProjectConfig,
	log: ReturnType<typeof createAgentLogger>,
	agentType: string,
	prBranch?: string,
): Promise<string> {
	if (input.logDir && typeof input.logDir === 'string') {
		log.info('Using log directory (no repo setup)', { logDir: input.logDir });
		return input.logDir;
	}

	return setupRepository(project, log, agentType, prBranch);
}

function extractPRUrl(output: string): string | undefined {
	const match = output.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
	return match ? match[0] : undefined;
}

export async function executeAgent(
	agentType: string,
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig },
): Promise<AgentResult> {
	const { project, config, cardId, interactive } = input;
	const prContext = extractPRContext(input);
	const isDebugAgent = input.logDir && typeof input.logDir === 'string';

	if (!cardId && !prContext && !isDebugAgent) {
		return { success: false, output: '', error: 'No card ID or PR context provided' };
	}

	let repoDir: string | null = null;
	const debugCardId = isDebugAgent ? (input.originalCardId as string) : undefined;
	const identifier = getLoggerIdentifier(agentType, cardId, prContext, debugCardId);
	const fileLogger = createFileLogger(`cascade-${identifier}`);
	const log = createAgentLogger(fileLogger);

	setWatchdogCleanup(async () => {
		fileLogger.close();
		if (cardId) {
			const logBuffer = await fileLogger.getZippedBuffer();
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const logName = `${agentType}-timeout-${timestamp}.zip`;
			await trelloClient.addAttachmentFile(cardId, logBuffer, logName);
			logger.info('Uploaded timeout log to card', { cardId, logName });
		}
	});

	try {
		repoDir = await setupWorkingDirectory(input, project, log, agentType, prContext?.prBranch);

		log.info('Running agent', {
			agentType,
			cardId,
			prNumber: prContext?.prNumber,
			prBranch: prContext?.prBranch,
			repoDir,
		});

		const debugContext = extractDebugContext(agentType, input);
		const ctx = await buildAgentContext(
			agentType,
			cardId,
			repoDir,
			project,
			config,
			log,
			input.triggerType,
			prContext,
			debugContext,
		);

		const originalCwd = process.cwd();
		process.chdir(repoDir);

		log.info('Starting llmist agent', {
			model: ctx.model,
			maxIterations: ctx.maxIterations,
			promptLength: ctx.prompt.length,
		});

		try {
			process.env.LLMIST_LOG_FILE = fileLogger.llmistLogPath;
			const client = new LLMist({ customModels: CUSTOM_MODELS });
			const llmistLogger = createLogger({ minLevel: getLogLevel() });
			const trackingContext = createTrackingContext();

			// Check if AU features should be enabled (repo has .au file at root)
			const auEnabled = existsSync(join(repoDir, '.au'));

			let builder = createAgentBuilderWithGadgets(
				client,
				ctx,
				llmistLogger,
				trackingContext,
				agentType,
				fileLogger.write.bind(fileLogger),
				fileLogger.llmCallLogger,
				repoDir,
			);
			builder = await injectSyntheticCalls(
				builder,
				cardId,
				ctx.cardData,
				ctx.contextFiles,
				trackingContext,
				auEnabled,
			);

			const agent = builder.ask(ctx.prompt);
			const result = await runAgentLoop(agent, log, trackingContext, interactive === true);

			log.info('Agent completed', {
				cardId,
				iterations: result.iterations,
				gadgetCalls: result.gadgetCalls,
				cost: result.cost,
			});

			const prUrl = extractPRUrl(result.output);
			if (prUrl) log.info('PR URL extracted', { prUrl });

			fileLogger.close();
			const logBuffer = await fileLogger.getZippedBuffer();

			return { success: true, output: result.output, prUrl, logBuffer, cost: result.cost };
		} finally {
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

		// Skip cleanup in local mode to preserve logs for debugging
		const isLocalMode = process.env.CASCADE_LOCAL_MODE === 'true';

		// Cleanup temp directory
		if (repoDir && !isLocalMode) {
			try {
				cleanupTempDir(repoDir);
			} catch (err) {
				logger.warn('Failed to cleanup temp directory', { repoDir, error: String(err) });
			}
		}
		// Cleanup log files (buffer already extracted)
		if (!isLocalMode) {
			cleanupLogFile(fileLogger.logPath);
			cleanupLogFile(fileLogger.llmistLogPath);
			cleanupLogDirectory(fileLogger.llmCallLogger.logDir);
		}
	}
}
