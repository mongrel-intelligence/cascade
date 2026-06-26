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
import type { AgentExecutionConfig, AgentExecutionContext } from './agent-execution-types.js';
import {
	evaluateImplementationFreshness,
	type FreshnessGateOutcome,
	postFreshnessSkipNotice,
} from './implementation-freshness-gate.js';

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

	// Last-mile freshness check. Only fires for `implementation` runs with a
	// resolved work item — review/respond-to-* and follow-up agents bypass
	// the gate. Stale / duplicate dispatches stop here without throwing so
	// router locks are released by the normal worker cleanup path.
	const blockedByFreshness = await runFreshnessGate(executionContext);
	if (blockedByFreshness) {
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

/**
 * Run the implementation-only freshness gate. Returns `true` when the
 * pipeline must stop before mutating work-item state or starting the
 * agent. Stale/duplicate skips post a durable PM comment; uncertain
 * fail-closed skips do the same and additionally log structured
 * evidence for operators.
 */
async function runFreshnessGate(context: AgentExecutionContext): Promise<boolean> {
	if (context.agentType !== 'implementation' || !context.workItemId) {
		return false;
	}

	let outcome: FreshnessGateOutcome;
	try {
		outcome = await evaluateImplementationFreshness({
			agentType: context.agentType,
			workItemId: context.workItemId,
			project: context.project,
			provider: context.pmProvider,
		});
	} catch (err) {
		// The gate itself should never throw — if it does, treat as
		// dispatchable rather than blocking on a bug in the gate.
		logger.warn('[freshness-gate] evaluator threw — proceeding with dispatch', {
			projectId: context.project.id,
			workItemId: context.workItemId,
			error: String(err),
		});
		return false;
	}

	if (outcome.kind === 'dispatchable') {
		return false;
	}

	logger.info(`${context.logLabel} freshness gate blocked implementation`, {
		projectId: context.project.id,
		workItemId: context.workItemId,
		outcome: outcome.kind,
		evidence: outcome.evidence,
	});

	await postFreshnessSkipNotice(
		context.pmProvider,
		context.workItemId,
		context.agentInput,
		outcome,
	);
	return true;
}
