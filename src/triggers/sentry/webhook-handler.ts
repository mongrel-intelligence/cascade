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
import type { TriggerResult } from '../../types/index.js';
import { startWatchdog } from '../../utils/lifecycle.js';
import { logger } from '../../utils/logging.js';
import type { TriggerRegistry } from '../registry.js';
import { runAgentExecutionPipeline } from '../shared/agent-execution.js';
import { withAgentTypeConcurrency } from '../shared/concurrency.js';
import { withPMScope } from '../shared/credential-scope.js';
import { resolveTriggerResult } from '../shared/trigger-resolution.js';

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
				// Both SentryIssueAlertTrigger (alertIssueId) and SentryMetricAlertTrigger
				// (alertMetricKey) defer PM card creation to here. The trigger handlers only
				// pre-check that the alerts slot is configured; actual PM card creation happens
				// here where the error propagates to BullMQ's retry budget.
				let resolvedResult = result;
				const alertIssueId =
					typeof result.agentInput.alertIssueId === 'string'
						? result.agentInput.alertIssueId
						: null;
				const alertMetricKey =
					typeof result.agentInput.alertMetricKey === 'string'
						? result.agentInput.alertMetricKey
						: null;
				if (!result.workItemId && (alertIssueId || alertMetricKey)) {
					const { materializeAlertWorkItem } = await import(
						'../../integrations/alerting/_shared/materialize.js'
					);
					const { formatSentryCardBody, formatSentryMetricCardBody } = await import(
						'../../integrations/alerting/_shared/format.js'
					);
					try {
						let workItemId: string;
						if (alertIssueId) {
							const hints = formatSentryCardBody(payload as SentryAugmentedPayload);
							workItemId = await materializeAlertWorkItem(
								'sentry',
								alertIssueId,
								pc.project,
								hints,
							);
						} else {
							// alertMetricKey is guaranteed non-null here (checked above)
							const hints = formatSentryMetricCardBody(payload as SentryAugmentedPayload);
							workItemId = await materializeAlertWorkItem(
								'sentry-metric',
								alertMetricKey as string,
								pc.project,
								hints,
							);
						}
						resolvedResult = {
							...result,
							workItemId,
							agentInput: { ...result.agentInput, workItemId },
						};
					} catch (err) {
						if (err instanceof AlertSlotMissingError) {
							// Slot was unconfigured between router dispatch and worker execution.
							// Treat as a graceful skip (don't retry — the operator must reconfigure).
							logger.warn(
								'processSentryWebhook: alerts slot no longer configured, skipping agent run',
								{ projectId, reason: 'alerts_slot_missing' },
							);
							return;
						}
						// Transient PM failure (5xx, DB error, polling exhaustion): re-throw so
						// BullMQ retries the job rather than silently dropping the alert.
						throw err;
					}
				}

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
