import { failQueuedOrRunningRun } from '../../db/repositories/runsRepository.js';
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
		await resolvePreCreatedRunOnSkip(
			executionContext,
			'Skipped before start: integration validation failed',
		);
		return;
	}

	// Last-mile freshness check. Only fires for `implementation` runs with a
	// resolved work item — review/respond-to-* and follow-up agents bypass
	// the gate. Stale / duplicate dispatches stop here without throwing so
	// router locks are released by the normal worker cleanup path.
	const blockedByFreshness = await runFreshnessGate(executionContext);
	if (blockedByFreshness) {
		await resolvePreCreatedRunOnSkip(
			executionContext,
			'Skipped before start: implementation freshness gate (existing PR or completed checklist)',
		);
		return;
	}

	let remainingBudgetUsd: number | undefined;
	if (executionContext.workItemId) {
		const budgetResult = await checkPreRunBudget(
			executionContext.workItemId,
			executionContext.project,
			executionContext.lifecycle,
		);
		if (budgetResult.abort) {
			await resolvePreCreatedRunOnSkip(
				executionContext,
				'Skipped before start: work-item budget exceeded',
			);
			return;
		}
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
 * MNG-1695: resolve a pre-created `status='queued'` run row to a terminal state
 * when the pipeline skips/aborts BEFORE activating it.
 *
 * Manual runs pre-create a `queued` row at tRPC trigger time (threaded as
 * `agentInput.preCreatedRunId`); the worker flips it to `running` deep inside
 * `runAgentForContext` → `executeWithEngine` → `tryCreateRun`. Every early return
 * above that line (integration validation, freshness gate, budget abort) returns
 * cleanly, so the worker container exits 0 — `cleanupWorker` skips `failOrphanedRun`
 * (it only fires on a non-zero exit) and the periodic orphan sweep can't help once
 * the AutoRemove container is already gone. The row would otherwise leak as a
 * perpetual `queued` badge and, because `hasActiveRunForWorkItem` counts `queued`,
 * lock out every later trigger/retry on the work item for ~2h.
 *
 * No-op for every non-manual source (no `preCreatedRunId`). `failQueuedOrRunningRun`
 * itself no-ops on a row that already reached a terminal state, so calling it is
 * always safe. Its own failure must never crash the worker on an otherwise-clean
 * skip, so DB errors are logged and swallowed.
 */
async function resolvePreCreatedRunOnSkip(
	context: AgentExecutionContext,
	reason: string,
): Promise<void> {
	const preCreatedRunId = context.agentInput.preCreatedRunId;
	if (!preCreatedRunId) return;
	try {
		await failQueuedOrRunningRun(preCreatedRunId, reason);
	} catch (err) {
		logger.warn('[MNG-1695] could not resolve pre-created queued run on pipeline skip', {
			projectId: context.project.id,
			workItemId: context.workItemId,
			runId: preCreatedRunId,
			reason,
			error: String(err),
		});
	}
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
