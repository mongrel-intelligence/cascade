/**
 * Trigger handler: Sentry issue-lifecycle webhook (Sentry-Hook-Resource: issue).
 *
 * This is the default surface for Sentry "Internal Integrations" — when a
 * project enables the `issue` webhook permission, Sentry sends one webhook
 * per issue lifecycle event (created / resolved / archived / unresolved /
 * assigned). Distinct from `event_alert` (Sentry Alert Rule firings,
 * handled by SentryIssueAlertTrigger): the same Sentry issue can deliver
 * via both surfaces if both are wired.
 *
 * First cut handles `action: 'created'` only — i.e. fire the alerting
 * agent when a new issue is created in Sentry. Resolved/archived/etc.
 * lifecycle actions are deferred (would auto-close the cascade work item;
 * separate spec scope).
 *
 * PM card materialisation is deferred to the worker side (processSentryWebhook),
 * mirroring the SentryIssueAlertTrigger pattern. This means transient PM
 * failures surface as BullMQ retries rather than being silently swallowed
 * as non-fatal dispatch errors.
 *
 * AlertSource literal is `'sentry-issue'` (distinct from `'sentry'` for
 * event_alert) so the (project_id, external_source, external_id) partial-
 * unique index on pr_work_items doesn't collide with future Alert-Rule
 * webhooks for the same Sentry issue ID.
 */

import { getAlertsContainerId } from '../../pm/config.js';
import { getSentryIntegrationConfig } from '../../sentry/integration.js';
import type { SentryAugmentedPayload, SentryIssuePayload } from '../../sentry/types.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { TRIGGER_EVENTS } from '../shared/events.js';
import { checkTriggerEnabledWithParams } from '../shared/trigger-check.js';

export class SentryIssueLifecycleTrigger implements TriggerHandler {
	name = 'sentry-issue-lifecycle';
	description = 'Triggers alerting agent when a Sentry issue is created (lifecycle webhook)';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'sentry') return false;
		const augmented = ctx.payload as SentryAugmentedPayload;
		if (augmented.resource !== 'issue') return false;
		const inner = augmented.payload as SentryIssuePayload;
		// First cut: only fire on 'created'. Resolved/archived/unresolved/assigned
		// would auto-close or annotate the cascade card — deferred to a future
		// spec to keep the blast radius small.
		return inner.action === 'created';
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const triggerConfig = await checkTriggerEnabledWithParams(
			ctx.project.id,
			'alerting',
			TRIGGER_EVENTS.ALERTING.ISSUE_LIFECYCLE,
			this.name,
		);
		if (!triggerConfig.enabled) {
			logger.debug('SentryIssueLifecycleTrigger: trigger disabled, skipping', {
				projectId: ctx.project.id,
			});
			return null;
		}

		const augmented = ctx.payload as SentryAugmentedPayload;
		const inner = augmented.payload as SentryIssuePayload;
		const issue = inner.data?.issue;

		const issueId = issue?.id;
		if (!issueId) {
			logger.warn('SentryIssueLifecycleTrigger: cannot determine issue ID from payload', {
				projectId: ctx.project.id,
			});
			return null;
		}

		const issueUrl = issue?.web_url ?? issue?.permalink ?? issue?.url;
		const alertTitle = issue?.title?.trim() ? issue.title : 'Sentry Issue';

		// Look up org slug from integration config (mirrors SentryIssueAlertTrigger).
		const sentryConfig = await getSentryIntegrationConfig(ctx.project.id);
		if (!sentryConfig) {
			logger.warn('SentryIssueLifecycleTrigger: no Sentry integration config for project', {
				projectId: ctx.project.id,
			});
			return null;
		}

		// Pre-flight: verify the alerts slot is configured before dispatching.
		// Actual PM card creation is deferred to the worker (processSentryWebhook)
		// so transient PM failures surface as BullMQ retries.
		if (!getAlertsContainerId(ctx.project)) {
			logger.warn('SentryIssueLifecycleTrigger: alerts slot not configured, skipping dispatch', {
				projectId: ctx.project.id,
				source: 'sentry',
				reason: 'alerts_slot_missing',
			});
			return null;
		}

		logger.info('Alerting: Sentry issue-lifecycle event triggered', {
			projectId: ctx.project.id,
			issueId,
			alertTitle,
			orgId: sentryConfig.organizationSlug,
		});

		return {
			agentType: 'alerting',
			agentInput: {
				triggerEvent: TRIGGER_EVENTS.ALERTING.ISSUE_LIFECYCLE,
				// workItemId is intentionally absent — the worker (processSentryWebhook)
				// materialises the PM card via materializeAlertWorkItem('sentry-issue', ...)
				// and sets workItemId before running the agent.
				alertIssueId: issueId,
				alertOrgId: sentryConfig.organizationSlug,
				alertTitle,
				alertIssueUrl: issueUrl,
			},
			// lockKey provides router-level work-item concurrency protection while
			// the PM card ID is not yet known. The `sentry-issue:` namespace is
			// distinct from `sentry:` (event_alert) so the same issue can arrive
			// via both surfaces concurrently without lock contention.
			lockKey: `sentry-issue:${issueId}`,
			// coalesceKey shares the namespace so rapid re-fires of the same
			// issue-lifecycle webhook are coalesced without needing a PM card ID.
			coalesceKey: `${ctx.project.id}:sentry-issue:${issueId}`,
		};
	}
}
