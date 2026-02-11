import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { auList, auRead } from '@zbigniewsobiecki/au';
import { AgentBuilder, type LLMist, type createLogger } from 'llmist';

import { getCompactionConfig } from '../../config/compactionConfig.js';
import { getIterationTrailingMessage } from '../../config/hintConfig.js';
import { getRateLimitForModel } from '../../config/rateLimits.js';
import { getRetryConfig } from '../../config/retryConfig.js';
import { initSessionState } from '../../gadgets/sessionState.js';
import type { LLMCallLogger } from '../../utils/llmLogging.js';
import { type StatusUpdateHooksConfig, createObserverHooks } from '../utils/hooks.js';
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
	statusUpdate?: StatusUpdateHooksConfig;
	/** Set to true to skip calling initSessionState (review agent doesn't use it) */
	skipSessionState?: boolean;
	/** Post-configuration callback for agent-specific builder tweaks */
	postConfigure?: (builder: BuilderType) => BuilderType;
}

export function isAUEnabled(repoDir: string): boolean {
	return existsSync(join(repoDir, '.au'));
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
		repoDir,
		gadgets,
		statusUpdate,
		skipSessionState,
		postConfigure,
	} = options;

	// Initialize session state for gadgets (e.g., Finish checks PR requirement for implementation)
	if (!skipSessionState) {
		initSessionState(agentType);
	}

	// Check if AU features should be enabled (repo has .au file at root)
	const auEnabled = isAUEnabled(repoDir);
	const allGadgets = auEnabled ? [...gadgets, auList, auRead] : gadgets;

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
				statusUpdate,
			}),
		})
		.withGadgets(...allGadgets);

	if (postConfigure) {
		builder = postConfigure(builder);
	}

	return builder;
}
