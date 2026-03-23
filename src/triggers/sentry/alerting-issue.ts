/**
 * Trigger handler: Sentry issue alert (event_alert).
 *
 * Fires the 'alerting' agent when a Sentry issue alert rule triggers.
 * The payload includes the full event object (exception, stacktrace, breadcrumbs).
 */

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
		const issueUrl = event?.web_url ?? event?.issue_url;
		const alertTitle =
			innerPayload.data?.issue_alert?.title ??
			innerPayload.data?.triggered_rule ??
			event?.title ??
			'Issue Alert';

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

		return {
			agentType: 'alerting',
			agentInput: {
				triggerEvent: 'alerting:issue-alert',
				alertIssueId: issueId,
				alertOrgId: sentryConfig.organizationSlug,
				alertTitle,
				alertIssueUrl: issueUrl,
			},
		};
	}
}
