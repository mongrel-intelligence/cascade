import type { CascadeConfig, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import type { TriggerResult } from '../types.js';
import { triggerAutoDebugIfNeeded } from './agent-auto-debug.js';
import { dispatchAgentFollowUps } from './agent-execution-followups.js';
import {
	checkPreRunBudget,
	prepareAgentExecutionLifecycle,
	runPostAgentExecutionLifecycle,
	validateAgentExecutionLifecycle,
} from './agent-execution-lifecycle.js';
import {
	createAgentExecutionContext,
	persistAgentWorkItemLinks,
	runAgentExecutionCallbacks,
	runAgentForContext,
	runPostAgentSideEffects,
} from './agent-execution-runtime.js';
import type { AgentExecutionConfig } from './agent-execution-types.js';

export type { AgentExecutionConfig } from './agent-execution-types.js';

/**
 * Shared agent execution pipeline.
 *
 * Handles the common steps across all webhook handlers:
 * 1. Guard and context setup
 * 2. Validation and preflight budget checks
 * 3. Work-item persistence/linking
 * 4. Lifecycle preparation (prepareForAgent)
 * 5. Run the agent
 * 6. Post-run side effects and lifecycle cleanup
 * 7. Source callbacks
 * 8. Follow-up dispatch and auto-debug
 *
 * Source-specific behavior (e.g. GitHub skipping prepareForAgent or
 * only calling handleSuccess for 'implementation') is controlled via
 * the `executionConfig` parameter.
 *
 * This function must be called inside credential/PM-provider context
 * (e.g. `withTrelloCredentials`, `withPMProvider`, `withGitHubToken`).
 */
export async function runAgentExecutionPipeline(
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
	executionConfig: AgentExecutionConfig = {},
): Promise<void> {
	if (!result.agentType) {
		logger.warn('No agent type in trigger result, skipping execution pipeline');
		return;
	}

	const executionContext = await createAgentExecutionContext(
		result,
		project,
		config,
		executionConfig,
	);

	const canExecute = await validateAgentExecutionLifecycle({
		result: executionContext.result,
		project: executionContext.project,
		agentType: executionContext.agentType,
		lifecycle: executionContext.lifecycle,
		executionConfig: executionContext.executionConfig,
	});
	if (!canExecute) {
		return;
	}

	let remainingBudgetUsd: number | undefined;
	if (executionContext.workItemId) {
		const budgetResult = await checkPreRunBudget(
			executionContext.workItemId,
			executionContext.project,
			executionContext.lifecycle,
		);
		if (budgetResult.abort) return;
		remainingBudgetUsd = budgetResult.remainingBudgetUsd;
	}

	await persistAgentWorkItemLinks(executionContext);
	await prepareAgentExecutionLifecycle(executionContext);

	const agentResult = await runAgentForContext(executionContext, remainingBudgetUsd);
	await runPostAgentSideEffects(executionContext, agentResult);

	if (executionContext.workItemId) {
		await runPostAgentExecutionLifecycle(
			executionContext.workItemId,
			executionContext.agentType,
			agentResult,
			executionContext.project,
			executionContext.lifecycle,
			executionContext.lifecycleHooks,
			executionContext.executionConfig,
		);
	}

	logger.info(`${executionContext.logLabel} completed`, {
		agentType: executionContext.agentType,
		success: agentResult.success,
		runId: agentResult.runId,
	});

	await runAgentExecutionCallbacks(executionContext, agentResult);
	await dispatchAgentFollowUps(executionContext, agentResult, runAgentExecutionPipeline);

	await triggerAutoDebugIfNeeded(agentResult, executionContext.project, executionContext.config);
}
