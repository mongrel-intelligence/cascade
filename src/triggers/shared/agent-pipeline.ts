/**
 * Shared agent execution pipeline for webhook handlers.
 *
 * Consolidates the common pattern: budget check → lifecycle hooks →
 * runAgent → artifact handling → success/failure → auto-debug.
 */

import { runAgent } from '../../agents/registry.js';
import type { PMLifecycleManager } from '../../pm/index.js';
import type { AgentResult, CascadeConfig, ProjectConfig } from '../../types/index.js';
import { clearCardActive, logger, setCardActive } from '../../utils/index.js';
import { handleAgentResultArtifacts } from './agent-result-handler.js';
import { checkBudgetExceeded } from './budget.js';
import { triggerDebugAnalysis } from './debug-runner.js';
import { shouldTriggerDebug } from './debug-trigger.js';

/**
 * Options for executing the agent pipeline.
 */
export interface AgentExecutionOptions {
	/** Agent type to run */
	agentType: string;
	/** Agent input parameters (merged with project, config, remainingBudgetUsd) */
	agentInput: Record<string, unknown>;
	/** Work item ID (cardId or workItemId) */
	workItemId: string | undefined;
	/** Project configuration */
	project: ProjectConfig;
	/** Cascade configuration */
	config: CascadeConfig;
	/** PM lifecycle manager (for budget/success/failure hooks) */
	lifecycle: PMLifecycleManager;
	/** Whether to call prepareForAgent before running (default: true) */
	prepareLifecycle?: boolean;
	/** Whether to call cleanupProcessing after running (default: true) */
	cleanupLifecycle?: boolean;
	/** Hook called when agent fails (before lifecycle.handleFailure) */
	onAgentFailure?: (agentResult: AgentResult) => Promise<void>;
}

/**
 * Execute the standard agent pipeline: budget check, lifecycle hooks,
 * runAgent, artifact handling, success/failure, auto-debug.
 */
export async function executeAgentPipeline(opts: AgentExecutionOptions): Promise<void> {
	const {
		agentType,
		agentInput,
		workItemId,
		project,
		config,
		lifecycle,
		prepareLifecycle = true,
		cleanupLifecycle = true,
		onAgentFailure,
	} = opts;

	// Budget check (pre-agent)
	const remainingBudgetUsd = await performBudgetCheck(workItemId, project, config, lifecycle);
	if (remainingBudgetUsd === null) {
		return; // Budget exceeded
	}

	// Pre-agent lifecycle hook
	await prepareAgent(workItemId, agentType, lifecycle, prepareLifecycle);

	// Run agent
	const agentResult = await runAgent(agentType, {
		...agentInput,
		remainingBudgetUsd,
		project,
		config,
	});

	// Post-agent processing
	await processAgentResult({
		agentResult,
		workItemId,
		agentType,
		project,
		config,
		lifecycle,
		cleanupLifecycle,
		onAgentFailure,
	});

	logger.info('Agent completed', {
		agentType,
		success: agentResult.success,
		runId: agentResult.runId,
	});

	// Auto-debug
	await tryAutoDebug(agentResult, project, config, workItemId);
}

/**
 * Perform pre-agent budget check. Returns remaining budget or null if exceeded.
 */
async function performBudgetCheck(
	workItemId: string | undefined,
	project: ProjectConfig,
	config: CascadeConfig,
	lifecycle: PMLifecycleManager,
): Promise<number | undefined | null> {
	if (!workItemId) {
		return undefined;
	}

	const budgetCheck = await checkBudgetExceeded(workItemId, project, config);
	if (budgetCheck?.exceeded) {
		logger.warn('Budget exceeded, agent not started', {
			workItemId,
			currentCost: budgetCheck.currentCost,
			budget: budgetCheck.budget,
		});
		await lifecycle.handleBudgetExceeded(workItemId, budgetCheck.currentCost, budgetCheck.budget);
		return null; // Signal budget exceeded
	}
	return budgetCheck?.remaining;
}

/**
 * Prepare agent: set active state and call lifecycle hook.
 */
async function prepareAgent(
	workItemId: string | undefined,
	agentType: string,
	lifecycle: PMLifecycleManager,
	prepareLifecycle: boolean,
): Promise<void> {
	if (!workItemId) return;
	setCardActive(workItemId);
	if (prepareLifecycle) {
		await lifecycle.prepareForAgent(workItemId, agentType);
	}
}

/**
 * Process agent result: artifacts, budget warnings, lifecycle hooks, success/failure.
 */
async function processAgentResult(params: {
	agentResult: AgentResult;
	workItemId: string | undefined;
	agentType: string;
	project: ProjectConfig;
	config: CascadeConfig;
	lifecycle: PMLifecycleManager;
	cleanupLifecycle: boolean;
	onAgentFailure?: (agentResult: AgentResult) => Promise<void>;
}): Promise<void> {
	const {
		agentResult,
		workItemId,
		agentType,
		project,
		config,
		lifecycle,
		cleanupLifecycle,
		onAgentFailure,
	} = params;

	if (!workItemId) return;

	await handleAgentResultArtifacts(workItemId, agentType, agentResult, project);

	const postBudgetCheck = await checkBudgetExceeded(workItemId, project, config);
	if (postBudgetCheck?.exceeded) {
		await lifecycle.handleBudgetWarning(
			workItemId,
			postBudgetCheck.currentCost,
			postBudgetCheck.budget,
		);
	}

	if (cleanupLifecycle) {
		await lifecycle.cleanupProcessing(workItemId);
	}

	if (agentResult.success) {
		await lifecycle.handleSuccess(workItemId, agentType, agentResult.prUrl);
	} else {
		if (onAgentFailure) {
			await onAgentFailure(agentResult);
		}
		await lifecycle.handleFailure(workItemId, agentResult.error);
	}

	clearCardActive(workItemId);
}

async function tryAutoDebug(
	agentResult: AgentResult,
	project: ProjectConfig,
	config: CascadeConfig,
	workItemId: string | undefined,
): Promise<void> {
	if (!agentResult.runId) return;
	const debugTarget = await shouldTriggerDebug(agentResult.runId);
	if (debugTarget) {
		triggerDebugAnalysis(
			debugTarget.runId,
			project,
			config,
			debugTarget.cardId || workItemId,
		).catch((err) => logger.error('Auto-debug failed', { error: String(err) }));
	}
}
