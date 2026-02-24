/**
 * JiraRouterAdapter — platform-specific logic for the router-side
 * JIRA webhook processing pipeline.
 *
 * Extracts the logic previously embedded in `router/jira.ts` into the
 * `RouterPlatformAdapter` interface so it can be driven by the generic
 * `processRouterWebhook()` function.
 */

import { withJiraCredentials } from '../../jira/client.js';
import type { TriggerRegistry } from '../../triggers/registry.js';
import type { TriggerContext, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { extractJiraContext, generateAckMessage } from '../ackMessageGenerator.js';
import { postJiraAck, resolveJiraBotAccountId } from '../acknowledgments.js';
import { type RouterProjectConfig, loadProjectConfig } from '../config.js';
import type { ParsedWebhookEvent, RouterPlatformAdapter } from '../platform-adapter.js';
import { resolveJiraCredentials } from '../platformClients.js';
import { type CascadeJob, type JiraJob, addJob } from '../queue.js';
import { sendAcknowledgeReaction } from '../reactions.js';

const PROCESSABLE_EVENTS = [
	'jira:issue_updated',
	'jira:issue_created',
	'comment_created',
	'comment_updated',
];

/**
 * Extended parsed event for JIRA — carries the issue key and webhook event string.
 */
interface JiraParsedEvent extends ParsedWebhookEvent {
	issueKey: string;
	webhookEvent: string;
	projectId: string;
}

export class JiraRouterAdapter implements RouterPlatformAdapter {
	readonly type = 'jira' as const;

	async parseWebhook(payload: unknown): Promise<JiraParsedEvent | null> {
		const p = payload as Record<string, unknown>;
		const webhookEvent = (p.webhookEvent as string) || '';
		const issue = p.issue as Record<string, unknown> | undefined;
		const issueKey = (issue?.key as string) || '';
		const fields = issue?.fields as Record<string, unknown> | undefined;
		const projectField = fields?.project as Record<string, unknown> | undefined;
		const jiraProjectKey = (projectField?.key as string) || '';

		if (!jiraProjectKey) return null;
		if (!PROCESSABLE_EVENTS.some((e) => webhookEvent.startsWith(e))) return null;

		const config = await loadProjectConfig();
		const project = config.projects.find((proj) => proj.jira?.projectKey === jiraProjectKey);
		if (!project) return null;

		const isCommentEvent = webhookEvent.startsWith('comment_');

		return {
			projectIdentifier: jiraProjectKey,
			eventType: webhookEvent,
			workItemId: issueKey || undefined,
			isCommentEvent,
			issueKey,
			webhookEvent,
			projectId: project.id,
		};
	}

	isProcessableEvent(event: ParsedWebhookEvent): boolean {
		return PROCESSABLE_EVENTS.some((e) => event.eventType.startsWith(e));
	}

	async isSelfAuthored(event: ParsedWebhookEvent, payload: unknown): Promise<boolean> {
		if (!event.isCommentEvent) return false;
		const p = payload as Record<string, unknown>;
		const comment = p.comment as Record<string, unknown> | undefined;
		const author = comment?.author as Record<string, unknown> | undefined;
		const commentAuthorId = author?.accountId as string | undefined;
		if (!commentAuthorId) return false;
		try {
			const projectId = (event as JiraParsedEvent).projectId;
			const botId = await resolveJiraBotAccountId(projectId);
			return !!botId && commentAuthorId === botId;
		} catch {
			return false;
		}
	}

	sendReaction(event: ParsedWebhookEvent, payload: unknown): void {
		if (!event.isCommentEvent) return;
		const projectId = (event as JiraParsedEvent).projectId;
		void sendAcknowledgeReaction('jira', projectId, payload).catch((err) =>
			logger.error('JIRA reaction error', { error: String(err) }),
		);
	}

	async resolveProject(event: ParsedWebhookEvent): Promise<RouterProjectConfig | null> {
		const config = await loadProjectConfig();
		return config.projects.find((p) => p.jira?.projectKey === event.projectIdentifier) ?? null;
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
			logger.info('No full project config for JIRA webhook, skipping', {
				projectId: project.id,
			});
			return null;
		}

		const jiraCreds = await resolveJiraCredentials(project.id);
		if (!jiraCreds) {
			logger.warn('Missing JIRA credentials, cannot dispatch triggers', {
				projectId: project.id,
			});
			return null;
		}

		const ctx: TriggerContext = { project: fullProject, source: 'jira', payload };
		return withJiraCredentials(
			{ email: jiraCreds.email, apiToken: jiraCreds.apiToken, baseUrl: jiraCreds.baseUrl },
			() => triggerRegistry.dispatch(ctx),
		);
	}

	async postAck(
		event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		agentType: string,
	): Promise<string | undefined> {
		const issueKey = (event as JiraParsedEvent).issueKey;
		if (!issueKey) return undefined;
		try {
			const context = extractJiraContext(payload);
			const message = await generateAckMessage(agentType, context, project.id);
			const commentId = await postJiraAck(project.id, issueKey, message);
			return commentId ?? undefined;
		} catch (err) {
			logger.warn('JIRA ack comment failed (non-fatal)', {
				error: String(err),
				issueKey,
			});
			return undefined;
		}
	}

	buildJob(
		event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		result: TriggerResult,
		ackCommentId: string | number | undefined,
	): CascadeJob {
		const jiraEvent = event as JiraParsedEvent;
		const job: JiraJob = {
			type: 'jira',
			source: 'jira',
			payload,
			projectId: project.id,
			issueKey: jiraEvent.issueKey,
			webhookEvent: jiraEvent.webhookEvent,
			receivedAt: new Date().toISOString(),
			ackCommentId: ackCommentId as string | undefined,
			triggerResult: result,
		};
		return job;
	}
}

