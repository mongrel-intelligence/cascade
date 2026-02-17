import {
	AgentBuilder,
	BudgetPricingUnavailableError,
	type LLMist,
	type createLogger,
} from 'llmist';

import type { ProgressMonitor } from '../../backends/progressMonitor.js';
import { getCompactionConfig } from '../../config/compactionConfig.js';
import { getIterationTrailingMessage } from '../../config/hintConfig.js';
import { getRateLimitForModel } from '../../config/rateLimits.js';
import { getRetryConfig } from '../../config/retryConfig.js';
import { initSessionState } from '../../gadgets/sessionState.js';
import type { LLMCallLogger } from '../../utils/llmLogging.js';
import { resolveSquintDbPath } from '../../utils/squintDb.js';
import { type AccumulatedLlmCall, createObserverHooks } from '../utils/hooks.js';
import type { TrackingContext } from '../utils/tracking.js';

export type BuilderType = ReturnType<typeof AgentBuilder.prototype.withGadgets>;

export interface CreateBuilderOptions {
	client: LLMist;
	agentType: string;
	model: string;
	systemPrompt: string;
	maxIterations: number;
	llmistLogger: ReturnType<typeof createLogger>;
	trackingContext: TrackingContext;
	logWriter: (level: string, message: string, context?: Record<string, unknown>) => void;
	llmCallLogger: LLMCallLogger;
	repoDir: string;
	gadgets: Parameters<typeof AgentBuilder.prototype.withGadgets>;
	/** Optional progress monitor for time-based progress reporting */
	progressMonitor?: ProgressMonitor;
	/** Set to true to skip calling initSessionState (review agent doesn't use it) */
	skipSessionState?: boolean;
	/** Remaining card budget in USD — passed to llmist's withBudget() for in-flight enforcement */
	remainingBudgetUsd?: number;
	/** Post-configuration callback for agent-specific builder tweaks */
	postConfigure?: (builder: BuilderType) => BuilderType;
	/** Accumulator for per-call LLM metrics (for run tracking) */
	llmCallAccumulator?: AccumulatedLlmCall[];
}

const MAX_GADGETS_PER_RESPONSE = 25;

export function isSquintEnabled(repoDir: string): boolean {
	return resolveSquintDbPath(repoDir) !== null;
}

export function createConfiguredBuilder(options: CreateBuilderOptions): BuilderType {
	const {
		client,
		agentType,
		model,
		systemPrompt,
		maxIterations,
		llmistLogger,
		trackingContext,
		logWriter,
		llmCallLogger,
		gadgets,
		progressMonitor,
		skipSessionState,
		remainingBudgetUsd,
		postConfigure,
	} = options;

	// Initialize session state for gadgets (e.g., Finish checks PR requirement for implementation)
	if (!skipSessionState) {
		initSessionState(agentType);
	}

	let builder = new AgentBuilder(client)
		.withModel(model)
		.withTemperature(0)
		.withSystem(systemPrompt)
		.withMaxIterations(maxIterations)
		.withLogger(llmistLogger)
		.withRateLimits(getRateLimitForModel(model))
		.withRetry(getRetryConfig(llmistLogger))
		.withCompaction(getCompactionConfig(agentType))
		.withTrailingMessage(getIterationTrailingMessage(agentType))
		.withTextOnlyHandler('acknowledge')
		.withHooks({
			observers: createObserverHooks({
				model,
				logWriter,
				trackingContext,
				llmCallLogger,
				progressMonitor,
				llmCallAccumulator: options.llmCallAccumulator,
			}),
		})
		.withGadgets(...gadgets)
		.withMaxGadgetsPerResponse(MAX_GADGETS_PER_RESPONSE);

	if (remainingBudgetUsd !== undefined && remainingBudgetUsd > 0) {
		try {
			builder = builder.withBudget(remainingBudgetUsd);
		} catch (err) {
			if (err instanceof BudgetPricingUnavailableError) {
				logWriter('warn', 'Budget enforcement unavailable for model', { model });
			} else {
				throw err;
			}
		}
	}

	if (postConfigure) {
		builder = postConfigure(builder);
	}

	return builder;
}
