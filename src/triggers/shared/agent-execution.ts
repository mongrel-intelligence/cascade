import { runAgent } from '../../agents/registry.js';
import { createWorkItem, linkPRToWorkItem } from '../../db/repositories/prWorkItemsRepository.js';
import { updateRunPRNumber } from '../../db/repositories/runsRepository.js';
import { getJiraConfig, getTrelloConfig } from '../../pm/config.js';
import { getPMProvider } from '../../pm/context.js';
import {
	PMLifecycleManager,
	createPMProvider,
	hasAutoLabel,
	resolveProjectPMConfig,
} from '../../pm/index.js';
import { checkTriggerEnabled } from '../../triggers/shared/trigger-check.js';
import type { AgentResult, CascadeConfig, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { extractPRNumber } from '../../utils/prUrl.js';
import type { TriggerResult } from '../types.js';
import { handleAgentResultArtifacts } from './agent-result-handler.js';
import { checkBudgetExceeded } from './budget.js';
import { triggerDebugAnalysis } from './debug-runner.js';
import { shouldTriggerDebug } from './debug-trigger.js';
import {
	type ValidationResult,
	formatValidationErrors,
	validateIntegrations,
} from './integration-validation.js';

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
	 * Optional callback invoked when the agent succeeds (after pipeline completes).
	 * Used by GitHub to delete the progress comment for non-implementation agents.
	 */
	onSuccess?: (result: TriggerResult, agentResult: AgentResult) => Promise<void>;

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
	agentType: string,
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

	await handleAgentResultArtifacts(workItemId, agentType, agentResult, project);

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
		(!handleSuccessOnlyForAgentType || agentType === handleSuccessOnlyForAgentType);

	if (shouldCallHandleSuccess) {
		await lifecycle.handleSuccess(
			workItemId,
			agentType,
			agentResult.prUrl,
			agentResult.progressCommentId,
		);
	} else if (!agentResult.success && !skipHandleFailure) {
		await lifecycle.handleFailure(workItemId, agentResult.error);
	}
}

/**
 * Notify PM and GitHub when integration validation fails before the agent runs.
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
 * Link a PR to a work item and backfill the run's prNumber after agent execution.
 * Extracted to reduce cognitive complexity in the main pipeline function.
 */
async function linkPRPostExecution(
	agentResult: AgentResult & { prUrl: string },
	project: ProjectConfig & { repo: string },
	result: TriggerResult,
	workItemId: string,
): Promise<void> {
	const prNumber = extractPRNumber(agentResult.prUrl);
	if (!prNumber) return;

	// Fetch PR title from GitHub API (best-effort, resolves the prTitle gap)
	let prTitle: string | undefined;
	try {
		const { githubClient } = await import('../../github/client.js');
		const { parseRepoFullName } = await import('../../utils/repo.js');
		const { owner, repo } = parseRepoFullName(project.repo);
		const pr = await githubClient.getPR(owner, repo, prNumber);
		prTitle = pr.title;
	} catch (err) {
		logger.warn('Failed to fetch PR title from GitHub', {
			projectId: project.id,
			prNumber,
			error: String(err),
		});
	}

	try {
		await linkPRToWorkItem(project.id, project.repo, prNumber, workItemId, {
			prUrl: agentResult.prUrl,
			prTitle,
			workItemUrl: result.workItemUrl,
			workItemTitle: result.workItemTitle,
		});
	} catch (err) {
		logger.warn('Failed to link PR to work item post-execution', {
			projectId: project.id,
			prNumber,
			workItemId,
			error: String(err),
		});
	}

	if (agentResult.runId) {
		try {
			await updateRunPRNumber(agentResult.runId, prNumber);
		} catch (err) {
			logger.warn('Failed to backfill prNumber on run', {
				runId: agentResult.runId,
				prNumber,
				error: String(err),
			});
		}
	}
}

/**
 * Post the review summary to the PM work item after a successful review agent run.
 * Cross-source concern: fires for all trigger types (GitHub, Trello, JIRA).
 */
