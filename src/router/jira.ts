/**
 * JIRA webhook handler for the router (multi-container) deployment mode.
 *
 * Handles webhook parsing, self-comment filtering, ack posting, and job queuing
 * for JIRA webhook events.
 */

import type { TriggerRegistry } from '../triggers/registry.js';
import type { ProjectConfig, TriggerContext } from '../types/index.js';
import { extractJiraContext, generateAckMessage } from './ackMessageGenerator.js';
import { postJiraAck, resolveJiraBotAccountId } from './acknowledgments.js';
import { type RouterProjectConfig, loadProjectConfig } from './config.js';
import { type CascadeJob, addJob } from './queue.js';
import { sendAcknowledgeReaction } from './reactions.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Try to match a trigger and post an ack comment for a JIRA webhook.
 * Returns the ack comment ID if posted, undefined otherwise.
 */
export async function tryPostJiraAck(
	projectId: string,
	issueKey: string,
	payload: unknown,
	fullProjects: ProjectConfig[],
	triggerRegistry: TriggerRegistry,
): Promise<string | undefined> {
	const fullProject = fullProjects.find((fp) => fp.id === projectId);
	if (!fullProject || !issueKey) return undefined;

	const ctx: TriggerContext = { project: fullProject, source: 'jira', payload };
	const match = triggerRegistry.matchTrigger(ctx);
	if (!match) return undefined;

	const context = extractJiraContext(payload);
	const message = await generateAckMessage(match.agentType, context, projectId);

	const commentId = await postJiraAck(projectId, issueKey, message);
	return commentId ?? undefined;
}

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

export async function queueJiraJob(
	project: RouterProjectConfig,
	issueKey: string,
	webhookEvent: string,
	payload: unknown,
	fullProjects: ProjectConfig[],
	triggerRegistry: TriggerRegistry,
): Promise<void> {
	console.log('[Router] Queueing JIRA job:', { webhookEvent, issueKey, projectId: project.id });

	// Fire-and-forget acknowledgment reaction — only for comment events
	if (webhookEvent.startsWith('comment_')) {
		void sendAcknowledgeReaction('jira', project.id, payload).catch((err) =>
			console.error('[Router] JIRA reaction error:', err),
		);
	}

	// Try to post an ack comment via trigger matching (non-blocking best-effort)
	let ackCommentId: string | undefined;
	try {
		ackCommentId = await tryPostJiraAck(
			project.id,
			issueKey,
			payload,
			fullProjects,
			triggerRegistry,
		);
	} catch (err) {
		console.warn('[Router] JIRA ack comment failed (non-fatal):', String(err));
	}

	const job: CascadeJob = {
		type: 'jira',
		source: 'jira',
		payload,
		projectId: project.id,
		issueKey,
		webhookEvent,
		receivedAt: new Date().toISOString(),
		ackCommentId,
	};

	try {
		const jobId = await addJob(job);
		console.log('[Router] JIRA job queued:', { jobId, webhookEvent, ackCommentId });
	} catch (err) {
		console.error('[Router] Failed to queue JIRA job:', err);
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
 * Parses the payload, filters irrelevant events, and queues a job.
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
			console.log('[Router] Ignoring self-authored JIRA comment');
		} else {
			await queueJiraJob(
				project,
				issueKey,
				webhookEvent,
				payload,
				config.fullProjects,
				triggerRegistry,
			);
		}
	} else {
		console.log(`[Router] Ignoring JIRA: ${webhookEvent}`);
	}

	return { shouldProcess, project, webhookEvent };
}
