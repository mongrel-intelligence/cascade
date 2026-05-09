import { getAgentProfile } from '../../agents/definitions/profiles.js';
import type { LifecycleHooks } from '../../agents/definitions/schema.js';
import { runAgent } from '../../agents/registry.js';
import { createPMProvider, PMLifecycleManager, resolveProjectPMConfig } from '../../pm/index.js';
import type { AgentResult, CascadeConfig, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import type { TriggerResult } from '../types.js';
import { triggerAutoDebugIfNeeded } from './agent-auto-debug.js';
import {
	checkPreRunBudget,
	prepareAgentExecutionLifecycle,
	runPostAgentExecutionLifecycle,
	validateAgentExecutionLifecycle,
} from './agent-execution-lifecycle.js';
import type { AgentExecutionConfig, AgentExecutionContext } from './agent-execution-types.js';
import { postAgentSummaryToPM } from './agent-pm-summary.js';
import {
	linkPRPostExecution,
	persistPreRunWorkItems,
	prepareAgentWorkItem,
} from './agent-work-items.js';
import { buildPostCompletionReviewDispatch } from './post-completion-review.js';
import { buildSplittingAutoChainDispatch } from './splitting-auto-chain.js';

export type { AgentExecutionConfig } from './agent-execution-types.js';

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
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: intentional — pipeline with multiple conditional branches + splitting auto-chain
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
	const agentType = result.agentType;

	// Create lifecycle manager once (reused for validation failure and normal flow)
	const pmProvider = createPMProvider(project);
	const pmConfig = resolveProjectPMConfig(project);
	const lifecycle = new PMLifecycleManager(pmProvider, pmConfig);

	// Load lifecycle hooks from agent profile (best-effort — defaults to no-op on failure)
	let lifecycleHooks: LifecycleHooks = {};
	try {
		const agentProfile = await getAgentProfile(agentType);
		lifecycleHooks = agentProfile.lifecycleHooks;
	} catch (err) {
		logger.warn('Failed to load agent profile for lifecycle hooks, using defaults', {
			agentType,
			error: String(err),
		});
	}

	const canExecute = await validateAgentExecutionLifecycle({
		result,
		project,
		agentType,
		lifecycle,
		executionConfig,
	});
	if (!canExecute) {
		return;
	}

	const { onSuccess, onFailure, logLabel = 'Agent' } = executionConfig;

	// Re-resolve workItemId at run time. The trigger handler (e.g. PROpenedTrigger)
	// captures workItemId synchronously at webhook arrival, before any other
	// pipeline has had time to link the PR. By the time we run, the DB may have
	// caught up — preferring the live value avoids carrying a stale `undefined`
	// into runAgent (and therefore agent_runs.work_item_id) and into the
	// post-execution linkPRToWorkItem write.
	const { workItemId, agentInput } = await prepareAgentWorkItem(result, project.id);

	// Patch agentInput.workItemId whenever it diverges from the resolved value.
	// Two cases this catches:
	//   1. Re-resolution recovered a workItemId the trigger didn't have at
	//      webhook-arrival time (the original motivation — see PROpenedTrigger).
	//   2. The trigger set workItemId at the top level of its TriggerResult but
	//      forgot to include it inside `agentInput` (live incident: respond-to-
	//      review and respond-to-pr-comment, 2026-04-29 — 0/103 and 0/9 runs
	//      had a non-null work_item_id, hiding them from the dashboard's
	//      work-item page). The static guard at
	//      tests/unit/triggers/trigger-work-item-id-consistency.test.ts
	//      catches this at write-time; this runtime patch is the safety net.
	// tryCreateRun (src/agents/shared/runTracking.ts) reads workItemId from
	// agentInput when persisting agent_runs.work_item_id.
	const executionContext: AgentExecutionContext = {
		result,
		project,
		config,
		executionConfig,
		agentType,
		logLabel,
		lifecycle,
		lifecycleHooks,
		workItemId,
		agentInput,
	};

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

	await persistPreRunWorkItems(result, project, workItemId);
	await prepareAgentExecutionLifecycle(executionContext);

	const agentResult = await runAgent(executionContext.agentType, {
		...executionContext.agentInput,
		remainingBudgetUsd,
		project: executionContext.project,
		config: executionContext.config,
	});

	// Link PR to work item post-execution (single code path for all backends)
	if (agentResult.success && agentResult.prUrl && project.repo) {
		await linkPRPostExecution(
			agentResult as AgentResult & { prUrl: string },
			project as ProjectConfig & { repo: string },
			result,
			workItemId,
		);
	}

	// Post agent summary to PM work item (cross-source: works for all trigger types)
	await postAgentSummaryToPM(agentType, agentResult, workItemId, project.id, result.prNumber);

	if (workItemId) {
		await runPostAgentExecutionLifecycle(
			workItemId,
			agentType,
			agentResult,
			project,
			lifecycle,
			lifecycleHooks,
			executionConfig,
		);
	}

	logger.info(`${logLabel} completed`, {
		agentType,
		success: agentResult.success,
		runId: agentResult.runId,
	});

	if (onSuccess && agentResult.success) {
		await onSuccess(result, agentResult);
	}

	if (onFailure && !agentResult.success) {
		await onFailure(result, agentResult);
	}

	// Post-completion review dispatch: when an implementation agent succeeds
	// with a PR, check CI and fire review deterministically. This guarantees
	// review dispatch within seconds of completion, regardless of webhook
	// timing (spec 007). Uses the same recursive pattern as the splitting →
	// backlog-manager chain below.
	if (agentType === 'implementation' && agentResult.success && agentResult.prUrl && project.repo) {
		const reviewResult = await buildPostCompletionReviewDispatch(agentResult, project, workItemId);
		if (reviewResult) {
			await runAgentExecutionPipeline(reviewResult, project, config, {
				...executionConfig,
				skipPrepareForAgent: true,
				skipHandleFailure: true,
				logLabel: 'review (post-completion)',
			});
		}
	}

	// After a successful splitting run, propagate auto label and optionally chain backlog-manager
	if (agentType === 'splitting' && agentResult.success && workItemId) {
		const chainResult = await buildSplittingAutoChainDispatch(workItemId, project);
		if (chainResult) {
			await runAgentExecutionPipeline(chainResult, project, config, {
				...executionConfig,
				skipPrepareForAgent: true,
				skipHandleFailure: true,
				logLabel: 'backlog-manager (auto-chain)',
			});
		}
	}

	await triggerAutoDebugIfNeeded(agentResult, project, config);
}
