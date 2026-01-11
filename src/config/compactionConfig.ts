import type { CompactionConfig } from 'llmist';

/**
 * Aggressive compaction for implementation agent (long sessions).
 *
 * Implementation agents often run for many iterations, so we use:
 * - Lower trigger threshold (70%) to compact earlier
 * - Lower target (40%) for more aggressive reduction
 * - More recent turns preserved (8) to maintain context
 */
export const IMPLEMENTATION_COMPACTION: CompactionConfig = {
	enabled: true,
	strategy: 'hybrid', // Intelligent mix of summarization and sliding-window
	triggerThresholdPercent: 70, // Compact at 70% context usage
	targetPercent: 40, // Reduce to 40% after compaction
	preserveRecentTurns: 8, // Keep last 8 turns verbatim
};

/**
 * Standard compaction for other agents (briefing, planning, debug, respond-to-review, review).
 *
 * These agents typically have shorter sessions, so we use:
 * - Standard trigger threshold (80%)
 * - Standard target (50%)
 * - Fewer recent turns (5) since sessions are shorter
 */
export const DEFAULT_COMPACTION: CompactionConfig = {
	enabled: true,
	strategy: 'hybrid',
	triggerThresholdPercent: 80,
	targetPercent: 50,
	preserveRecentTurns: 5,
};

/**
 * Get compaction configuration for a given agent type.
 *
 * @param agentType - Type of agent (e.g., "implementation", "briefing", "planning")
 * @returns Compaction configuration
 */
export function getCompactionConfig(agentType: string): CompactionConfig {
	return agentType === 'implementation' ? IMPLEMENTATION_COMPACTION : DEFAULT_COMPACTION;
}
