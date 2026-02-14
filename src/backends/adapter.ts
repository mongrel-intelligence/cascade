import type { PromptContext } from '../agents/prompts/index.js';
import { resolveModelConfig } from '../agents/shared/modelResolution.js';
import { setupRepository } from '../agents/shared/repository.js';
import { createAgentLogger } from '../agents/utils/logging.js';
import { readCard } from '../gadgets/trello/core/readCard.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { loadCascadeEnv, unloadCascadeEnv } from '../utils/cascadeEnv.js';
import { cleanupLogDirectory, cleanupLogFile, createFileLogger } from '../utils/fileLogger.js';
import { clearWatchdogCleanup, setWatchdogCleanup } from '../utils/lifecycle.js';
import { logger } from '../utils/logging.js';
import { cleanupTempDir } from '../utils/repo.js';
import { createProgressReporter } from './progress.js';
import type { AgentBackend, AgentBackendInput, ContextInjection, ToolManifest } from './types.js';

/**
 * Get the CLI tool manifests for CASCADE-specific tools.
 * These describe the tools available via cascade-tools CLI.
 */
function getToolManifests(): ToolManifest[] {
	return [
		{
			name: 'ReadTrelloCard',
			description:
				'Read a Trello card with title, description, comments, checklists, and attachments.',
			cliCommand: 'cascade-tools trello read-card',
			parameters: {
				cardId: { type: 'string', required: true },
				includeComments: { type: 'boolean', default: true },
			},
		},
		{
			name: 'PostTrelloComment',
			description: 'Post a comment to a Trello card.',
			cliCommand: 'cascade-tools trello post-comment',
			parameters: {
				cardId: { type: 'string', required: true },
				text: { type: 'string', required: true },
			},
		},
		{
			name: 'UpdateTrelloCard',
			description: 'Update a Trello card title, description, or labels.',
			cliCommand: 'cascade-tools trello update-card',
			parameters: {
				cardId: { type: 'string', required: true },
				title: { type: 'string' },
				description: { type: 'string' },
			},
		},
		{
			name: 'CreateTrelloCard',
			description: 'Create a new Trello card.',
			cliCommand: 'cascade-tools trello create-card',
			parameters: {
				listId: { type: 'string', required: true },
				title: { type: 'string', required: true },
			},
		},
		{
			name: 'ListTrelloCards',
			description: 'List all cards in a Trello list.',
			cliCommand: 'cascade-tools trello list-cards',
			parameters: { listId: { type: 'string', required: true } },
		},
		{
			name: 'AddChecklistToCard',
			description: 'Add a checklist with items to a Trello card.',
			cliCommand: 'cascade-tools trello add-checklist',
			parameters: {
				cardId: { type: 'string', required: true },
				name: { type: 'string', required: true },
				items: { type: 'array', required: true },
			},
		},
		{
			name: 'UpdateChecklistItem',
			description: 'Update a checklist item state on a Trello card.',
			cliCommand: 'cascade-tools trello update-checklist-item',
			parameters: {
				cardId: { type: 'string', required: true },
				checkItemId: { type: 'string', required: true },
				state: { type: 'string', enum: ['complete', 'incomplete'] },
			},
		},
		{
			name: 'CreatePR',
			description: 'Create a GitHub pull request with commit and push.',
			cliCommand: 'cascade-tools github create-pr',
			parameters: {
				title: { type: 'string', required: true },
				body: { type: 'string', required: true },
				head: { type: 'string', required: true },
				base: { type: 'string', required: true },
			},
		},
		{
			name: 'GetPRDetails',
			description: 'Get details about a GitHub pull request.',
			cliCommand: 'cascade-tools github get-pr-details',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
			},
		},
		{
			name: 'GetPRDiff',
			description: 'Get the unified diff of all file changes in a PR.',
			cliCommand: 'cascade-tools github get-pr-diff',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
			},
		},
		{
			name: 'GetPRChecks',
			description: 'Get CI check status for a PR.',
			cliCommand: 'cascade-tools github get-pr-checks',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
			},
		},
		{
			name: 'GetPRComments',
			description: 'Get all review comments on a PR.',
			cliCommand: 'cascade-tools github get-pr-comments',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
			},
		},
		{
			name: 'PostPRComment',
			description: 'Post a comment on a GitHub pull request.',
			cliCommand: 'cascade-tools github post-pr-comment',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
				body: { type: 'string', required: true },
			},
		},
		{
			name: 'UpdatePRComment',
			description: 'Update an existing PR comment.',
			cliCommand: 'cascade-tools github update-pr-comment',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				commentId: { type: 'number', required: true },
				body: { type: 'string', required: true },
			},
		},
		{
			name: 'ReplyToReviewComment',
			description: 'Reply to a review comment on a PR.',
			cliCommand: 'cascade-tools github reply-to-review-comment',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
				commentId: { type: 'number', required: true },
				body: { type: 'string', required: true },
			},
		},
		{
			name: 'CreatePRReview',
			description: 'Submit a code review on a PR.',
			cliCommand: 'cascade-tools github create-pr-review',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
				event: { type: 'string', required: true },
				body: { type: 'string', required: true },
			},
		},
		{
			name: 'Finish',
			description: 'Validate and signal session completion.',
			cliCommand: 'cascade-tools session finish',
			parameters: { comment: { type: 'string', required: true } },
		},
	];
}

