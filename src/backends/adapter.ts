import type { ModelSpec } from 'llmist';

import type { PromptContext } from '../agents/prompts/index.js';
import { resolveModelConfig } from '../agents/shared/modelResolution.js';
import { setupRepository } from '../agents/shared/repository.js';
import { createAgentLogger } from '../agents/utils/logging.js';
import { CUSTOM_MODELS } from '../config/customModels.js';
import { readCard } from '../gadgets/trello/core/readCard.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { loadCascadeEnv, unloadCascadeEnv } from '../utils/cascadeEnv.js';
import { cleanupLogDirectory, cleanupLogFile, createFileLogger } from '../utils/fileLogger.js';
import { clearWatchdogCleanup, setWatchdogCleanup } from '../utils/lifecycle.js';
import { logger } from '../utils/logging.js';
import { cleanupTempDir } from '../utils/repo.js';
import { createProgressMonitor } from './progress.js';
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
			description:
				'Create a GitHub pull request. Handles the full workflow: stages changes, commits, pushes branch to remote, and creates the PR. ALWAYS use this instead of gh pr create or manual git push. If you have already committed your changes, use --no-commit to skip the commit step.',
			cliCommand: 'cascade-tools github create-pr',
			parameters: {
				title: { type: 'string', required: true },
				body: { type: 'string', required: true },
				head: { type: 'string', required: true },
				base: { type: 'string', required: true },
				'no-commit': {
					type: 'boolean',
					description: 'Skip staging and committing (use when changes are already committed)',
				},
				draft: { type: 'boolean', description: 'Create as draft PR' },
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
	_backendName?: string,
): Promise<Omit<AgentBackendInput, 'progressReporter'>> {
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
 * Post-process a backend result: validate PR creation for implementation agents
 * and zero out cost for subscription-backed Claude Code sessions.
 */
function postProcessResult(
	result: Awaited<ReturnType<AgentBackend['execute']>>,
	agentType: string,
	backend: AgentBackend,
	input: AgentInput & { project: ProjectConfig },
	identifier: string,
): void {
	// Validate PR creation for implementation agents
	if (agentType === 'implementation' && result.success && !result.prUrl) {
		logger.warn('Implementation agent completed without creating a PR', {
			identifier,
			backend: backend.name,
		});
		result.success = false;
		result.error = 'Implementation completed but no PR was created';
	}

	// Zero out cost for subscription-backed Claude Code sessions
	if (
		backend.name === 'claude-code' &&
		input.project.agentBackend?.subscriptionCostZero === true &&
		result.cost !== undefined &&
		result.cost > 0
	) {
		logger.info('Zeroing Claude Code cost (subscription mode)', {
			originalCost: result.cost,
			project: input.project.id,
		});
		result.cost = 0;
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

		const partialInput = await buildBackendInput(
			agentType,
			input,
			repoDir,
			fileLogger,
			log,
			backend.name,
		);

		// Create a ProgressMonitor for time-based progress reporting
		const monitor = createProgressMonitor({
			logWriter: fileLogger.write.bind(fileLogger),
			agentType,
			taskDescription: cardId ? `Trello card ${cardId}` : 'Unknown task',
			progressModel: input.config.defaults.progressModel,
			intervalMinutes: input.config.defaults.progressIntervalMinutes,
			customModels: CUSTOM_MODELS as ModelSpec[],
			trello: cardId ? { cardId } : undefined,
		});

		const backendInput: AgentBackendInput = {
			...partialInput,
			progressReporter: monitor ?? {
				onIteration: async () => {},
				onToolCall: () => {},
				onText: () => {},
			},
		};

		const originalCwd = process.cwd();
		process.chdir(repoDir);

		monitor?.start();

		if (
			backend.name === 'claude-code' &&
			input.project.agentBackend?.subscriptionCostZero === true &&
			process.env.ANTHROPIC_API_KEY
		) {
			logger.warn(
				'subscriptionCostZero enabled but ANTHROPIC_API_KEY is set — API key takes priority, costs are real',
				{ project: input.project.id },
			);
		}

		try {
			const result = await backend.execute(backendInput);

			postProcessResult(result, agentType, backend, input, identifier);

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
			monitor?.stop();
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
