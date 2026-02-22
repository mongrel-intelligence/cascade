import type { ModelSpec, createLogger } from 'llmist';

import { type ProgressMonitor, createProgressMonitor } from '../backends/progress.js';
import { CUSTOM_MODELS } from '../config/customModels.js';
import { loadPartials } from '../db/repositories/partialsRepository.js';
import { formatWorkItemData } from '../gadgets/pm/index.js';
import { type Todo, formatTodoList, initTodoSession, saveTodos } from '../gadgets/todo/storage.js';
import { getPMProvider } from '../pm/index.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { extractPRUrl } from '../utils/prUrl.js';
import { type BuilderType, createConfiguredBuilder } from './shared/builderFactory.js';
import { getAgentCapabilities } from './shared/capabilities.js';
import { buildWorkItemGadgets } from './shared/gadgets.js';
import { type FileLogger, executeAgentLifecycle } from './shared/lifecycle.js';
import { resolveModelConfig } from './shared/modelResolution.js';
import { buildPromptContext } from './shared/promptContext.js';
import { setupRepository as setupRepo } from './shared/repository.js';
import {
	injectContextFiles,
	injectDirectoryListing,
	injectSquintContext,
	injectSyntheticCall,
} from './shared/syntheticCalls.js';
import {
	buildCheckFailurePrompt,
	buildCommentResponsePrompt,
	buildDebugPrompt,
	buildWorkItemPrompt,
} from './shared/taskPrompts.js';
import type { AccumulatedLlmCall } from './utils/hooks.js';
import type { AgentLogger } from './utils/logging.js';
import type { TrackingContext } from './utils/tracking.js';

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
// Agent Context Building
// ============================================================================

interface AgentContextData {
	systemPrompt: string;
	model: string;
	maxIterations: number;
	contextFiles: Awaited<ReturnType<typeof resolveModelConfig>>['contextFiles'];
	cardData: string;
	prompt: string;
	implementationSteps?: string[];
}

export async function fetchImplementationSteps(cardId: string): Promise<string[] | undefined> {
	try {
		const provider = getPMProvider();
		const checklists = await provider.getChecklists(cardId);
		const implChecklist = checklists.find((cl) => cl.name.includes('Implementation Steps'));
		if (!implChecklist || implChecklist.items.length === 0) return undefined;
		const incompleteItems = implChecklist.items.filter((item) => !item.complete);
		return incompleteItems.length > 0 ? incompleteItems.map((item) => item.name) : undefined;
	} catch {
		return undefined;
	}
}

async function loadDbPartials(orgId: string): Promise<Map<string, string> | undefined> {
	try {
		return await loadPartials(orgId);
	} catch {
		// DB not available — fall back to disk-only partials
		return undefined;
	}
}

function selectPrompt(
	cardId: string | undefined,
	commentContext?: { text: string; author: string },
	prContext?: { prNumber: number; prBranch: string; repoFullName: string; headSha: string },
	debugContext?: {
		logDir: string;
		originalCardName: string;
		originalCardUrl: string;
		detectedAgentType: string;
	},
): string {
	if (commentContext) {
		return buildCommentResponsePrompt(cardId ?? '', commentContext.text, commentContext.author);
	}
	if (prContext) return buildCheckFailurePrompt(prContext);
	if (debugContext) return buildDebugPrompt(debugContext);
	return buildWorkItemPrompt(cardId ?? '');
}

