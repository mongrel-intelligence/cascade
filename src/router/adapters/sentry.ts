/**
 * SentryRouterAdapter — platform-specific logic for the router-side
 * Sentry webhook processing pipeline.
 *
 * Uses URL-based routing: each CASCADE project gets a unique webhook URL
 * (POST /sentry/webhook/:projectId). The project ID is injected into the
 * augmented payload by the router before the adapter processes it.
 */

import type { SentryAugmentedPayload } from '../../sentry/types.js';
import type { TriggerRegistry } from '../../triggers/registry.js';
import type { TriggerContext, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { loadProjectConfig, type RouterProjectConfig } from '../config.js';
import type { AckResult, ParsedWebhookEvent, RouterPlatformAdapter } from '../platform-adapter.js';
import type { CascadeJob, SentryJob } from '../queue.js';

// ============================================================================
// Processable resource types
// ============================================================================

const PROCESSABLE_RESOURCES = ['event_alert', 'metric_alert'] as const;

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
