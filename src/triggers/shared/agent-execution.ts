import { runAgent } from '../../agents/registry.js';
import { PMLifecycleManager, createPMProvider, resolveProjectPMConfig } from '../../pm/index.js';
import type { AgentResult, CascadeConfig, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import type { TriggerResult } from '../types.js';
import { handleAgentResultArtifacts } from './agent-result-handler.js';
import { checkBudgetExceeded } from './budget.js';
import { triggerDebugAnalysis } from './debug-runner.js';
import { shouldTriggerDebug } from './debug-trigger.js';

/**
 * Configuration for source-specific behavior in the agent execution pipeline.
 */
export interface AgentExecutionConfig {
	/**
	 * Whether to skip calling lifecycle.prepareForAgent before running the agent.
	 * GitHub handlers skip this step; Trello and JIRA handlers call it.
	 */
	skipPrepareForAgent?: boolean;

	/**
	 * Whether to skip calling lifecycle.handleFailure on agent failure.
	 * GitHub handlers only call handleSuccess for the 'implementation' agent type,
	 * so they skip handleFailure entirely.
	 */
	skipHandleFailure?: boolean;

	/**
	 * Whether to only call lifecycle.handleSuccess for a specific agent type.
	 * If set, handleSuccess is only called when agentType matches this value.
	 * GitHub uses this to only call handleSuccess for 'implementation'.
	 */
	handleSuccessOnlyForAgentType?: string;

	/**
	 * Optional callback invoked when the agent fails (after pipeline completes).
	 * Used by GitHub to update the PR comment with an error message.
	 */
	onFailure?: (result: TriggerResult, agentResult: AgentResult) => Promise<void>;

	/**
	 * Log label used in log messages (e.g. 'GitHub', 'JIRA', 'Trello').
	 */
	logLabel?: string;
}

/**
 * Check the budget before running an agent.
 * Returns the remaining budget if not exceeded, or null to signal the caller
 * should abort (budget exceeded and lifecycle notified).
 */
async function checkPreRunBudget(
	workItemId: string,
	project: ProjectConfig,
	config: CascadeConfig,
	lifecycle: PMLifecycleManager,
): Promise<{ remainingBudgetUsd: number | undefined; abort: boolean }> {
	const budgetCheck = await checkBudgetExceeded(workItemId, project, config);
	if (budgetCheck?.exceeded) {
		logger.warn('Budget exceeded, agent not started', {
			workItemId,
			currentCost: budgetCheck.currentCost,
			budget: budgetCheck.budget,
		});
		await lifecycle.handleBudgetExceeded(workItemId, budgetCheck.currentCost, budgetCheck.budget);
		return { remainingBudgetUsd: undefined, abort: true };
	}
	return { remainingBudgetUsd: budgetCheck?.remaining, abort: false };
}

/**
 * Run post-agent lifecycle steps: artifact handling, budget warning, cleanup, success/failure.
 */
async function runPostAgentLifecycle(
	workItemId: string,
	result: TriggerResult,
	agentResult: AgentResult,
	project: ProjectConfig,
	config: CascadeConfig,
	lifecycle: PMLifecycleManager,
	executionConfig: AgentExecutionConfig,
): Promise<void> {
	const {
		skipPrepareForAgent = false,
		skipHandleFailure = false,
		handleSuccessOnlyForAgentType,
	} = executionConfig;

	await handleAgentResultArtifacts(workItemId, result.agentType, agentResult, project);

	const postBudgetCheck = await checkBudgetExceeded(workItemId, project, config);
	if (postBudgetCheck?.exceeded) {
		await lifecycle.handleBudgetWarning(
			workItemId,
			postBudgetCheck.currentCost,
			postBudgetCheck.budget,
		);
	}

	if (!skipPrepareForAgent) {
		await lifecycle.cleanupProcessing(workItemId);
	}

	const shouldCallHandleSuccess =
		agentResult.success &&
		(!handleSuccessOnlyForAgentType || result.agentType === handleSuccessOnlyForAgentType);

	if (shouldCallHandleSuccess) {
		await lifecycle.handleSuccess(
			workItemId,
			result.agentType,
			agentResult.prUrl,
			agentResult.progressCommentId,
		);
	} else if (!agentResult.success && !skipHandleFailure) {
		await lifecycle.handleFailure(workItemId, agentResult.error);
	}
}

/**
 * Shared agent execution pipeline.
 *
 * Handles the common steps across all webhook handlers:
 * 1. Budget check (pre-run)
 * 2. Lifecycle preparation (prepareForAgent)
 * 3. Run the agent
 * 4. Handle artifacts
 * 5. Post-run budget check
 * 6. Lifecycle cleanup
 * 7. Handle success/failure
 * 8. Auto-debug
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
	const { skipPrepareForAgent = false, onFailure, logLabel = 'Agent' } = executionConfig;

	const workItemId = result.cardId ?? result.workItemId;
	const pmProvider = createPMProvider(project);
	const pmConfig = resolveProjectPMConfig(project);
	const lifecycle = new PMLifecycleManager(pmProvider, pmConfig);

	let remainingBudgetUsd: number | undefined;
	if (workItemId) {
		const budgetResult = await checkPreRunBudget(workItemId, project, config, lifecycle);
		if (budgetResult.abort) return;
		remainingBudgetUsd = budgetResult.remainingBudgetUsd;
	}

	if (workItemId && !skipPrepareForAgent) {
		await lifecycle.prepareForAgent(workItemId, result.agentType);
	}

	const agentResult = await runAgent(result.agentType, {
		...result.agentInput,
		remainingBudgetUsd,
		project,
		config,
	});

	if (workItemId) {
		await runPostAgentLifecycle(
			workItemId,
			result,
			agentResult,
			project,
			config,
			lifecycle,
			executionConfig,
		);
	}

	logger.info(`${logLabel} completed`, {
		agentType: result.agentType,
		success: agentResult.success,
		runId: agentResult.runId,
	});

	if (onFailure && !agentResult.success) {
		await onFailure(result, agentResult);
	}

	await tryAutoDebug(agentResult, project, config);
}

/**
 * Trigger auto-debug analysis for a failed/timed_out agent run.
 */
async function tryAutoDebug(
	agentResult: AgentResult,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	if (!agentResult.runId) return;
	const debugTarget = await shouldTriggerDebug(agentResult.runId);
	if (debugTarget) {
		triggerDebugAnalysis(debugTarget.runId, project, config, debugTarget.cardId).catch((err) =>
			logger.error('Auto-debug failed', { error: String(err) }),
		);
	}
}