async function buildAgentContext(
	agentType: string,
	cardId: string | undefined,
	repoDir: string,
	project: ProjectConfig,
	config: CascadeConfig,
	log: { info: (msg: string, ctx?: Record<string, unknown>) => void },
	triggerType?: string,
	prContext?: { prNumber: number; prBranch: string; repoFullName: string; headSha: string },
	debugContext?: {
		logDir: string;
		originalCardId: string;
		originalCardName: string;
		originalCardUrl: string;
		detectedAgentType: string;
	},
	modelOverride?: string,
	commentContext?: { text: string; author: string },
): Promise<AgentContextData> {
	const promptContext = buildPromptContext(cardId, project, triggerType, prContext, debugContext);
	const dbPartials = await loadDbPartials(project.orgId);

	// Some agents share model/iteration config with another agent type
	const configKeyOverrides: Record<string, string> = {
		'respond-to-planning-comment': 'planning',
	};

	const { systemPrompt, model, maxIterations, contextFiles } = await resolveModelConfig({
		agentType,
		project,
		config,
		repoDir,
		modelOverride,
		promptContext,
		configKey: configKeyOverrides[agentType],
		dbPartials,
	});

	// Pre-fetch work item data for synthetic gadget call (only if cardId exists and not debug flow)
	let cardData = '';
	if (cardId && !debugContext) {
		log.info('Fetching work item data for context', { cardId });
		cardData = await formatWorkItemData(cardId, true);
	}

	// Pre-fetch implementation steps for synthetic todo injection
	let implementationSteps: string[] | undefined;
	if (agentType === 'implementation' && cardId && !debugContext) {
		implementationSteps = await fetchImplementationSteps(cardId);
	}

	const prompt = selectPrompt(cardId, commentContext, prContext, debugContext);

	return {
		systemPrompt,
		model,
		maxIterations,
		contextFiles,
		cardData,
		prompt,
		implementationSteps,
	};
}

// ============================================================================
// Agent Builder Creation
// ============================================================================

function getBaseAgentGadgets(agentType: string) {
	return buildWorkItemGadgets(getAgentCapabilities(agentType));
}

function createAgentBuilderWithGadgets(
	client: import('llmist').LLMist,
	ctx: AgentContextData,
	llmistLogger: ReturnType<typeof createLogger>,
	trackingContext: TrackingContext,
	agentType: string,
	logWriter: (level: string, message: string, context?: Record<string, unknown>) => void,
	llmCallLogger: import('../utils/llmLogging.js').LLMCallLogger,
	repoDir: string,
	progressMonitor?: ProgressMonitor,
	remainingBudgetUsd?: number,
	llmCallAccumulator?: AccumulatedLlmCall[],
	runId?: string,
	baseBranch?: string,
): BuilderType {
	return createConfiguredBuilder({
		client,
		agentType,
		model: ctx.model,
		systemPrompt: ctx.systemPrompt,
		maxIterations: ctx.maxIterations,
		llmistLogger,
		trackingContext,
		logWriter,
		llmCallLogger,
		repoDir,
		gadgets: getBaseAgentGadgets(agentType),
		progressMonitor,
		remainingBudgetUsd,
		llmCallAccumulator,
		runId,
		baseBranch,
		// Implementation agent uses sequential execution to ensure file operations
		// are properly ordered (e.g., FileSearchAndReplace then ReadFile on same file)
		postConfigure:
			agentType === 'implementation'
				? (builder) => builder.withGadgetExecutionMode('sequential')
				: undefined,
	});
}

