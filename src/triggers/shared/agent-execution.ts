import { getAgentProfile } from '../../agents/definitions/profiles.js';
import type { LifecycleHooks } from '../../agents/definitions/schema.js';
import { runAgent } from '../../agents/registry.js';
import { getPMProvider } from '../../pm/context.js';
import {
	createPMProvider,
	hasAutoLabel,
	PMLifecycleManager,
	resolveProjectPMConfig,
} from '../../pm/index.js';
import {
	buildReviewDispatchKey,
	claimReviewDispatch,
} from '../../triggers/github/review-dispatch-dedup.js';
import { checkTriggerEnabled } from '../../triggers/shared/trigger-check.js';
import type { AgentResult, CascadeConfig, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { extractPRNumber } from '../../utils/prUrl.js';
import { parseRepoFullName } from '../../utils/repo.js';
import type { TriggerResult } from '../types.js';
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
import { isPipelineAtCapacity } from './backlog-check.js';
import { triggerDebugAnalysis } from './debug-runner.js';
import { shouldTriggerDebug } from './debug-trigger.js';

export type { AgentExecutionConfig } from './agent-execution-types.js';

/**
 * Dispatch a review agent after a successful implementation run, if the PR's
 * CI is green and no review has been dispatched yet.
 *
 * Uses `claimReviewDispatch` with the same dedup key format as the
 * `check-suite-success` trigger, so the two paths cannot double-enqueue.
 * If CI isn't green yet, does nothing — the webhook-triggered path will
 * handle it when CI finishes.
 *
 * Runs inside the worker container, before exit. Uses the same recursive
 * `runAgentExecutionPipeline` pattern as the splitting → backlog-manager chain.
 *
 * Best-effort: errors are logged as warn but never break the implementation
 * pipeline.
 */
async function tryDispatchPostCompletionReview(
	agentResult: AgentResult & { prUrl: string },
	project: ProjectConfig & { repo: string },
	workItemId: string | undefined,
	config: CascadeConfig,
	executionConfig: AgentExecutionConfig,
): Promise<void> {
	try {
		const prNumber = extractPRNumber(agentResult.prUrl);
		if (!prNumber) return;

		const { owner, repo } = parseRepoFullName(project.repo);
		const { githubClient } = await import('../../github/client.js');

		const pr = await githubClient.getPR(owner, repo, prNumber);
		const headSha = pr.headSha;
		if (!headSha) return;

		const checkStatus = await githubClient.getCheckSuiteStatus(owner, repo, headSha);
		if (!checkStatus.allPassing) {
			logger.debug('Skipping post-completion review: CI not all passing', {
				prNumber,
				workItemId,
			});
			return;
		}

		const dedupKey = buildReviewDispatchKey(owner, repo, prNumber, headSha);
		if (!(await claimReviewDispatch(dedupKey, 'post-completion-hook', { prNumber, headSha }))) {
			logger.info('Skipping post-completion review: already dispatched', {
				prNumber,
				workItemId,
				dedupKey,
			});
			return;
		}

		logger.info('Post-completion review dispatch: firing review for implementation PR', {
			prNumber,
			workItemId,
			headSha,
		});

		const reviewResult: TriggerResult = {
			agentType: 'review',
			agentInput: {
				prNumber,
				prBranch: pr.headRef,
				repoFullName: project.repo,
				headSha,
				triggerType: 'ci-success',
				triggerEvent: 'scm:check-suite-success',
				workItemId,
			},
			prNumber,
			prUrl: agentResult.prUrl,
			prTitle: pr.title,
			workItemId,
		};

		await runAgentExecutionPipeline(reviewResult, project, config, {
			...executionConfig,
			skipPrepareForAgent: true,
			skipHandleFailure: true,
			logLabel: 'review (post-completion)',
		});
	} catch (err) {
		logger.warn('Post-completion review dispatch failed (non-fatal)', {
			prUrl: agentResult.prUrl,
			workItemId,
			error: String(err),
		});
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
		await tryDispatchPostCompletionReview(
			agentResult as AgentResult & { prUrl: string },
			project as ProjectConfig & { repo: string },
			workItemId,
			config,
			executionConfig,
		);
	}

	// After a successful splitting run, propagate auto label and optionally chain backlog-manager
	if (agentType === 'splitting' && agentResult.success && workItemId) {
		const chainResult = await propagateAutoLabelAfterSplitting(workItemId, project);
		if (chainResult) {
			await runAgentExecutionPipeline(chainResult, project, config, {
				...executionConfig,
				skipPrepareForAgent: true,
				skipHandleFailure: true,
				logLabel: 'backlog-manager (auto-chain)',
			});
		}
	}

	await tryAutoDebug(agentResult, project, config);
}

/**
 * After a successful splitting agent run, propagate the 'auto' label to all
 * cards in the backlog list and immediately chain to the backlog-manager agent.
 *
 * Only runs if the parent work item has the 'auto' label configured.
 *
 * NOTE: This propagates the label to ALL items currently in the backlog, not just
 * those created by the splitting agent. This is intentional to enable batch auto-processing.
 */
async function propagateAutoLabelAfterSplitting(
	workItemId: string,
	project: ProjectConfig,
): Promise<TriggerResult | null> {
	const pmConfig = resolveProjectPMConfig(project);
	const provider = getPMProvider();

	// Check if parent has the auto label
	let parentWorkItem: Awaited<ReturnType<typeof provider.getWorkItem>>;
	try {
		parentWorkItem = await provider.getWorkItem(workItemId);
	} catch (err) {
		logger.warn('propagateAutoLabelAfterSplitting: failed to fetch parent work item', {
			workItemId,
			error: String(err),
		});
		return null;
	}

	if (!hasAutoLabel(parentWorkItem.labels, pmConfig)) {
		return null;
	}

	const autoLabelId = pmConfig.labels.auto;
	if (!autoLabelId) return null;

	// Resolve the actual label ID from the matched parent work item label.
	// pmConfig.labels.auto may be a human-readable name string (e.g. 'cascade-auto')
	// rather than a UUID when the project was not explicitly configured with UUIDs.
	// Providers like Linear require UUIDs for addLabel — passing a name string causes
	// resolveLabelId() to return null and the operation silently no-ops.
	// By resolving the id from the parent's matched label we always pass the correct
	// identifier regardless of config format.
	// NOTE: The UUID check is scoped to Linear only. Trello uses 24-character MongoDB
	// Object IDs and JIRA uses name strings — both are valid non-UUID formats for those
	// providers and should not produce log noise in happy paths.
	const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	if (project.pm.type === 'linear' && !UUID_REGEX.test(autoLabelId)) {
		logger.warn(
			'propagateAutoLabelAfterSplitting: labels.auto is not a UUID; resolving ID from parent labels',
			{ autoLabelId },
		);
	}
	const matchedLabel = parentWorkItem.labels.find(
		(l) => l.id === autoLabelId || l.name === autoLabelId,
	);
	const resolvedAutoLabelId = matchedLabel ? matchedLabel.id : autoLabelId;

	// List backlog items via the unified call shape — provider self-resolves
	// scope (Trello list / JIRA project / Linear team) and maps the CASCADE
	// status key to its native identifier from its own config.
	let backlogItems: Awaited<ReturnType<typeof provider.listWorkItems>>;
	try {
		backlogItems = await provider.listWorkItems(undefined, { status: 'backlog' });
	} catch (err) {
		logger.warn('propagateAutoLabelAfterSplitting: failed to list backlog items', {
			workItemId,
			error: String(err),
		});
		return null;
	}

	logger.info('Propagating auto label to backlog items after splitting', {
		parentWorkItemId: workItemId,
		backlogItemCount: backlogItems.length,
	});

	// Label all backlog items that don't already have the auto label
	await Promise.all(
		backlogItems
			.filter((item) => !hasAutoLabel(item.labels, pmConfig))
			.map((item) =>
				provider.addLabel(item.id, resolvedAutoLabelId).catch((err) =>
					logger.warn('Failed to add auto label to backlog item', {
						itemId: item.id,
						error: String(err),
					}),
				),
			),
	);

	// Skip chaining if the backlog is empty — no items to process
	if (backlogItems.length === 0) {
		logger.info(
			'propagateAutoLabelAfterSplitting: backlog is empty after splitting, skipping backlog-manager chain',
			{ workItemId },
		);
		return null;
	}

	// Check if backlog-manager trigger is enabled, then chain to it
	const backlogManagerEnabled = await checkTriggerEnabled(
		project.id,
		'backlog-manager',
		'internal:auto-chain',
		'splitting-auto-propagate',
	);
	if (!backlogManagerEnabled) {
		logger.info(
			'propagateAutoLabelAfterSplitting: backlog-manager trigger not enabled, skipping chain',
			{ workItemId },
		);
		return null;
	}

	// Check pipeline capacity before chaining to backlog-manager
	const capacityResult = await isPipelineAtCapacity(project, provider);
	if (capacityResult.atCapacity) {
		logger.info(
			'propagateAutoLabelAfterSplitting: pipeline at capacity, skipping backlog-manager chain',
			{
				workItemId,
				reason: capacityResult.reason,
				inFlightCount: capacityResult.inFlightCount,
				limit: capacityResult.limit,
				availableSlots: capacityResult.availableSlots,
			},
		);
		return null;
	}

	logger.info('Chaining to backlog-manager after splitting with auto label', {
		parentWorkItemId: workItemId,
	});

	return {
		agentType: 'backlog-manager',
		// Include workItemId so PM operations (progress, lifecycle) have the work item ID.
		agentInput: { triggerEvent: 'internal:auto-chain', workItemId: workItemId },
		workItemId,
	};
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
		triggerDebugAnalysis(debugTarget.runId, project, config, debugTarget.workItemId).catch((err) =>
			logger.error('Auto-debug failed', { error: String(err) }),
		);
	}
}
