/**
 * Shared agent execution pipeline extracted from webhook handlers.
 * Consolidates budget checking, lifecycle management, artifact handling,
 * and auto-debug triggering.
 */

import { runAgent } from '../../agents/registry.js';
import type { PMLifecycleManager } from '../../pm/index.js';
import type { AgentResult, CascadeConfig, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { handleAgentResultArtifacts } from './agent-result-handler.js';
import { checkBudgetExceeded } from './budget.js';
import { triggerDebugAnalysis } from './debug-runner.js';
import { shouldTriggerDebug } from './debug-trigger.js';

/**
 * Configuration options for the agent execution pipeline.
 */
export interface AgentExecutionOptions {
	/** Agent type to execute */
	agentType: string;
	/** Agent input parameters */
	agentInput: Record<string, unknown>;
	/** Work item ID (card ID or issue ID) */
	workItemId?: string;
	/** Project configuration */
	project: ProjectConfig;
	/** Cascade configuration */
	config: CascadeConfig;
	/** PM lifecycle manager */
	lifecycle: PMLifecycleManager;
	/** Whether to call prepareForAgent before execution (default: true) */
	prepareLifecycle?: boolean;
	/** Whether to call cleanupProcessing after execution (default: true) */
	cleanupLifecycle?: boolean;
	/** Custom error handler called on agent failure */
	onAgentFailure?: (agentResult: AgentResult) => Promise<void>;
}

/**
 * Execute an agent with full pipeline orchestration:
 * - Budget check (pre-execution)
 * - Lifecycle preparation (optional)
 * - Agent execution
 * - Artifact handling
 * - Budget check (post-execution)
 * - Lifecycle cleanup (optional)
 * - Success/failure handling
 * - Auto-debug triggering
 */
export async function executeAgentPipeline(options: AgentExecutionOptions): Promise<AgentResult> {
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
	} = options;

	// Pre-execution budget check
	const remainingBudgetUsd = await checkPreExecutionBudget(
		workItemId,
		agentType,
		project,
		config,
		lifecycle,
	);
	if (remainingBudgetUsd === null) {
		// Budget exceeded, return early with error
		return {
			success: false,
			output: '',
			error: 'Budget exceeded before agent execution',
		};
	}

	// Lifecycle preparation
	if (workItemId && prepareLifecycle) {
		await lifecycle.prepareForAgent(workItemId, agentType);
	}

	// Agent execution
	const agentResult = await runAgent(agentType, {
		...agentInput,
		remainingBudgetUsd,
		project,
		config,
	});

	// Post-execution handling
	await handlePostExecution(
		workItemId,
		agentType,
		agentResult,
		project,
		config,
		lifecycle,
		cleanupLifecycle,
		onAgentFailure,
	);

	logger.info('Agent completed', {
		agentType,
		success: agentResult.success,
		runId: agentResult.runId,
	});

	// Auto-debug
	await tryAutoDebug(agentResult, project, config, workItemId);

	return agentResult;
}

async function checkPreExecutionBudget(
	workItemId: string | undefined,
	agentType: string,
	project: ProjectConfig,
	config: CascadeConfig,
	lifecycle: PMLifecycleManager,
): Promise<number | undefined | null> {
	if (!workItemId) return undefined;

	const budgetCheck = await checkBudgetExceeded(workItemId, project, config);
	if (budgetCheck?.exceeded) {
		logger.warn('Budget exceeded, agent not started', {
			workItemId,
			agentType,
			currentCost: budgetCheck.currentCost,
			budget: budgetCheck.budget,
		});
		await lifecycle.handleBudgetExceeded(workItemId, budgetCheck.currentCost, budgetCheck.budget);
		return null; // Signal budget exceeded
	}
	return budgetCheck?.remaining;
}

async function handlePostExecution(
	workItemId: string | undefined,
	agentType: string,
	agentResult: AgentResult,
	project: ProjectConfig,
	config: CascadeConfig,
	lifecycle: PMLifecycleManager,
	cleanupLifecycle: boolean,
	onAgentFailure: ((agentResult: AgentResult) => Promise<void>) | undefined,
): Promise<void> {
	if (!workItemId) return;

	await handleAgentResultArtifacts(workItemId, agentType, agentResult, project);

	// Post-execution budget check
	const postBudgetCheck = await checkBudgetExceeded(workItemId, project, config);
	if (postBudgetCheck?.exceeded) {
		await lifecycle.handleBudgetWarning(
			workItemId,
			postBudgetCheck.currentCost,
			postBudgetCheck.budget,
		);
	}

	// Lifecycle cleanup
	if (cleanupLifecycle) {
		await lifecycle.cleanupProcessing(workItemId);
	}

	// Success/failure handling
	if (agentResult.success) {
		await lifecycle.handleSuccess(workItemId, agentType, agentResult.prUrl);
	} else {
		await lifecycle.handleFailure(workItemId, agentResult.error);
		if (onAgentFailure) {
			await onAgentFailure(agentResult);
		}
	}
}

async function tryAutoDebug(
	agentResult: AgentResult,
	project: ProjectConfig,
	config: CascadeConfig,
	workItemId?: string,
): Promise<void> {
	if (!agentResult.runId) return;
	const debugTarget = await shouldTriggerDebug(agentResult.runId);
	if (debugTarget) {
		triggerDebugAnalysis(
			debugTarget.runId,
			project,
			config,
			debugTarget.cardId ?? workItemId,
		).catch((err) => logger.error('Auto-debug failed', { error: String(err) }));
	}
}
