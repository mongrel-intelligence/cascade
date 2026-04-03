/**
 * Shared concurrency management utility for webhook handlers.
 *
 * Wraps the duplicated check→mark→execute→clear pattern used by both
 * `handleMatchedTrigger()` (pm/webhook-handler) and `runGitHubAgent()`
 * (github/webhook-handler) into a single reusable function.
 *
 * Usage:
 *   await withAgentTypeConcurrency(projectId, agentType, () => runTheAgent());
 */

import {
	checkAgentTypeConcurrency,
	clearAgentTypeEnqueued,
	markAgentTypeEnqueued,
	markRecentlyDispatched,
} from '../../router/agent-type-lock.js';
import { logger } from '../../utils/logging.js';

/**
 * Execute `fn` within agent-type concurrency limits.
 *
 * 1. Checks whether the agent-type is at its concurrency limit.
 * 2. If not blocked, marks the slot as enqueued and runs `fn`.
 * 3. Clears the enqueued slot in a `finally` block.
 *
 * Returns `false` if the concurrency check was blocked (fn was not called),
 * `true` if fn was called (regardless of whether it succeeded).
 *
 * @param projectId  The project ID to scope concurrency to.
 * @param agentType  The agent type being dispatched.
 * @param fn         The async function to run if not blocked.
 * @param logLabel   Optional label for log messages (default: 'Agent').
 */
export async function withAgentTypeConcurrency(
	projectId: string,
	agentType: string,
	fn: () => Promise<void>,
	logLabel?: string,
): Promise<boolean> {
	const concurrencyCheck = await checkAgentTypeConcurrency(projectId, agentType, logLabel);
	if (concurrencyCheck.blocked) {
		logger.info(`${logLabel ?? 'Agent'} type concurrency blocked, skipping`, {
			projectId,
			agentType,
		});
		return false;
	}

	const hasLimit = concurrencyCheck.maxConcurrency !== null;
	if (hasLimit) {
		markRecentlyDispatched(projectId, agentType);
		markAgentTypeEnqueued(projectId, agentType);
	}

	try {
		await fn();
		return true;
	} finally {
		if (hasLimit) {
			clearAgentTypeEnqueued(projectId, agentType);
		}
	}
}