async function postReviewSummaryToPM(
	agentType: string,
	agentResult: AgentResult,
	workItemId: string | undefined,
	projectId: string,
	prNumber: number | undefined,
): Promise<void> {
	if (agentType !== 'review' || !agentResult.success) return;

	const { getSessionState } = await import('../../gadgets/sessionState.js');
	const sessionState = getSessionState();
	if (!sessionState.reviewBody) return;

	// Resolve workItemId: prefer TriggerResult, fall back to DB lookup
	let resolvedWorkItemId = workItemId;
	if (!resolvedWorkItemId && prNumber && projectId) {
		try {
			const { lookupWorkItemForPR } = await import(
				'../../db/repositories/prWorkItemsRepository.js'
			);
			resolvedWorkItemId = (await lookupWorkItemForPR(projectId, prNumber)) ?? undefined;
		} catch {
			/* best-effort */
		}
	}
	if (!resolvedWorkItemId) return;

	const { postReviewToPM } = await import('./review-pm-poster.js');
	await postReviewToPM(
		resolvedWorkItemId,
		{
			reviewBody: sessionState.reviewBody,
			reviewEvent: sessionState.reviewEvent,
			reviewUrl: sessionState.reviewUrl,
		},
		agentResult.progressCommentId,
	);
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

	// Pre-flight integration validation
	const validation = await validateIntegrations(project.id, agentType);
	if (!validation.valid) {
		await notifyValidationFailure(
			result,
			validation,
			lifecycle,
			executionConfig,
			agentType,
			project.id,
		);
		return;
	}

	const { skipPrepareForAgent = false, onSuccess, onFailure, logLabel = 'Agent' } = executionConfig;

	const workItemId = result.workItemId;

	let remainingBudgetUsd: number | undefined;
	if (workItemId) {
		const budgetResult = await checkPreRunBudget(workItemId, project, config, lifecycle);
		if (budgetResult.abort) return;
		remainingBudgetUsd = budgetResult.remainingBudgetUsd;
	}

	// Insert a work-item-only row so PM-triggered runs show up in the dashboard
	// even before a PR is created. This is idempotent — if a row already exists
	// it is updated with the latest display fields.
	if (workItemId) {
		try {
			await createWorkItem(project.id, workItemId, {
				workItemUrl: result.workItemUrl,
				workItemTitle: result.workItemTitle,
			});
		} catch (err) {
			logger.warn('Failed to persist work-item row for PM-triggered run', {
				projectId: project.id,
				workItemId,
				error: String(err),
			});
		}
	}

	if (workItemId && !skipPrepareForAgent) {
		await lifecycle.prepareForAgent(workItemId, agentType);
	}

	const agentResult = await runAgent(agentType, {
		...result.agentInput,
		remainingBudgetUsd,
		project,
		config,
	});

	// Link PR to work item post-execution (single code path for all backends)
	if (agentResult.success && agentResult.prUrl && workItemId && project.repo) {
		await linkPRPostExecution(
			agentResult as AgentResult & { prUrl: string },
			project as ProjectConfig & { repo: string },
			result,
			workItemId,
		);
	}

	// Post review summary to PM work item (cross-source: works for all trigger types)
	await postReviewSummaryToPM(agentType, agentResult, workItemId, project.id, result.prNumber);

	if (workItemId) {
		await runPostAgentLifecycle(
			workItemId,
			agentType,
			agentResult,
			project,
			config,
			lifecycle,
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

	// List all backlog items and add auto label
	let backlogItems: Awaited<ReturnType<typeof provider.listWorkItems>>;
	try {
		if (provider.type === 'trello') {
			// Trello: containerId is the list ID
			const backlogListId = getTrelloConfig(project)?.lists?.backlog;
			if (!backlogListId) {
				logger.warn(
					'propagateAutoLabelAfterSplitting: no backlog list configured for Trello, skipping',
					{ workItemId },
				);
				return null;
			}
			backlogItems = await provider.listWorkItems(backlogListId);
		} else if (provider.type === 'jira') {
			// JIRA: use server-side JQL filtering by status to avoid fetching all project issues
			const jiraConfig = getJiraConfig(project);
			const backlogStatus = jiraConfig?.statuses?.backlog;
			const projectKey = jiraConfig?.projectKey;
			if (!backlogStatus || !projectKey) {
				logger.warn(
					'propagateAutoLabelAfterSplitting: no backlog status or projectKey configured for JIRA, skipping',
					{ workItemId },
				);
				return null;
			}
			backlogItems = await provider.listWorkItems(projectKey, { status: backlogStatus });
			logger.info('JIRA backlog items fetched for auto-label propagation', {
				backlogCount: backlogItems.length,
				projectKey,
			});
		} else {
			logger.warn('propagateAutoLabelAfterSplitting: unsupported PM provider type', {
				providerType: provider.type,
			});
			return null;
		}
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
				provider.addLabel(item.id, autoLabelId).catch((err) =>
					logger.warn('Failed to add auto label to backlog item', {
						itemId: item.id,
						error: String(err),
					}),
				),
			),
	);

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

	logger.info('Chaining to backlog-manager after splitting with auto label', {
		parentWorkItemId: workItemId,
	});

	return {
		agentType: 'backlog-manager',
		agentInput: { triggerEvent: 'internal:auto-chain' },
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
		triggerDebugAnalysis(debugTarget.runId, project, config, debugTarget.cardId).catch((err) =>
			logger.error('Auto-debug failed', { error: String(err) }),
		);
	}
}