/**
 * Pre-fetch context data (card content, etc.) for injection into agent context.
 */
async function fetchContextInjections(
	input: AgentInput,
	log: ReturnType<typeof createAgentLogger>,
): Promise<ContextInjection[]> {
	const injections: ContextInjection[] = [];
	const cardId = input.cardId;

	if (cardId && !input.logDir) {
		log.info('Fetching card data for context injection', { cardId });
		const cardData = await readCard(cardId, true);
		injections.push({
			toolName: 'ReadTrelloCard',
			params: { cardId, includeComments: true },
			result: cardData,
			description: 'Pre-fetched Trello card data',
		});
	}

	return injections;
}

/**
 * Resolve the working directory — either a pre-existing log dir or a fresh repo clone.
 */
async function resolveRepoDir(
	input: AgentInput & { project: ProjectConfig },
	log: ReturnType<typeof createAgentLogger>,
	agentType: string,
): Promise<string> {
	if (input.logDir && typeof input.logDir === 'string') {
		return input.logDir;
	}
	return setupRepository({
		project: input.project,
		log,
		agentType,
		prBranch: input.prBranch,
		warmTsCache: true,
	});
}

/**
 * Build the BackendInput by resolving model config, fetching context, etc.
 */
async function buildBackendInput(
	agentType: string,
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig },
	repoDir: string,
	fileLogger: ReturnType<typeof createFileLogger>,
	log: ReturnType<typeof createAgentLogger>,
): Promise<AgentBackendInput> {
	const { project, config, cardId } = input;

	const promptContext: PromptContext = {
		cardId,
		cardUrl: cardId ? `https://trello.com/c/${cardId}` : undefined,
		projectId: project.id,
		baseBranch: project.baseBranch,
		storiesListId: project.trello?.lists?.stories,
		processedLabelId: project.trello?.labels?.processed,
	};

	const { systemPrompt, model, maxIterations } = await resolveModelConfig({
		agentType,
		project,
		config,
		repoDir,
		promptContext,
	});

	const contextInjections = await fetchContextInjections(input, log);
	const progressReporter = createProgressReporter({
		logWriter: fileLogger.write.bind(fileLogger),
		trello: cardId ? { cardId, agentType, maxIterations } : undefined,
	});

	const cliToolsDir = new URL('../../bin', import.meta.url).pathname;

	return {
		agentType,
		project,
		config,
		repoDir,
		systemPrompt,
		taskPrompt: `Analyze and process the Trello card with ID: ${cardId || 'unknown'}. The card data has been pre-loaded.`,
		cliToolsDir,
		availableTools: getToolManifests(),
		contextInjections,
		maxIterations,
		budgetUsd: input.remainingBudgetUsd as number | undefined,
		model,
		progressReporter,
		logWriter: fileLogger.write.bind(fileLogger),
		agentInput: input,
	};
}

/**
 * Clean up temporary resources after execution.
 */
function cleanupResources(
	repoDir: string | null,
	fileLogger: ReturnType<typeof createFileLogger>,
	hasLogDir: boolean,
): void {
	clearWatchdogCleanup();

	const isLocalMode = process.env.CASCADE_LOCAL_MODE === 'true';

	if (repoDir && !isLocalMode && !hasLogDir) {
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

/**
 * Execute an agent using the given backend with full lifecycle management.
 * This handles repository setup, context fetching, logging, and cleanup.
 *
 * Used by non-llmist backends. The llmist backend wraps existing code directly.
 */
export async function executeWithBackend(
	backend: AgentBackend,
	agentType: string,
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig },
): Promise<AgentResult> {
	const { cardId } = input;
	let repoDir: string | null = null;

	const identifier = `${agentType}-${cardId || 'unknown'}`;
	const fileLogger = createFileLogger(`cascade-${identifier}`);
	const log = createAgentLogger(fileLogger);

	setWatchdogCleanup(async () => {
		fileLogger.close();
	});

	try {
		repoDir = await resolveRepoDir(input, log, agentType);
		const envSnapshot = loadCascadeEnv(repoDir, log);

		const backendInput = await buildBackendInput(agentType, input, repoDir, fileLogger, log);

		const originalCwd = process.cwd();
		process.chdir(repoDir);

		try {
			const result = await backend.execute(backendInput);

			fileLogger.close();
			const logBuffer = await fileLogger.getZippedBuffer();

			return {
				success: result.success,
				output: result.output,
				prUrl: result.prUrl,
				error: result.error,
				cost: result.cost,
				logBuffer: logBuffer ?? result.logBuffer,
			};
		} finally {
			process.chdir(originalCwd);
			unloadCascadeEnv(envSnapshot);
		}
	} catch (err) {
		logger.error('Backend execution failed', {
			identifier,
			backend: backend.name,
			error: String(err),
		});

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
		cleanupResources(repoDir, fileLogger, Boolean(input.logDir));
	}
}
