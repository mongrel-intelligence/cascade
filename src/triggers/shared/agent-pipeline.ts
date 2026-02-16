/**
 * Shared agent execution pipeline extracted from Trello, GitHub, and JIRA webhook handlers.
 *
 * This module unifies the common flow:
 * 1. Resolve work item ID
 * 2. Check budget (pre-agent)
 * 3. Prepare for agent (lifecycle)
 * 4. Run agent
 * 5. Handle artifacts (cost updates)
 * 6. Check budget (post-agent, warnings)
 * 7. Cleanup lifecycle
 * 8. Handle success/failure
 * 9. Auto-debug trigger
 */

import { runAgent } from '../../agents/registry.js';
import { PMLifecycleManager, createPMProvider, resolveProjectPMConfig } from '../../pm/index.js';
import type { AgentResult, CascadeConfig, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import type { TriggerResult } from '../types.js';
import { handleAgentResultArtifacts } from './agent-result-handler.js';
import { checkBudgetExceeded } from './budget.js';
import { triggerDebugAnalysis } from './debug-runner.js';
import { shouldTriggerDebug } from './debug-trigger.js';

export interface AgentPipelineOptions {
	/**
	 * Trigger result with agent type and input.
	 */
	result: TriggerResult;

	/**
	 * Project configuration.
	 */
	project: ProjectConfig;

	/**
	 * Global CASCADE configuration.
	 */
	config: CascadeConfig;

	/**
	 * Whether to call lifecycle.prepareForAgent before running the agent.
	 * Default: true
	 * GitHub handler sets this to false.
	 */
	prepareLifecycle?: boolean;

	/**
	 * Whether to call lifecycle.cleanupProcessing after the agent completes.
	 * Default: true
	 * GitHub handler sets this to false.
	 */
	cleanupLifecycle?: boolean;

	/**
	 * Optional callback invoked when the agent fails (before lifecycle.handleFailure).
	 * GitHub handler uses this to update initial PR comment with error message.
	 */
	onAgentFailure?: (agentResult: AgentResult) => Promise<void>;

	/**
	 * Optional callback invoked when the agent completes successfully.
	 * GitHub handler uses this for conditional lifecycle.handleSuccess (implementation agent only).
	 */
	onAgentSuccess?: (agentResult: AgentResult) => Promise<void>;
}

/**
 * Check budget before running agent. Returns remaining budget or undefined if budget exceeded.
 */
async function checkPreAgentBudget(
	workItemId: string,
	project: ProjectConfig,
	config: CascadeConfig,
	lifecycle: PMLifecycleManager,
): Promise<number | undefined> {
	const budgetCheck = await checkBudgetExceeded(workItemId, project, config);
	if (budgetCheck?.exceeded) {
		logger.warn('Budget exceeded, agent not started', {
			workItemId,
			currentCost: budgetCheck.currentCost,
			budget: budgetCheck.budget,
		});
		await lifecycle.handleBudgetExceeded(workItemId, budgetCheck.currentCost, budgetCheck.budget);
		return undefined;
	}
	return budgetCheck?.remaining;
}

/**
 * Handle post-agent tasks: artifacts, budget warnings, cleanup, and success/failure.
 */
async function handlePostAgentTasks(
	workItemId: string,
	result: TriggerResult,
	agentResult: AgentResult,
	project: ProjectConfig,
	config: CascadeConfig,
	lifecycle: PMLifecycleManager,
	cleanupLifecycle: boolean,
	onAgentSuccess?: (agentResult: AgentResult) => Promise<void>,
	onAgentFailure?: (agentResult: AgentResult) => Promise<void>,
): Promise<void> {
	await handleAgentResultArtifacts(workItemId, result.agentType, agentResult, project);

	// Budget warning check
	const postBudgetCheck = await checkBudgetExceeded(workItemId, project, config);
	if (postBudgetCheck?.exceeded) {
		await lifecycle.handleBudgetWarning(
			workItemId,
			postBudgetCheck.currentCost,
			postBudgetCheck.budget,
		);
	}

	// Cleanup
	if (cleanupLifecycle) {
		await lifecycle.cleanupProcessing(workItemId);
	}

	// Success/failure
	if (agentResult.success) {
		if (onAgentSuccess) {
			await onAgentSuccess(agentResult);
		} else {
			await lifecycle.handleSuccess(workItemId, result.agentType, agentResult.prUrl);
		}
	} else {
		if (onAgentFailure) {
			await onAgentFailure(agentResult);
		}
		await lifecycle.handleFailure(workItemId, agentResult.error);
	}
}

/**
 * Execute the full agent pipeline with budget checks, lifecycle hooks, and auto-debug.
 * This function should be called within a credential scope (withTrelloCredentials,
 * withJiraCredentials, withPMProvider, withGitHubToken already established).
 */
export async function executeAgentPipeline(options: AgentPipelineOptions): Promise<void> {
	const {
		result,
		project,
		config,
		prepareLifecycle = true,
		cleanupLifecycle = true,
		onAgentFailure,
		onAgentSuccess,
	} = options;

	const workItemId = result.cardId ?? result.workItemId;
	const pmProvider = createPMProvider(project);
	const pmConfig = resolveProjectPMConfig(project);
	const lifecycle = new PMLifecycleManager(pmProvider, pmConfig);

	// 1. Budget check (pre-agent)
	let remainingBudgetUsd: number | undefined;
	if (workItemId) {
		remainingBudgetUsd = await checkPreAgentBudget(workItemId, project, config, lifecycle);
		if (remainingBudgetUsd === undefined) return; // Budget exceeded, abort
	}

	// 2. Prepare for agent (optional)
	if (workItemId && prepareLifecycle) {
		await lifecycle.prepareForAgent(workItemId, result.agentType);
	}

	// 3. Run agent
	const agentResult = await runAgent(result.agentType, {
		...result.agentInput,
		remainingBudgetUsd,
		project,
		config,
	});

	// 4-7. Post-agent tasks
	if (workItemId) {
		await handlePostAgentTasks(
			workItemId,
			result,
			agentResult,
			project,
			config,
			lifecycle,
			cleanupLifecycle,
			onAgentSuccess,
			onAgentFailure,
		);
	}

	logger.info('Agent completed', {
		agentType: result.agentType,
		workItemId,
		success: agentResult.success,
		runId: agentResult.runId,
	});

	// 8. Auto-debug
	await tryAutoDebug(agentResult, project, config);
}

/**
 * Shared auto-debug logic extracted from all three webhook handlers.
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
