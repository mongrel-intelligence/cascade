import { getDebugAnalysisByRunId, getRunById } from '../../db/repositories/runsRepository.js';
import { logger } from '../../utils/logging.js';

/**
 * Check whether a completed run should trigger automatic debug analysis.
 *
 * Returns non-null if the run failed/timed_out, is not itself a debug agent,
 * and has no existing debug_analyses row.
 */
export async function shouldTriggerDebug(
	runId?: string,
): Promise<{ runId: string; agentType: string; cardId?: string } | null> {
	if (!runId) return null;

	try {
		const run = await getRunById(runId);
		if (!run) return null;

		// Only trigger for failed or timed_out runs
		if (run.status !== 'failed' && run.status !== 'timed_out') return null;

		// Don't trigger debug for debug agents (prevent infinite loop)
		if (run.agentType === 'debug') return null;

		// Check if debug analysis already exists
		const existing = await getDebugAnalysisByRunId(runId);
		if (existing) return null;

		return {
			runId,
			agentType: run.agentType,
			cardId: run.workItemId ?? undefined,
		};
	} catch (err) {
		logger.warn('Failed to check debug trigger', { runId, error: String(err) });
		return null;
	}
}
