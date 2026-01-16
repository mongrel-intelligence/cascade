import type { CompactionConfig, CompactionEvent } from 'llmist';
import { clearReadTracking } from '../gadgets/readTracking.js';
import { logger } from '../utils/logging.js';

/**
 * Base compaction settings for implementation agent (long sessions).
 *
 * Implementation agents often run for many iterations, so we use:
 * - Lower trigger threshold (70%) to compact earlier
 * - Lower target (40%) for more aggressive reduction
 * - More recent turns preserved (8) to maintain context
 */
const IMPLEMENTATION_COMPACTION_BASE = {
	enabled: true,
	strategy: 'hybrid' as const,
	triggerThresholdPercent: 70,
	targetPercent: 40,
	preserveRecentTurns: 8,
};

/**
 * Base compaction settings for other agents (briefing, planning, debug, respond-to-review, review).
 *
 * These agents typically have shorter sessions, so we use:
 * - Standard trigger threshold (80%)
 * - Standard target (50%)
 * - Fewer recent turns (5) since sessions are shorter
 */
const DEFAULT_COMPACTION_BASE = {
	enabled: true,
	strategy: 'hybrid' as const,
	triggerThresholdPercent: 80,
	targetPercent: 50,
	preserveRecentTurns: 5,
};

/**
 * Handle compaction event: log and clear read tracking.
 *
 * After compaction, the context is summarized and previous file/directory
 * contents are no longer available verbatim. Clear tracking so they can
 * be re-read if needed.
 */
function handleCompaction(event: CompactionEvent): void {
	const tokensSaved = event.tokensBefore - event.tokensAfter;
	const reductionPercent = Math.round((tokensSaved / event.tokensBefore) * 100);
	const messagesRemoved = event.messagesBefore - event.messagesAfter;
	logger.info('Context compaction performed', {
		strategy: event.strategy,
		iteration: event.iteration,
		tokensBefore: event.tokensBefore,
		tokensAfter: event.tokensAfter,
		tokensSaved,
		reductionPercent,
		messagesRemoved,
	});

	// Clear read tracking since context was summarized
	clearReadTracking();
}

/**
 * Get compaction configuration for a given agent type.
 *
 * @param agentType - Type of agent (e.g., "implementation", "briefing", "planning")
 * @returns Compaction configuration
 */
export function getCompactionConfig(agentType: string): CompactionConfig {
	const baseConfig =
		agentType === 'implementation' ? IMPLEMENTATION_COMPACTION_BASE : DEFAULT_COMPACTION_BASE;
	return {
		...baseConfig,
		onCompaction: handleCompaction,
	};
}
