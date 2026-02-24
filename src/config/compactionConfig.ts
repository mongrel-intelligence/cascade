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
	summarizationPrompt: `Summarize this conversation history concisely, preserving:
1. The current task goals and acceptance criteria
2. Key decisions made and their rationale
3. Important facts and data discovered about the codebase
4. ALL files that were created or modified, and their current state
5. Current todo list status (what's done, what's in progress, what's pending)

CRITICAL — Preserve a "Failed Approaches" section listing:
- Each distinct approach that was tried and FAILED (tool/technique, why it failed)
- Specific error messages that were encountered
- This information prevents re-trying the same failed approaches after compaction

Format as a brief narrative, with the failed approaches as a bullet list at the end.
Previous conversation:`,
};

/**
 * Base compaction settings for other agents (splitting, planning, debug, respond-to-review, review).
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
	summarizationPrompt: `Summarize this conversation history concisely, preserving:
1. The current task goals and acceptance criteria
2. Key decisions made and their rationale
3. Important facts and data discovered
4. Errors encountered and how they were resolved
5. Current progress — what's done and what remains

CRITICAL — Preserve a "Failed Approaches" section listing:
- Each distinct approach that was tried and FAILED (tool/technique, why it failed)
- Specific error messages that were encountered
- This information prevents re-trying the same failed approaches after compaction

Format as a brief narrative, with the failed approaches as a bullet list at the end.
Previous conversation:`,
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
 * @param agentType - Type of agent (e.g., "implementation", "splitting", "planning")
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
