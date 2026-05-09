/**
 * SentryRouterAdapter — platform-specific logic for the router-side
 * Sentry webhook processing pipeline.
 *
 * Uses URL-based routing: each CASCADE project gets a unique webhook URL
 * (POST /sentry/webhook/:projectId). The project ID is injected into the
 * augmented payload by the router before the adapter processes it.
 */

import { withJiraCredentials } from '../../jira/client.js';
import { withLinearCredentials } from '../../linear/client.js';
import type { SentryAugmentedPayload } from '../../sentry/types.js';
import { withTrelloCredentials } from '../../trello/client.js';
import type { TriggerRegistry } from '../../triggers/registry.js';
import type { TriggerContext, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { loadProjectConfig, type RouterProjectConfig } from '../config.js';
import type { AckResult, ParsedWebhookEvent, RouterPlatformAdapter } from '../platform-adapter.js';
import {
	resolveJiraCredentials,
	resolveLinearCredentials,
	resolveTrelloCredentials,
} from '../platformClients/index.js';
import type { CascadeJob, SentryJob } from '../queue.js';
import { withPMScopeForDispatch } from './_shared.js';

// ============================================================================
// Processable resource types
// ============================================================================

// Three Sentry webhook surfaces, each with a distinct trigger handler:
//   - 'event_alert'  → SentryIssueAlertTrigger (Sentry Alert Rule firings)
//   - 'metric_alert' → SentryMetricAlertTrigger (metric-based alert rules)
//   - 'issue'        → SentryIssueLifecycleTrigger (Internal Integration default
//                       surface; new issue created/etc.). Captured live shape
//                       verified against 2026-05-09 prod webhook id
//                       fbdc6d87-b962-444c-8a2a-a9452a74ff71.
const PROCESSABLE_RESOURCES = ['event_alert', 'metric_alert', 'issue'] as const;

// ============================================================================
// Extended parsed event
// ============================================================================

interface SentryParsedEvent extends ParsedWebhookEvent {
	cascadeProjectId: string;
	resource: string;
}

// ============================================================================
// Adapter
// ============================================================================

export class SentryRouterAdapter implements RouterPlatformAdapter {
	readonly type = 'sentry' as const;

	async parseWebhook(payload: unknown): Promise<SentryParsedEvent | null> {
		const p = payload as SentryAugmentedPayload;

		if (!p.cascadeProjectId || !p.resource || !p.payload) {
			logger.warn('SentryRouterAdapter: missing required augmented fields', { payload });
			return null;
		}

		if (!PROCESSABLE_RESOURCES.includes(p.resource as (typeof PROCESSABLE_RESOURCES)[number])) {
			logger.debug('SentryRouterAdapter: ignoring non-processable resource', {
				resource: p.resource,
			});
			return null;
		}

		return {
			projectIdentifier: p.cascadeProjectId,
			eventType: p.resource,
			workItemId: undefined,
			isCommentEvent: false,
			cascadeProjectId: p.cascadeProjectId,
			resource: p.resource,
		};
	}

	isProcessableEvent(event: ParsedWebhookEvent): boolean {
		return PROCESSABLE_RESOURCES.includes(
			event.eventType as (typeof PROCESSABLE_RESOURCES)[number],
		);
	}

	async isSelfAuthored(_event: ParsedWebhookEvent, _payload: unknown): Promise<boolean> {
		// Sentry has no CASCADE bot — alerts are never self-authored
		return false;
	}

	sendReaction(_event: ParsedWebhookEvent, _payload: unknown): void {
		// No reaction mechanism for Sentry alerts
	}

	async resolveProject(event: ParsedWebhookEvent): Promise<RouterProjectConfig | null> {
		const sentryEvent = event as SentryParsedEvent;
		const config = await loadProjectConfig();
		return config.projects.find((p) => p.id === sentryEvent.cascadeProjectId) ?? null;
	}

	async dispatchWithCredentials(
		_event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		triggerRegistry: TriggerRegistry,
	): Promise<TriggerResult | null> {
		const config = await loadProjectConfig();
		const fullProject = config.fullProjects.find((fp) => fp.id === project.id);
		if (!fullProject) {
			logger.info('SentryRouterAdapter: no full project config found', { projectId: project.id });
			return null;
		}

		const ctx: TriggerContext = { project: fullProject, source: 'sentry', payload };

		// Establish PM credential scope so that materializeAlertWorkItem can call
		// PM APIs (createWorkItem, addLabel, moveWorkItem) during trigger dispatch.
		// Mirrors the pattern used by TrelloRouterAdapter / JiraRouterAdapter /
		// LinearRouterAdapter. Without this, PM client AsyncLocalStorage calls fail
		// with "No Xxx credentials in scope" and the dispatch exception is swallowed
		// by processRouterWebhook as non-fatal, silently dropping the alert.
		const pmType = fullProject.pm?.type;
		const dispatch = () => withPMScopeForDispatch(fullProject, () => triggerRegistry.dispatch(ctx));

		if (pmType === 'trello') {
			const creds = await resolveTrelloCredentials(fullProject.id);
			if (!creds) {
				logger.warn('SentryRouterAdapter: missing Trello credentials, cannot dispatch triggers', {
					projectId: fullProject.id,
				});
				return null;
			}
			return withTrelloCredentials(creds, dispatch);
		}

		if (pmType === 'jira') {
			const creds = await resolveJiraCredentials(fullProject.id);
			if (!creds) {
				logger.warn('SentryRouterAdapter: missing JIRA credentials, cannot dispatch triggers', {
					projectId: fullProject.id,
				});
				return null;
			}
			return withJiraCredentials(
				{ email: creds.email, apiToken: creds.apiToken, baseUrl: creds.baseUrl },
				dispatch,
			);
		}

		if (pmType === 'linear') {
			const creds = await resolveLinearCredentials(fullProject.id);
			if (!creds) {
				logger.warn('SentryRouterAdapter: missing Linear credentials, cannot dispatch triggers', {
					projectId: fullProject.id,
				});
				return null;
			}
			return withLinearCredentials({ apiKey: creds.apiKey }, dispatch);
		}

		// No PM integration configured — dispatch without PM credential scope.
		// The trigger handler will catch AlertSlotMissingError and return null
		// before any PM write is attempted.
		return triggerRegistry.dispatch(ctx);
	}

	async postAck(
		_event: ParsedWebhookEvent,
		_payload: unknown,
		_project: RouterProjectConfig,
		_agentType: string,
	): Promise<AckResult | undefined> {
		// No acknowledgment mechanism for Sentry alerts
		return undefined;
	}

	buildJob(
		event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		result: TriggerResult,
	): CascadeJob {
		const job: SentryJob = {
			type: 'sentry',
			source: 'sentry',
			payload,
			projectId: project.id,
			eventType: event.eventType,
			receivedAt: new Date().toISOString(),
			triggerResult: result,
		};
		return job;
	}
}