/**
 * Legacy entry-point wrapper kept for backward compatibility.
 * New code should use `processRouterWebhook()` with the adapter.
 */
export async function handleJiraWebhookViaAdapter(
	payload: unknown,
	triggerRegistry: TriggerRegistry,
): Promise<{ shouldProcess: boolean; project?: RouterProjectConfig; webhookEvent: string }> {
	const p = payload as Record<string, unknown>;
	const webhookEvent = (p.webhookEvent as string) || '';

	const adapter = new JiraRouterAdapter();
	const event = await adapter.parseWebhook(payload);

	if (!event) {
		logger.debug('Ignoring JIRA event', { webhookEvent });
		return { shouldProcess: false, webhookEvent };
	}

	const project = await adapter.resolveProject(event);
	if (!project) {
		logger.debug('Ignoring JIRA event', { webhookEvent });
		return { shouldProcess: false, webhookEvent };
	}

	if (await adapter.isSelfAuthored(event, payload)) {
		logger.info('Ignoring self-authored JIRA comment', { webhookEvent });
		return { shouldProcess: true, project, webhookEvent };
	}

	adapter.sendReaction(event, payload);

	let result: TriggerResult | null = null;
	try {
		result = await adapter.dispatchWithCredentials(event, payload, project, triggerRegistry);
	} catch (err) {
		logger.warn('JIRA trigger dispatch failed (non-fatal)', {
			error: String(err),
			projectId: project.id,
		});
	}

	if (!result) {
		logger.info('No trigger matched for JIRA event', {
			webhookEvent,
			issueKey: (event as { issueKey?: string }).issueKey,
		});
		return { shouldProcess: true, project, webhookEvent };
	}

	logger.info('JIRA trigger matched', {
		agentType: result.agentType,
		issueKey: (event as { issueKey?: string }).issueKey,
		projectId: project.id,
	});

	let ackCommentId: string | undefined;
	if (result.agentType) {
		ackCommentId = (await adapter.postAck(event, payload, project, result.agentType)) as
			| string
			| undefined;
	}

	const job = adapter.buildJob(event, payload, project, result, ackCommentId);
	try {
		const jobId = await addJob(job);
		logger.info('JIRA job queued', { jobId, webhookEvent, ackCommentId });
	} catch (err) {
		logger.error('Failed to queue JIRA job', {
			error: String(err),
			webhookEvent,
			issueKey: (event as { issueKey?: string }).issueKey,
		});
	}

	return { shouldProcess: true, project, webhookEvent };
}
