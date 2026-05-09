import type { LifecycleHooks } from '../../agents/definitions/schema.js';
import type { PMLifecycleManager } from '../../pm/index.js';
import type { AgentResult, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import type { TriggerResult } from '../types.js';
import type { AgentExecutionConfig, AgentExecutionContext } from './agent-execution-types.js';
import { handleAgentResultArtifacts } from './agent-result-handler.js';
import { checkBudgetExceeded } from './budget.js';
import {
	formatValidationErrors,
	type ValidationResult,
	validateIntegrations,
} from './integration-validation.js';

interface ValidationLifecycleParams {
	result: TriggerResult;
	project: ProjectConfig;
	executionConfig: AgentExecutionConfig;
	agentType: string;
	lifecycle: PMLifecycleManager;
}

/**
 * Notify PM and source-specific callbacks when integration validation fails before the agent runs.
 */
async function notifyValidationFailure(
	result: TriggerResult,
	validation: ValidationResult,
	lifecycle: PMLifecycleManager,
	executionConfig: AgentExecutionConfig,
	agentType: string,
	projectId: string,
): Promise<void> {
	const errorMessage = formatValidationErrors(validation);
	logger.error('Integration validation failed', {
		agentType,
		projectId,
		errors: validation.errors,
	});

	// Only notify via PM if PM validation passed (otherwise PM isn't configured)
	const pmFailed = validation.errors.some((e) => e.category === 'pm');
	if (result.workItemId && !pmFailed) {
		await lifecycle.handleFailure(result.workItemId, errorMessage);
	}

	// Call onFailure callback (for GitHub PR updates)
	if (executionConfig.onFailure) {
		await executionConfig.onFailure(result, { success: false, output: '', error: errorMessage });
	}
}

/**
 * Run pre-flight integration validation and apply the existing failure notification semantics.
 * Returns false when execution should stop before preparing or running the agent.
 */
export async function validateAgentExecutionLifecycle({
	result,
	project,
	executionConfig,
	agentType,
	lifecycle,
}: ValidationLifecycleParams): Promise<boolean> {
	const validation = await validateIntegrations(project.id, agentType, project);
	if (validation.valid) return true;

	await notifyValidationFailure(
		result,
		validation,
		lifecycle,
		executionConfig,
		agentType,
		project.id,
	);
	return false;
}

/**
 * Check the budget before running an agent.
 * Returns the remaining budget if not exceeded, or abort=true when the agent
 * must not start and the lifecycle manager has been notified.
 */
export async function checkPreRunBudget(
	workItemId: string,
	project: ProjectConfig,
	lifecycle: PMLifecycleManager,
): Promise<{ remainingBudgetUsd: number | undefined; abort: boolean }> {
	const budgetCheck = await checkBudgetExceeded(workItemId, project);
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
 * Run pre-agent lifecycle steps owned by the PM lifecycle manager.
 */
export async function prepareAgentExecutionLifecycle(
	context: AgentExecutionContext,
): Promise<void> {
	if (context.workItemId && !context.executionConfig.skipPrepareForAgent) {
		await context.lifecycle.prepareForAgent(context.workItemId, context.lifecycleHooks);
	}
}

/**
 * Run post-agent lifecycle steps: artifact handling, budget warning, cleanup, success/failure.
 */
export async function runPostAgentExecutionLifecycle(
	workItemId: string,
	agentType: string,
	agentResult: AgentResult,
	project: ProjectConfig,
	lifecycle: PMLifecycleManager,
	lifecycleHooks: LifecycleHooks,
	executionConfig: AgentExecutionConfig,
): Promise<void> {
	const {
		skipPrepareForAgent = false,
		skipHandleFailure = false,
		handleSuccessOnlyForAgentType,
	} = executionConfig;

	await handleAgentResultArtifacts(workItemId, agentType, agentResult, project);

	const postBudgetCheck = await checkBudgetExceeded(workItemId, project);
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
		(!handleSuccessOnlyForAgentType || agentType === handleSuccessOnlyForAgentType);

	if (shouldCallHandleSuccess) {
		await lifecycle.handleSuccess(
			workItemId,
			lifecycleHooks,
			agentResult.prUrl,
			agentResult.progressCommentId,
		);
	} else if (!agentResult.success && !skipHandleFailure) {
		await lifecycle.handleFailure(workItemId, agentResult.error);
	}
}
