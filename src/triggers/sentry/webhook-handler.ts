/**
 * Sentry webhook handler.
 *
 * Uses the pre-computed TriggerResult from the router when available,
 * falling back to dispatching through the trigger registry if not.
 * After resolving the trigger result, runs the matched agent via the
 * shared execution pipeline.
 *
 * PM card materialisation happens here (worker side), not in the trigger
 * handler (router side). This ensures transient PM failures (5xx, DB
 * errors, polling exhaustion) surface as BullMQ retries on the worker
 * instead of being swallowed as non-fatal by processRouterWebhook, which
 * would return HTTP 200 to Sentry with no durable job enqueued.
 *
 * Shared utilities used:
 * - Trigger resolution → ../shared/trigger-resolution.ts
 * - Agent-type concurrency → ../shared/concurrency.ts
 * - PM credential scope → ../shared/credential-scope.ts
 */

import { AlertSlotMissingError } from '../../integrations/alerting/_shared/types.js';
import type { SentryAugmentedPayload } from '../../sentry/types.js';
import type { ProjectConfig, TriggerResult } from '../../types/index.js';
import { startWatchdog } from '../../utils/lifecycle.js';
import { logger } from '../../utils/logging.js';
import type { TriggerRegistry } from '../registry.js';
import { runAgentExecutionPipeline } from '../shared/agent-execution.js';
import { withAgentTypeConcurrency } from '../shared/concurrency.js';
import { withPMScope } from '../shared/credential-scope.js';
import { TRIGGER_EVENTS } from '../shared/events.js';
import { resolveTriggerResult } from '../shared/trigger-resolution.js';

/**
 * Materialise the Sentry alert as a PM work item. Picks the right
 * (AlertSource, format helper) pair from the trigger result's agentInput
 * discriminators (`triggerEvent`, `alertIssueId`, `alertMetricKey`).
 *
 * Returns the resolved TriggerResult with `workItemId` populated, or `null`
 * to signal the caller should skip the agent run (alerts slot was
 * unconfigured between router dispatch and worker execution — graceful skip,
 * not a retry; the operator must reconfigure).
 *
 * Re-throws any other error so BullMQ retries the job (transient PM failures
 * — 5xx, DB errors, polling exhaustion).
 */
async function materializeSentryAlertWorkItem(
	result: TriggerResult,
	payload: unknown,
	project: ProjectConfig,
	projectId: string,
): Promise<TriggerResult | null> {
	const triggerEvent =
		typeof result.agentInput.triggerEvent === 'string' ? result.agentInput.triggerEvent : null;
	const alertIssueId =
		typeof result.agentInput.alertIssueId === 'string' ? result.agentInput.alertIssueId : null;
	const alertMetricKey =
		typeof result.agentInput.alertMetricKey === 'string' ? result.agentInput.alertMetricKey : null;
	if (result.workItemId || (!alertIssueId && !alertMetricKey)) return result;

	const { materializeAlertWorkItem } = await import(
		'../../integrations/alerting/_shared/materialize.js'
	);
	const { formatSentryCardBody, formatSentryIssueLifecycleCardBody, formatSentryMetricCardBody } =
		await import('../../integrations/alerting/_shared/format.js');

	const augmented = payload as SentryAugmentedPayload;
	try {
		let workItemId: string;
		if (triggerEvent === TRIGGER_EVENTS.ALERTING.ISSUE_LIFECYCLE && alertIssueId) {
			// Sentry-Hook-Resource: issue (Internal Integration default surface).
			// Distinct AlertSource ('sentry-issue') from event_alert ('sentry') so the
			// partial-unique (project_id, external_source, external_id) index doesn't
			// collide if the same Sentry issue arrives via both surfaces.
			workItemId = await materializeAlertWorkItem(
				'sentry-issue',
				alertIssueId,
				project,
				formatSentryIssueLifecycleCardBody(augmented),
			);
		} else if (alertIssueId) {
			// event_alert path (Sentry Alert Rule firings).
			workItemId = await materializeAlertWorkItem(
				'sentry',
				alertIssueId,
				project,
				formatSentryCardBody(augmented),
			);
		} else {
			// alertMetricKey is guaranteed non-null here (checked above).
			workItemId = await materializeAlertWorkItem(
				'sentry-metric',
				alertMetricKey as string,
				project,
				formatSentryMetricCardBody(augmented),
			);
		}
		return {
			...result,
			workItemId,
			agentInput: { ...result.agentInput, workItemId },
		};
	} catch (err) {
		if (err instanceof AlertSlotMissingError) {
			logger.warn('processSentryWebhook: alerts slot no longer configured, skipping agent run', {
				projectId,
				reason: 'alerts_slot_missing',
			});
			return null;
		}
		throw err;
	}
}

export async function processSentryWebhook(
	payload: unknown,
	projectId: string,
	registry: TriggerRegistry,
	triggerResult?: TriggerResult,
): Promise<void> {
	const { loadProjectConfigById } = await import('../../config/provider.js');

	const pc = await loadProjectConfigById(projectId);
	if (!pc) {
		logger.warn('processSentryWebhook: project not found, skipping', { projectId });
		return;
	}

	const ctx = {
		project: pc.project,
		source: 'sentry' as const,
		payload,
	};

	// Resolve trigger result — use pre-computed from router or dispatch via registry
	const result = await resolveTriggerResult(registry, ctx, triggerResult, 'processSentryWebhook');

	if (!result) {
		logger.info('processSentryWebhook: no trigger matched', { projectId });
		return;
	}

	if (!result.agentType) {
		logger.info('processSentryWebhook: trigger matched but no agent type, skipping', {
			projectId,
		});
		return;
	}

	logger.info('processSentryWebhook: running agent', {
		projectId,
		agentType: result.agentType,
	});

	await withAgentTypeConcurrency(
		pc.project.id,
		result.agentType,
		() => {
			// Only start the watchdog when the agent actually runs (after concurrency check passes).
			// Starting it before the check risks a spurious process.exit(1) if the container
			// is still alive after a concurrency-blocked job finishes.
			startWatchdog(pc.project.watchdogTimeoutMs);
			return withPMScope(pc.project, async () => {
				// Materialise the PM work item on the worker side so that transient PM
				// failures (Trello/JIRA/Linear 5xx, DB errors, polling exhaustion) surface
				// as BullMQ retries instead of being swallowed as non-fatal dispatch errors
				// by processRouterWebhook (which returns HTTP 200 to Sentry, preventing retries).
				//
				// All three Sentry trigger handlers (issue-alert, metric-alert,
				// issue-lifecycle) defer PM card creation to here. The trigger handlers
				// only pre-check that the alerts slot is configured; actual creation
				// happens here where the error propagates to BullMQ's retry budget.
				const resolvedResult = await materializeSentryAlertWorkItem(
					result,
					payload,
					pc.project,
					projectId,
				);
				if (resolvedResult === null) return; // alerts slot unconfigured — graceful skip

				return runAgentExecutionPipeline(resolvedResult, pc.project, pc.config, {
					logLabel: 'Sentry agent',
					skipPrepareForAgent: true,
					skipHandleFailure: true,
				});
			});
		},
		'processSentryWebhook',
		result.workItemId,
	);
}
