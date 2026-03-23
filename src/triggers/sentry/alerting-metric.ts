/**
 * Trigger handler: Sentry metric alert (metric_alert).
 *
 * Fires the 'alerting' agent when a Sentry metric alert enters a critical
 * or warning state (not on resolution).
 *
 * Supports a `severity` parameter to filter by minimum severity level.
 */

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

		const alertTitle =
			innerPayload.data?.description_title ??
			innerPayload.data?.metric_alert?.alert_rule?.aggregate ??
			`Metric Alert (${action})`;

		logger.info('Alerting: metric alert triggered', {
			projectId: ctx.project.id,
			action,
			alertTitle,
			orgId: sentryConfig.organizationSlug,
		});

		return {
			agentType: 'alerting',
			agentInput: {
				triggerEvent: 'alerting:metric-alert',
				alertOrgId: sentryConfig.organizationSlug,
				alertTitle,
				alertIssueUrl: innerPayload.data?.web_url,
			},
		};
	}
}