async function injectSyntheticCalls(
	initialBuilder: BuilderType,
	cardId: string | undefined,
	cardData: string,
	contextFiles: AgentContextData['contextFiles'],
	trackingContext: TrackingContext,
	repoDir: string,
	implementationSteps?: string[],
): Promise<BuilderType> {
	// Use maxDepth=5 to give agents better visibility into nested structures
	let builder = injectDirectoryListing(initialBuilder, trackingContext, 5);

	// Inject context files (CLAUDE.md, AGENTS.md) — conventions first
	builder = injectContextFiles(builder, trackingContext, contextFiles);

	// Inject Squint overview BEFORE card data — agent sees architectural map
	// before encountering specific file paths from the card
	builder = injectSquintContext(builder, trackingContext, repoDir);

	// Inject work item data as synthetic ReadWorkItem call (only if cardId exists)
	if (cardId && cardData) {
		builder = injectSyntheticCall(
			builder,
			trackingContext,
			'ReadWorkItem',
			{ workItemId: cardId, includeComments: true },
			cardData,
			'gc_card',
		);
	}

	// Inject pre-populated todos LAST — strongest "start coding" signal
	if (implementationSteps && implementationSteps.length > 0) {
		initTodoSession(`impl-${Date.now()}`);

		const now = new Date().toISOString();
		const todos: Todo[] = implementationSteps.map((step, i) => ({
			id: String(i + 1),
			content: step,
			status: 'pending' as const,
			createdAt: now,
			updatedAt: now,
		}));
		saveTodos(todos);

		builder = injectSyntheticCall(
			builder,
			trackingContext,
			'TodoUpsert',
			{
				items: implementationSteps.map((step) => ({ content: step })),
				comment: 'Pre-populated from Implementation Steps checklist',
			},
			`➕ Created ${todos.length} todos.\n\n${formatTodoList(todos)}`,
			'gc_todos',
		);
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
	log: AgentLogger,
	agentType: string,
	prBranch?: string,
): Promise<string> {
	if (input.logDir && typeof input.logDir === 'string') {
		log.info('Using log directory (no repo setup)', { logDir: input.logDir });
		return input.logDir;
	}

	return setupRepo({ project, log, agentType, prBranch, warmTsCache: true });
}

export async function executeAgent(
	agentType: string,
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig },
): Promise<AgentResult> {
	const { project, config, cardId, interactive, autoAccept } = input;
	const prContext = extractPRContext(input);
	const isDebugAgent = input.logDir && typeof input.logDir === 'string';

	if (!cardId && !prContext && !isDebugAgent) {
		return { success: false, output: '', error: 'No card ID or PR context provided' };
	}

	const debugCardId = isDebugAgent ? (input.originalCardId as string) : undefined;
	const identifier = getLoggerIdentifier(agentType, cardId, prContext, debugCardId);

	return executeAgentLifecycle<AgentContextData>({
		loggerIdentifier: identifier,

		onWatchdogTimeout: async (_fileLogger: FileLogger, runId?: string) => {
			if (cardId) {
				try {
					const provider = getPMProvider();
					await provider.addComment(
						cardId,
						`⏱️ Agent timed out (watchdog).${runId ? ` Run ID: ${runId}` : ''}`,
					);
					logger.info('Posted timeout comment to work item', { cardId, runId });
				} catch {
					logger.warn('Failed to post timeout comment', { cardId, runId });
				}
			}
		},

		setupRepoDir: (log) =>
			setupWorkingDirectory(input, project, log, agentType, prContext?.prBranch),

		buildContext: (repoDir, log) => {
			const debugContext = extractDebugContext(agentType, input);
			const commentContext = input.triggerCommentText
				? { text: input.triggerCommentText, author: input.triggerCommentAuthor || 'unknown' }
				: undefined;
			return buildAgentContext(
				agentType,
				cardId,
				repoDir,
				project,
				config,
				log,
				input.triggerType,
				prContext,
				debugContext,
				input.modelOverride,
				commentContext,
			);
		},

		createBuilder: ({
			client,
			ctx,
			llmistLogger,
			trackingContext,
			fileLogger,
			repoDir,
			progressMonitor,
			llmCallAccumulator,
			runId,
		}) =>
			createAgentBuilderWithGadgets(
				client,
				ctx,
				llmistLogger,
				trackingContext,
				agentType,
				fileLogger.write.bind(fileLogger),
				fileLogger.llmCallLogger,
				repoDir,
				progressMonitor ?? undefined,
				input.remainingBudgetUsd as number | undefined,
				llmCallAccumulator,
				runId,
				project.baseBranch,
			),

		injectSyntheticCalls: ({ builder, ctx, trackingContext, repoDir }) =>
			injectSyntheticCalls(
				builder,
				cardId,
				ctx.cardData,
				ctx.contextFiles,
				trackingContext,
				repoDir,
				ctx.implementationSteps,
			),

		createProgressMonitor: (fileLogger, repoDir) =>
			createProgressMonitor({
				logWriter: fileLogger.write.bind(fileLogger),
				agentType,
				taskDescription: cardId ? `Work item ${cardId}` : 'Unknown task',
				progressModel: config.defaults.progressModel,
				intervalMinutes: config.defaults.progressIntervalMinutes,
				customModels: CUSTOM_MODELS as ModelSpec[],
				repoDir,
				trello: cardId ? { cardId } : undefined,
				preSeededCommentId: input.ackCommentId as string | undefined,
			}),

		interactive,
		autoAccept,
		customModels: CUSTOM_MODELS,

		postProcess: (output) => {
			const prUrl = extractPRUrl(output);
			return prUrl ? { prUrl } : {};
		},

		runTracking: {
			projectId: project.id,
			cardId,
			prNumber: prContext?.prNumber ?? (input.prNumber as number | undefined),
			agentType,
			backendName: 'llmist',
			triggerType: input.triggerType,
		},

		squintDbUrl: project.squintDbUrl,
	});
}
