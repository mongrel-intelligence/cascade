import { execSync } from 'node:child_process';
import {
	AgentBuilder,
	BudgetPricingUnavailableError,
	type LLMist,
	type createLogger,
} from 'llmist';

import { getCompactionConfig } from '../../config/compactionConfig.js';
import { getIterationTrailingMessage } from '../../config/hintConfig.js';
import { getRateLimitForModel } from '../../config/rateLimits.js';
import { getRetryConfig } from '../../config/retryConfig.js';
import { type SessionHooks, initSessionState, setReadOnlyFs } from '../../gadgets/sessionState.js';
import type { LLMCallLogger } from '../../utils/llmLogging.js';
import { resolveSquintDbPath } from '../../utils/squintDb.js';
import type { IProgressMonitor } from '../contracts/index.js';
import { getAgentCapabilities } from '../shared/capabilities.js';
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
	progressMonitor?: IProgressMonitor;
	/** Skip session state initialization and capability checks. No current callers use this flag. */
	skipSessionState?: boolean;
	/** Remaining card budget in USD — passed to llmist's withBudget() for in-flight enforcement */
	remainingBudgetUsd?: number;
	/** Accumulator for per-call LLM metrics (for run tracking) */
	llmCallAccumulator?: AccumulatedLlmCall[];
	/** Run ID for real-time LLM call logging (resolved before builder creation) */
	runId?: string;
	/** Base branch for PR creation (e.g. 'main', 'dev'). Passed to session state. */
	baseBranch?: string;
	/** Project ID for PR ↔ work item linking. Passed to session state. */
	projectId?: string;
	/** Work item (card) ID for PR ↔ work item linking. Passed to session state. */
	cardId?: string;
	/** Work item URL for PR ↔ work item enrichment. Passed to session state. */
	workItemUrl?: string;
	/** Work item display title for PR ↔ work item enrichment. Passed to session state. */
	workItemTitle?: string;
	/** Resolved SCM hook flags for finish validation (requiresPR, requiresReview, etc.) */
	hooks?: SessionHooks;
}

const MAX_GADGETS_PER_RESPONSE = 25;

export function isSquintEnabled(repoDir: string): boolean {
	return resolveSquintDbPath(repoDir) !== null;
}

export async function createConfiguredBuilder(options: CreateBuilderOptions): Promise<BuilderType> {
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
	} = options;

	// Initialize session state for gadgets (e.g., Finish checks PR requirement for implementation)
	if (!skipSessionState) {
		let initialHeadSha: string | undefined;
		try {
			initialHeadSha = execSync('git rev-parse HEAD', {
				encoding: 'utf-8',
				cwd: options.repoDir,
			}).trim();
		} catch {
			// Not in a git repo or git not available — leave undefined
		}

		initSessionState({
			agentType,
			baseBranch: options.baseBranch,
			projectId: options.projectId,
			cardId: options.cardId,
			hooks: options.hooks,
			workItemUrl: options.workItemUrl,
			workItemTitle: options.workItemTitle,
			initialHeadSha,
		});

		// Mark session as read-only if agent lacks fs:write capability
		const caps = await getAgentCapabilities(agentType);
		if (caps.isReadOnly) {
			setReadOnlyFs(true);
		}
	}

	// Resolve config values before building
	const compactionConfig = getCompactionConfig();
	const trailingMessage = await getIterationTrailingMessage(agentType);

	let builder = new AgentBuilder(client)
		.withModel(model)
		.withTemperature(0)
		.withSystem(systemPrompt)
		.withMaxIterations(maxIterations)
		.withLogger(llmistLogger)
		.withRateLimits(getRateLimitForModel(model))
		.withRetry(getRetryConfig(llmistLogger))
		.withCompaction(compactionConfig)
		.withTrailingMessage(trailingMessage)
		.withTextOnlyHandler('acknowledge')
		.withHooks({
			observers: createObserverHooks({
				model,
				logWriter,
				trackingContext,
				llmCallLogger,
				progressMonitor,
				llmCallAccumulator: options.llmCallAccumulator,
				runId: options.runId,
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

	builder = builder.withGadgetExecutionMode('sequential');

	return builder;
}
