import type { LLMist, createLogger } from 'llmist';

import type { ProgressMonitor } from '../../backends/progressMonitor.js';
import type { LLMCallLogger } from '../../utils/llmLogging.js';
import type { AccumulatedLlmCall } from '../utils/hooks.js';
import type { TrackingContext } from '../utils/tracking.js';
import { type BuilderType, createConfiguredBuilder } from './builderFactory.js';
import { getAgentCapabilities } from './capabilities.js';
import { buildWorkItemGadgets } from './gadgets.js';
import {
	injectContextFiles,
	injectDirectoryListing,
	injectSquintContext,
	injectSyntheticCall,
} from './syntheticCalls.js';
import type { AgentContextData } from './workItemContext.js';

import {
	type Todo,
	formatTodoList,
	initTodoSession,
	saveTodos,
} from '../../gadgets/todo/storage.js';

// ============================================================================
// Gadget Helpers
// ============================================================================

export function getBaseAgentGadgets(agentType: string) {
	return buildWorkItemGadgets(getAgentCapabilities(agentType));
}

// ============================================================================
// Builder Creation
// ============================================================================

export interface CreateWorkItemAgentBuilderParams {
	client: LLMist;
	ctx: AgentContextData;
	llmistLogger: ReturnType<typeof createLogger>;
	trackingContext: TrackingContext;
	agentType: string;
	logWriter: (level: string, message: string, context?: Record<string, unknown>) => void;
	llmCallLogger: LLMCallLogger;
	repoDir: string;
	progressMonitor?: ProgressMonitor;
	remainingBudgetUsd?: number;
	llmCallAccumulator?: AccumulatedLlmCall[];
	runId?: string;
	baseBranch?: string;
	projectId?: string;
	cardId?: string;
}

export function createWorkItemAgentBuilder(params: CreateWorkItemAgentBuilderParams): BuilderType {
	const {
		client,
		ctx,
		llmistLogger,
		trackingContext,
		agentType,
		logWriter,
		llmCallLogger,
		repoDir,
		progressMonitor,
		remainingBudgetUsd,
		llmCallAccumulator,
		runId,
		baseBranch,
		projectId,
		cardId,
	} = params;

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
		projectId,
		cardId,
		// Implementation agent uses sequential execution to ensure file operations
		// are properly ordered (e.g., FileSearchAndReplace then ReadFile on same file)
		postConfigure:
			agentType === 'implementation'
				? (builder) => builder.withGadgetExecutionMode('sequential')
				: undefined,
	});
}

// ============================================================================
// Synthetic Call Injection
// ============================================================================

export async function injectWorkItemSyntheticCalls(
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
