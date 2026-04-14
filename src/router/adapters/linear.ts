/**
 * LinearRouterAdapter — platform-specific logic for the router-side
 * Linear webhook processing pipeline.
 *
 * Follows the same pattern as JiraRouterAdapter and SentryRouterAdapter,
 * implementing RouterPlatformAdapter so it can be driven by the generic
 * processRouterWebhook() function.
 */

import { withLinearCredentials } from '../../linear/client.js';
import type { LinearWebhookPayload } from '../../linear/types.js';
import type { TriggerRegistry } from '../../triggers/registry.js';
import type { TriggerContext, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { buildWorkItemRunsLink, getDashboardUrl } from '../../utils/runLink.js';
import { extractLinearContext, generateAckMessage } from '../ackMessageGenerator.js';
import { postLinearAck, resolveLinearBotUserId } from '../acknowledgments.js';
import { loadProjectConfig, type RouterProjectConfig } from '../config.js';
import type { AckResult, ParsedWebhookEvent, RouterPlatformAdapter } from '../platform-adapter.js';
import { resolveLinearCredentials } from '../platformClients/index.js';
import type { CascadeJob, LinearJob } from '../queue.js';

// ============================================================================
// Processable event combinations (action/type)
// ============================================================================

const PROCESSABLE_TYPES = ['Issue', 'Comment', 'IssueLabel'] as const;

type ProcessableType = (typeof PROCESSABLE_TYPES)[number];

// ============================================================================
// Extended parsed event for Linear
// ============================================================================

interface LinearParsedEvent extends ParsedWebhookEvent {
	projectId: string;
	action: string;
	resourceType: string;
}

// ============================================================================
// Adapter
// ============================================================================

export class LinearRouterAdapter implements RouterPlatformAdapter {
	readonly type = 'linear' as const;

	async parseWebhook(payload: unknown): Promise<LinearParsedEvent | null> {
		const p = payload as LinearWebhookPayload;

		if (!p.action || !p.type || !p.data) {
			logger.warn('LinearRouterAdapter: missing required fields', { payload });
			return null;
		}

		if (!PROCESSABLE_TYPES.includes(p.type as ProcessableType)) {
			logger.debug('LinearRouterAdapter: ignoring non-processable type', { type: p.type });
			return null;
		}

		// Extract teamId from payload data for project lookup
		const data = p.data as Record<string, unknown>;
		const teamId = data.teamId as string | undefined;

		if (!teamId) {
			logger.debug('LinearRouterAdapter: no teamId in payload data, skipping');
			return null;
		}

		const config = await loadProjectConfig();
		const project = config.projects.find((proj) => proj.linear?.teamId === teamId);
		if (!project) {
			logger.debug('LinearRouterAdapter: no project found for teamId', { teamId });
			return null;
		}

		const isCommentEvent = p.type === 'Comment';
		const workItemId = isCommentEvent
			? (data.issueId as string | undefined)
			: (data.id as string | undefined);

		return {
			projectIdentifier: teamId,
			eventType: `${p.action}/${p.type}`,
			workItemId,
			isCommentEvent,
			projectId: project.id,
			action: p.action,
			resourceType: p.type,
		};
	}

	isProcessableEvent(event: ParsedWebhookEvent): boolean {
		// All parsed events are processable (we filter in parseWebhook)
		return PROCESSABLE_TYPES.some((t) => event.eventType.endsWith(`/${t}`));
	}

	async isSelfAuthored(event: ParsedWebhookEvent, payload: unknown): Promise<boolean> {
		if (!event.isCommentEvent) return false;
		const data = (payload as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
		const commentAuthorId = data?.userId as string | undefined;
		if (!commentAuthorId) return false;
		try {
			const projectId = (event as LinearParsedEvent).projectId;
			const botId = await resolveLinearBotUserId(projectId);
			return !!botId && commentAuthorId === botId;
		} catch {
			return false;
		}
	}

	sendReaction(_event: ParsedWebhookEvent, _payload: unknown): void {
		// Linear does not support emoji reactions on comments via the same API pattern.
		// No-op for now.
	}

	async resolveProject(event: ParsedWebhookEvent): Promise<RouterProjectConfig | null> {
		const config = await loadProjectConfig();
		return config.projects.find((p) => p.linear?.teamId === event.projectIdentifier) ?? null;
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
			logger.info('LinearRouterAdapter: no full project config found', {
				projectId: project.id,
			});
			return null;
		}

		const linearCreds = await resolveLinearCredentials(project.id);
		if (!linearCreds) {
			logger.warn('LinearRouterAdapter: missing Linear credentials, cannot dispatch triggers', {
				projectId: project.id,
			});
			return null;
		}

		const ctx: TriggerContext = { project: fullProject, source: 'linear', payload };
		return withLinearCredentials({ apiKey: linearCreds.apiKey }, () =>
			triggerRegistry.dispatch(ctx),
		);
	}

	async postAck(
		event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		agentType: string,
		_triggerResult?: TriggerResult,
	): Promise<AckResult | undefined> {
		const linearEvent = event as LinearParsedEvent;
		const issueId = linearEvent.workItemId;
		if (!issueId) return undefined;

		try {
			const context = extractLinearContext(payload);
			let message = await generateAckMessage(agentType, context, project.id);

			// Append run link footer when enabled for this project
			const config = await loadProjectConfig();
			const fullProject = config.fullProjects.find((fp) => fp.id === project.id);
			if (fullProject?.runLinksEnabled && event.workItemId) {
				const dashboardUrl = getDashboardUrl();
				if (dashboardUrl) {
					const link = buildWorkItemRunsLink({
						dashboardUrl,
						projectId: project.id,
						workItemId: event.workItemId,
					});
					if (link) message += link;
				}
			}

			const commentId = await postLinearAck(project.id, issueId, message);
			if (commentId) return { commentId, message };
			return undefined;
		} catch (err) {
			logger.warn('LinearRouterAdapter: ack comment failed (non-fatal)', {
				error: String(err),
				issueId,
			});
			return undefined;
		}
	}

	buildJob(
		event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		result: TriggerResult,
		ackResult?: AckResult,
	): CascadeJob {
		const linearEvent = event as LinearParsedEvent;
		const job: LinearJob = {
			type: 'linear',
			source: 'linear',
			payload,
			projectId: project.id,
			workItemId: linearEvent.workItemId,
			eventType: linearEvent.eventType,
			receivedAt: new Date().toISOString(),
			triggerResult: result,
			ackCommentId: ackResult?.commentId as string | undefined,
		};
		return job;
	}
}
