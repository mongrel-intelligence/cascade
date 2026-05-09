import type { AgentResult, CascadeConfig, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { triggerDebugAnalysis } from './debug-runner.js';
import { shouldTriggerDebug } from './debug-trigger.js';

export type AutoDebugResult =
	| { triggered: false; reason: 'missing-run-id' | 'not-eligible' }
	| { triggered: true; runId: string; workItemId?: string };

/**
 * Trigger auto-debug analysis for a failed/timed_out agent run.
 *
 * The debug analysis remains fire-and-forget. Failures are logged from the
 * async branch and do not affect the completed agent run.
 */
export async function triggerAutoDebugIfNeeded(
	agentResult: AgentResult,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<AutoDebugResult> {
	if (!agentResult.runId) return { triggered: false, reason: 'missing-run-id' };

	const debugTarget = await shouldTriggerDebug(agentResult.runId);
	if (!debugTarget) return { triggered: false, reason: 'not-eligible' };

	triggerDebugAnalysis(debugTarget.runId, project, config, debugTarget.workItemId).catch((err) =>
		logger.error('Auto-debug failed', { error: String(err) }),
	);

	return {
		triggered: true,
		runId: debugTarget.runId,
		workItemId: debugTarget.workItemId,
	};
}
