/**
 * Trigger handler: Sentry issue alert (event_alert).
 *
 * Fires the 'alerting' agent when a Sentry issue alert rule triggers.
 * The payload includes the full event object (exception, stacktrace, breadcrumbs).
 *
 * PM card materialisation is intentionally deferred to the worker side
 * (processSentryWebhook). This means transient PM failures (5xx, DB errors,
 * polling exhaustion) surface as BullMQ retries on the worker rather than
 * being silently swallowed as non-fatal dispatch errors by processRouterWebhook,
 * which would return HTTP 200 to Sentry with no job ever enqueued.
 */

import { firstUsefulString, firstUsefulUrl } from '../../integrations/alerting/_shared/format.js';
import { getAlertsContainerId } from '../../pm/config.js';
import { getSentryIntegrationConfig } from '../../sentry/integration.js';
import type { SentryAugmentedPayload, SentryIssueAlertPayload } from '../../sentry/types.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { checkTriggerEnabledWithParams } from '../shared/trigger-check.js';

export class SentryIssueAlertTrigger implements TriggerHandler {
	name = 'sentry-issue-alert';
	description = 'Triggers alerting agent when an issue alert fires';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'sentry') return false;
		const p = ctx.payload as SentryAugmentedPayload;
		return p.resource === 'event_alert';
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const triggerConfig = await checkTriggerEnabledWithParams(
			ctx.project.id,
			'alerting',
			'alerting:issue-alert',
			this.name,
		);
		if (!triggerConfig.enabled) {
			logger.debug('SentryIssueAlertTrigger: trigger disabled, skipping', {
				projectId: ctx.project.id,
			});
			return null;
		}

		const augmented = ctx.payload as SentryAugmentedPayload;
		const innerPayload = augmented.payload as SentryIssueAlertPayload;

		// Extract issue/event info from the payload
		const event = innerPayload.data?.event;
		const issueId = event?.issue_id ?? event?.issue_url?.split('/').pop();
		const issueUrl = firstUsefulUrl(event?.web_url, event?.issue_url);
		const alertTitle = firstUsefulString(
			innerPayload.data?.issue_alert?.title,
			innerPayload.data?.triggered_rule,
			event?.title,
			'Issue Alert',
		);

		if (!issueId) {
			logger.warn('SentryIssueAlertTrigger: cannot determine issue ID from payload', {
				projectId: ctx.project.id,
			});
			return null;
		}

		// Look up org slug from integration config
		const sentryConfig = await getSentryIntegrationConfig(ctx.project.id);
		if (!sentryConfig) {
			logger.warn('SentryIssueAlertTrigger: no Sentry integration config for project', {
				projectId: ctx.project.id,
			});
			return null;
		}

		logger.info('Alerting: issue alert triggered', {
			projectId: ctx.project.id,
			issueId,
			alertTitle,
			orgId: sentryConfig.organizationSlug,
		});

		// Pre-flight: verify the alerts slot is configured before dispatching.
		// Actual PM card creation is deferred to the worker (processSentryWebhook) so
		// that transient PM failures surface as BullMQ retries rather than being
		// swallowed as non-fatal by processRouterWebhook.
		if (!getAlertsContainerId(ctx.project)) {
			logger.warn('SentryIssueAlertTrigger: alerts slot not configured, skipping dispatch', {
				projectId: ctx.project.id,
				source: 'sentry',
				reason: 'alerts_slot_missing',
			});
			return null;
		}

		return {
			agentType: 'alerting',
			agentInput: {
				triggerEvent: 'alerting:issue-alert',
				// workItemId is intentionally absent here — the worker (processSentryWebhook)
				// materialises the PM card and sets it before running the agent.
				alertIssueId: issueId,
				alertOrgId: sentryConfig.organizationSlug,
				alertTitle,
				alertIssueUrl: issueUrl,
			},
			// workItemId omitted — worker sets it after materialisation.
			// lockKey provides router-level work-item concurrency protection while the
			// PM card ID is not yet known. Ensures a second Sentry delivery for the same
			// issue cannot enqueue while the first worker is still active.
			lockKey: `sentry:${issueId}`,
			// coalesceKey uses the Sentry issue ID so rapid re-fires of the same alert
			// are coalesced without needing a PM card ID.
			coalesceKey: `${ctx.project.id}:sentry:${issueId}`,
		};
	}
}
