import type { CompactionConfig, CompactionEvent } from 'llmist';
import { clearReadTracking } from '../gadgets/readTracking.js';
import { logger } from '../utils/logging.js';

/**
 * Standard compaction settings for all agents.
 *
 * All agents use a single compaction configuration:
 * - Trigger threshold (80%) to compact when context is near full
 * - Target (50%) for moderate reduction
 * - Recent turns preserved (5) to maintain immediate context
 */
const COMPACTION_CONFIG = {
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
 * Get compaction configuration.
 * Returns a fixed standard configuration used by all agents.
 *
 * @returns Compaction configuration
 */
export function getCompactionConfig(): CompactionConfig {
	return {
		...COMPACTION_CONFIG,
		onCompaction: handleCompaction,
	};
}
