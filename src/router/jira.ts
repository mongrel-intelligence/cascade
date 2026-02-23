/**
 * JIRA webhook handler for the router (multi-container) deployment mode.
 *
 * Runs full trigger dispatch() to determine if a job should be queued.
 * Only posts ack comments and queues jobs when dispatch confirms a match.
 */

import { withJiraCredentials } from '../jira/client.js';
import type { TriggerRegistry } from '../triggers/registry.js';
import type { ProjectConfig, TriggerContext, TriggerResult } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { extractJiraContext, generateAckMessage } from './ackMessageGenerator.js';
import { postJiraAck, resolveJiraBotAccountId } from './acknowledgments.js';
import { type RouterProjectConfig, loadProjectConfig } from './config.js';
import { resolveJiraCredentials } from './platformClients.js';
import { type CascadeJob, addJob } from './queue.js';
import { sendAcknowledgeReaction } from './reactions.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export async function isSelfAuthoredJiraComment(
	webhookEvent: string,
	payload: unknown,
	projectId: string,
): Promise<boolean> {
	if (!webhookEvent.startsWith('comment_')) return false;
	const p = payload as Record<string, unknown>;
	const comment = p.comment as Record<string, unknown> | undefined;
	const author = comment?.author as Record<string, unknown> | undefined;
	const commentAuthorId = author?.accountId as string | undefined;
	if (!commentAuthorId) return false;
	try {
		const botId = await resolveJiraBotAccountId(projectId);
		return !!botId && commentAuthorId === botId;
	} catch {
		return false; // Identity resolution failed — proceed normally
	}
}

/**
 * Run authoritative dispatch and, if matched, post ack + queue job.
 */
export async function processJiraWebhookEvent(
	project: RouterProjectConfig,
	issueKey: string,
	webhookEvent: string,
	payload: unknown,
	fullProjects: ProjectConfig[],
	triggerRegistry: TriggerRegistry,
): Promise<void> {
	// Fire-and-forget acknowledgment reaction — only for comment events
	if (webhookEvent.startsWith('comment_')) {
		void sendAcknowledgeReaction('jira', project.id, payload).catch((err) =>
			logger.error('JIRA reaction error', { error: String(err) }),
		);
	}

	// Run authoritative trigger dispatch with credentials in scope
	const fullProject = fullProjects.find((fp) => fp.id === project.id);
	if (!fullProject) {
		logger.info('No full project config for JIRA webhook, skipping', { projectId: project.id });
		return;
	}

	let result: TriggerResult | null = null;
	try {
		const jiraCreds = await resolveJiraCredentials(project.id);
		if (!jiraCreds) {
			logger.warn('Missing JIRA credentials, cannot dispatch triggers', { projectId: project.id });
		} else {
			const ctx: TriggerContext = { project: fullProject, source: 'jira', payload };
			result = await withJiraCredentials(
				{ email: jiraCreds.email, apiToken: jiraCreds.apiToken, baseUrl: jiraCreds.baseUrl },
				() => triggerRegistry.dispatch(ctx),
			);
		}
	} catch (err) {
		logger.warn('JIRA trigger dispatch failed (non-fatal)', {
			error: String(err),
			projectId: project.id,
		});
	}

	if (!result) {
		logger.info('No trigger matched for JIRA event', { webhookEvent, issueKey });
		return;
	}

	logger.info('JIRA trigger matched', {
		agentType: result.agentType,
		issueKey,
		projectId: project.id,
	});

	// Post ack comment — we KNOW the trigger matched
	let ackCommentId: string | undefined;
	if (result.agentType) {
		try {
			const context = extractJiraContext(payload);
			const message = await generateAckMessage(result.agentType, context, project.id);
			const commentId = await postJiraAck(project.id, issueKey, message);
			ackCommentId = commentId ?? undefined;
		} catch (err) {
			logger.warn('JIRA ack comment failed (non-fatal)', { error: String(err), issueKey });
		}
	}

	// Queue job with confirmed trigger result
	const job: CascadeJob = {
		type: 'jira',
		source: 'jira',
		payload,
		projectId: project.id,
		issueKey,
		webhookEvent,
		receivedAt: new Date().toISOString(),
		ackCommentId,
		triggerResult: result,
	};

	try {
		const jobId = await addJob(job);
		logger.info('JIRA job queued', { jobId, webhookEvent, ackCommentId });
	} catch (err) {
		logger.error('Failed to queue JIRA job', { error: String(err), webhookEvent, issueKey });
	}
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const PROCESSABLE_EVENTS = [
	'jira:issue_updated',
	'jira:issue_created',
	'comment_created',
	'comment_updated',
];

/**
 * Handle a POST /jira/webhook request.
 * Parses the payload, filters irrelevant events, dispatches triggers,
 * and queues a job only when a trigger confirms a match.
 */
export async function handleJiraWebhook(
	payload: unknown,
	triggerRegistry: TriggerRegistry,
): Promise<{ shouldProcess: boolean; project?: RouterProjectConfig; webhookEvent: string }> {
	const p = payload as Record<string, unknown>;
	const webhookEvent = (p.webhookEvent as string) || '';
	const issue = p.issue as Record<string, unknown> | undefined;
	const issueKey = (issue?.key as string) || '';
	const fields = issue?.fields as Record<string, unknown> | undefined;
	const projectField = fields?.project as Record<string, unknown> | undefined;
	const jiraProjectKey = (projectField?.key as string) || '';

	// Match JIRA project key to a configured project
	const config = await loadProjectConfig();
	const project = jiraProjectKey
		? config.projects.find((proj) => proj.jira?.projectKey === jiraProjectKey)
		: undefined;

	const shouldProcess = !!project && PROCESSABLE_EVENTS.some((e) => webhookEvent.startsWith(e));

	if (shouldProcess && project) {
		if (await isSelfAuthoredJiraComment(webhookEvent, payload, project.id)) {
			logger.info('Ignoring self-authored JIRA comment', { webhookEvent });
		} else {
			await processJiraWebhookEvent(
				project,
				issueKey,
				webhookEvent,
				payload,
				config.fullProjects,
				triggerRegistry,
			);
		}
	} else {
		logger.debug('Ignoring JIRA event', { webhookEvent });
	}

	return { shouldProcess, project, webhookEvent };
}
