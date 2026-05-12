/**
 * Trigger handler: Sentry metric alert (metric_alert).
 *
 * Fires the 'alerting' agent when a Sentry metric alert enters a critical
 * or warning state (not on resolution).
 *
 * Supports a `severity` parameter to filter by minimum severity level.
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
import type { SentryAugmentedPayload, SentryMetricAlertPayload } from '../../sentry/types.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { checkTriggerEnabledWithParams } from '../shared/trigger-check.js';

const ACTIVE_ACTIONS = ['critical', 'warning'] as const;

export class SentryMetricAlertTrigger implements TriggerHandler {
	name = 'sentry-metric-alert';
	description = 'Triggers alerting agent when a metric alert enters critical/warning state';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'sentry') return false;
		const p = ctx.payload as SentryAugmentedPayload;
		if (p.resource !== 'metric_alert') return false;
		const innerPayload = p.payload as SentryMetricAlertPayload;
		return ACTIVE_ACTIONS.includes(innerPayload.action as (typeof ACTIVE_ACTIONS)[number]);
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const triggerConfig = await checkTriggerEnabledWithParams(
			ctx.project.id,
			'alerting',
			'alerting:metric-alert',
			this.name,
		);
		if (!triggerConfig.enabled) {
			logger.debug('SentryMetricAlertTrigger: trigger disabled, skipping', {
				projectId: ctx.project.id,
			});
			return null;
		}

		const augmented = ctx.payload as SentryAugmentedPayload;
		const innerPayload = augmented.payload as SentryMetricAlertPayload;
		const action = innerPayload.action; // 'critical' | 'warning'

		// Apply severity filter from parameters
		const minSeverity = (triggerConfig.parameters.severity as string | undefined) ?? 'critical';
		if (minSeverity === 'critical' && action === 'warning') {
			logger.debug('SentryMetricAlertTrigger: action=warning below minimum severity=critical', {
				projectId: ctx.project.id,
			});
			return null;
		}

		// Look up org slug from integration config
		const sentryConfig = await getSentryIntegrationConfig(ctx.project.id);
		if (!sentryConfig) {
			logger.warn('SentryMetricAlertTrigger: no Sentry integration config for project', {
				projectId: ctx.project.id,
			});
			return null;
		}

		const alertTitle = firstUsefulString(
			innerPayload.data?.description_title,
			innerPayload.data?.metric_alert?.alert_rule?.aggregate,
			`Metric Alert (${action})`,
		);

		logger.info('Alerting: metric alert triggered', {
			projectId: ctx.project.id,
			action,
			alertTitle,
			orgId: sentryConfig.organizationSlug,
		});

		// Pre-flight: verify the alerts slot is configured before dispatching.
		// Actual PM card creation is deferred to the worker (processSentryWebhook) so
		// that transient PM failures surface as BullMQ retries rather than being
		// swallowed as non-fatal by processRouterWebhook.
		if (!getAlertsContainerId(ctx.project)) {
			logger.warn('SentryMetricAlertTrigger: alerts slot not configured, skipping dispatch', {
				projectId: ctx.project.id,
				source: 'sentry',
				reason: 'alerts_slot_missing',
			});
			return null;
		}

		// Stable key grouping metric alerts by org + alert title.
		// A rule rename produces a new group — acceptable (noted in comment).
		const alertMetricKey = `${sentryConfig.organizationSlug}:${alertTitle}`;

		return {
			agentType: 'alerting',
			agentInput: {
				triggerEvent: 'alerting:metric-alert',
				// workItemId is intentionally absent here — the worker (processSentryWebhook)
				// materialises the PM card and sets it before running the agent.
				alertMetricKey,
				alertOrgId: sentryConfig.organizationSlug,
				alertTitle,
				alertIssueUrl: firstUsefulUrl(innerPayload.data?.web_url),
			},
			// workItemId omitted — worker sets it after materialisation.
			// lockKey provides router-level work-item concurrency protection while
			// the PM card ID is not yet known. Uses sentry-metric: prefix to avoid
			// collisions with issue alert lock keys (sentry:${issueId}).
			lockKey: `sentry-metric:${alertMetricKey}`,
			// coalesceKey deduplicates rapid re-fires of the same metric alert
			// within the BullMQ coalesce window without requiring a PM card ID.
			coalesceKey: `${ctx.project.id}:sentry-metric:${alertMetricKey}`,
		};
	}
}
