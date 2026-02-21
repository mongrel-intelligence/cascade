import { serve } from '@hono/node-server';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { INITIAL_MESSAGES } from '../config/agentMessages.js';
import { findProjectByRepo } from '../config/provider.js';
import { type PersonaIdentities, resolvePersonaIdentities } from '../github/personas.js';
import { createTriggerRegistry, registerBuiltInTriggers } from '../triggers/index.js';
import type { TriggerContext } from '../types/index.js';
import { logWebhookCall } from '../utils/webhookLogger.js';
import {
	postGitHubAck,
	postJiraAck,
	postTrelloAck,
	resolveGitHubTokenForAck,
} from './acknowledgments.js';
import { type RouterProjectConfig, loadProjectConfig } from './config.js';
import { extractPRNumber } from './notifications.js';
import { addEyesReactionToPR } from './pre-actions.js';
import { type CascadeJob, type GitHubJob, addJob, getQueueStats } from './queue.js';
import { sendAcknowledgeReaction } from './reactions.js';
import {
	getActiveWorkerCount,
	getActiveWorkers,
	startWorkerProcessor,
	stopWorkerProcessor,
} from './worker-manager.js';

// Create trigger registry once at router startup for matchTrigger() calls
const triggerRegistry = createTriggerRegistry();
registerBuiltInTriggers(triggerRegistry);

/**
 * Check if filename matches agent log pattern: {agent-type}-{timestamp}.zip
 * Examples: implementation-2026-01-02T16-30-24-339Z.zip, briefing-timeout-2026-01-02T12-34-56-789Z.zip
 */
function isAgentLogFilename(filename: string): boolean {
	return /^[a-z]+(?:-timeout)?-[\d-TZ]+\.zip$/i.test(filename);
}

function isCardInTriggerList(
	actionType: string,
	data: Record<string, unknown> | undefined,
	project: RouterProjectConfig,
): boolean {
	if (!project.trello) return false;
	const triggerLists = [
		project.trello.lists.briefing,
		project.trello.lists.planning,
		project.trello.lists.todo,
	];

	// Card moved into a trigger list
	if (actionType === 'updateCard' && data?.listAfter) {
		const listAfter = data.listAfter as Record<string, unknown>;
		const listId = listAfter.id as string;
		if (triggerLists.includes(listId)) {
			console.log(`[Router] Card moved to trigger list: ${listId}`);
			return true;
		}
	}

	// Card created directly in a trigger list
	if (actionType === 'createCard' && data?.list) {
		const list = data.list as Record<string, unknown>;
		const listId = list.id as string;
		if (triggerLists.includes(listId)) {
			console.log(`[Router] Card created in trigger list: ${listId}`);
			return true;
		}
	}

	return false;
}

function isReadyToProcessLabelAdded(
	actionType: string,
	data: Record<string, unknown> | undefined,
	project: RouterProjectConfig,
): boolean {
	if (actionType !== 'addLabelToCard' || !data?.label) return false;
	if (!project.trello) return false;

	const label = data.label as Record<string, unknown>;
	const labelId = label.id as string;

	if (labelId === project.trello.labels.readyToProcess) {
		console.log('[Router] Ready-to-process label added');
		return true;
	}
	return false;
}

function isAgentLogAttachmentUploaded(
	actionType: string,
	data: Record<string, unknown> | undefined,
	project: RouterProjectConfig,
): boolean {
	if (actionType !== 'addAttachmentToCard' || !data?.attachment) return false;
	if (!project.trello?.lists.debug) return false;

	const attachment = data.attachment as Record<string, unknown>;
	const name = attachment.name as string | undefined;

	if (name && isAgentLogFilename(name) && !name.startsWith('debug-')) {
		console.log(`[Router] Agent log attachment uploaded: ${name}`);
		return true;
	}
	return false;
}

interface TrelloWebhookResult {
	shouldProcess: boolean;
	project?: RouterProjectConfig;
	projectId?: string;
	actionType?: string;
	cardId?: string;
}

async function parseTrelloWebhook(payload: unknown): Promise<TrelloWebhookResult> {
	if (!payload || typeof payload !== 'object') {
		return { shouldProcess: false };
	}

	const p = payload as Record<string, unknown>;
	const action = p.action as Record<string, unknown> | undefined;
	const model = p.model as Record<string, unknown> | undefined;

	if (!action || !model) {
		return { shouldProcess: false };
	}

	const boardId = model.id as string;
	const actionType = action.type as string;
	const data = action.data as Record<string, unknown> | undefined;

	const config = await loadProjectConfig();
	const project = config.projects.find((proj) => proj.trello?.boardId === boardId);
	if (!project) {
		return { shouldProcess: false };
	}

	// Extract card ID
	const card = data?.card as Record<string, unknown> | undefined;
	const cardId = card?.id as string | undefined;

	const shouldProcess =
		isCardInTriggerList(actionType, data, project) ||
		isReadyToProcessLabelAdded(actionType, data, project) ||
		isAgentLogAttachmentUploaded(actionType, data, project) ||
		actionType === 'commentCard';

	return { shouldProcess, project, projectId: project.id, actionType, cardId };
}

/**
 * Try to match a trigger and post an ack comment for a Trello webhook.
 * Returns the ack comment ID if posted, undefined otherwise.
 */
async function tryPostTrelloAck(
	projectId: string,
	cardId: string,
	payload: unknown,
): Promise<string | undefined> {
	const config = await loadProjectConfig();
	const fullProject = config.fullProjects.find((fp) => fp.id === projectId);
	if (!fullProject) return undefined;

	const ctx: TriggerContext = { project: fullProject, source: 'trello', payload };
	const match = triggerRegistry.matchTrigger(ctx);
	if (!match) return undefined;

	const message = INITIAL_MESSAGES[match.agentType];
	if (!message) return undefined;

	const commentId = await postTrelloAck(projectId, cardId, message);
	return commentId ?? undefined;
}

/**
 * Try to match a trigger and post an ack comment for a GitHub webhook.
 * Returns the ack comment ID if posted, undefined otherwise.
 */
async function tryPostGitHubAck(
	eventType: string,
	repoFullName: string,
	payload: unknown,
): Promise<number | undefined> {
	const config = await loadProjectConfig();
	const fullProject = config.fullProjects.find((fp) => fp.repo === repoFullName);
	if (!fullProject) return undefined;

	let personaIdentities: PersonaIdentities | undefined;
	try {
		personaIdentities = await resolvePersonaIdentities(fullProject.id);
	} catch {
		// Persona resolution may fail — proceed without ack
	}

	const ctx: TriggerContext = {
		project: fullProject,
		source: 'github',
		payload,
		personaIdentities,
	};
	const match = triggerRegistry.matchTrigger(ctx);
	if (!match) return undefined;

	const message = INITIAL_MESSAGES[match.agentType];
	if (!message) return undefined;

	const resolved = await resolveGitHubTokenForAck(repoFullName);
	if (!resolved) return undefined;

	const tempJob = { eventType, repoFullName, payload } as GitHubJob;
	const prNumber = extractPRNumber(tempJob);
	if (!prNumber) return undefined;

	const commentId = await postGitHubAck(repoFullName, prNumber, message, resolved.token);
	return commentId ?? undefined;
}

/**
 * Try to match a trigger and post an ack comment for a JIRA webhook.
 * Returns the ack comment ID if posted, undefined otherwise.
 */
async function tryPostJiraAck(
	projectId: string,
	issueKey: string,
	payload: unknown,
	fullProjects: import('../types/index.js').ProjectConfig[],
): Promise<string | undefined> {
	const fullProject = fullProjects.find((fp) => fp.id === projectId);
	if (!fullProject || !issueKey) return undefined;

	const ctx: TriggerContext = { project: fullProject, source: 'jira', payload };
	const match = triggerRegistry.matchTrigger(ctx);
	if (!match) return undefined;

	const message = INITIAL_MESSAGES[match.agentType];
	if (!message) return undefined;

	const commentId = await postJiraAck(projectId, issueKey, message);
	return commentId ?? undefined;
}

/**
 * Fire non-blocking pre-actions for a GitHub job before it is queued.
 * Currently adds a 👀 reaction for first-time check_suite success events.
 */
function firePreActions(job: GitHubJob, p: Record<string, unknown>): void {
	if (job.eventType !== 'check_suite') return;
	const suite = p.check_suite as Record<string, unknown> | undefined;
	const action = p.action as string | undefined;
	const conclusion = suite?.conclusion as string | undefined;
	const prs = suite?.pull_requests as Array<unknown> | undefined;
	if (action === 'completed' && conclusion === 'success' && prs && prs.length > 0) {
		addEyesReactionToPR(job).catch((err) =>
			console.warn('[Router] Pre-action error (eyes reaction):', String(err)),
		);
	}
}

async function queueJiraJob(
	project: RouterProjectConfig,
	issueKey: string,
	webhookEvent: string,
	payload: unknown,
	fullProjects: import('../types/index.js').ProjectConfig[],
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
		ackCommentId = await tryPostJiraAck(project.id, issueKey, payload, fullProjects);
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

const app = new Hono();

// Health check with queue stats
app.get('/health', async (c) => {
	const queueStats = await getQueueStats();
	return c.json({
		status: 'ok',
		role: 'router',
		queue: queueStats,
		activeWorkers: getActiveWorkerCount(),
		workers: getActiveWorkers(),
	});
});

// Trello webhook verification (HEAD and GET)
app.on(['HEAD', 'GET'], '/trello/webhook', (c) => {
	return c.text('OK', 200);
});

// Trello webhook handler
app.post('/trello/webhook', async (c) => {
	const rawHeaders = Object.fromEntries(
		Object.entries(c.req.header()).map(([k, v]) => [k, String(v)]),
	);
	let payload: unknown;
	try {
		payload = await c.req.json();
	} catch {
		logWebhookCall({
			source: 'trello',
			method: c.req.method,
			path: c.req.path,
			headers: rawHeaders,
			statusCode: 400,
			processed: false,
		});
		return c.text('Bad Request', 400);
	}

	const { shouldProcess, project, actionType, cardId } = await parseTrelloWebhook(payload);

	logWebhookCall({
		source: 'trello',
		method: c.req.method,
		path: c.req.path,
		headers: rawHeaders,
		body: payload,
		statusCode: 200,
		projectId: project?.id,
		eventType: actionType,
		processed: shouldProcess && !!project && !!cardId,
	});

	if (shouldProcess && project && cardId) {
		console.log('[Router] Queueing Trello job:', { actionType, cardId, projectId: project.id });

		// Fire-and-forget acknowledgment reaction — only for comment actions
		if (actionType === 'commentCard') {
			void sendAcknowledgeReaction('trello', project.id, payload).catch((err) =>
				console.error('[Router] Trello reaction error:', err),
			);
		}

		// Try to post an ack comment via trigger matching (non-blocking best-effort)
		let ackCommentId: string | undefined;
		try {
			ackCommentId = await tryPostTrelloAck(project.id, cardId, payload);
		} catch (err) {
			console.warn('[Router] Trello ack comment failed (non-fatal):', String(err));
		}

		const job: CascadeJob = {
			type: 'trello',
			source: 'trello',
			payload,
			projectId: project.id,
			cardId,
			actionType: actionType || 'unknown',
			receivedAt: new Date().toISOString(),
			ackCommentId,
		};

		try {
			const jobId = await addJob(job);
			console.log('[Router] Trello job queued:', { jobId, actionType, ackCommentId });
		} catch (err) {
			console.error('[Router] Failed to queue Trello job:', err);
			// Still return 200 to Trello to avoid retries
		}
	} else {
		console.log(`[Router] Ignoring Trello: ${actionType || 'unknown'}`);
	}

	return c.text('OK', 200);
});

type PayloadParseResult = { ok: true; payload: unknown } | { ok: false; error: string };

async function parseGitHubWebhookPayload(
	c: Context,
	contentType: string,
): Promise<PayloadParseResult> {
	try {
		if (contentType.includes('application/x-www-form-urlencoded')) {
			const formData = await c.req.parseBody();
			const payloadStr = formData.payload;
			if (typeof payloadStr === 'string') {
				return { ok: true, payload: JSON.parse(payloadStr) };
			}
			throw new Error('Missing payload field in form data');
		}
		return { ok: true, payload: await c.req.json() };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}

// GitHub webhook verification
app.get('/github/webhook', (c) => {
	return c.text('OK', 200);
});

// GitHub webhook handler
app.post('/github/webhook', async (c) => {
	const eventType = c.req.header('X-GitHub-Event') || 'unknown';
	const contentType = c.req.header('Content-Type') || '';
	const rawHeaders = Object.fromEntries(
		Object.entries(c.req.header()).map(([k, v]) => [k, String(v)]),
	);

	const parseResult = await parseGitHubWebhookPayload(c, contentType);
	if (!parseResult.ok) {
		console.log('[Router] GitHub webhook parse error:', {
			error: parseResult.error,
			contentType,
			eventType,
		});
		logWebhookCall({
			source: 'github',
			method: c.req.method,
			path: c.req.path,
			headers: rawHeaders,
			bodyRaw: parseResult.error,
			statusCode: 400,
			eventType,
			processed: false,
		});
		return c.text('Bad Request', 400);
	}
	const payload = parseResult.payload;

	// Extract repo info
	const p = payload as Record<string, unknown>;
	const repo = p.repository as Record<string, unknown> | undefined;
	const repoFullName = (repo?.full_name as string) || 'unknown';

	// Determine if we should process this event
	const processableEvents = [
		'pull_request',
		'pull_request_review',
		'pull_request_review_comment',
		'issue_comment',
		'check_suite',
	];
	const shouldProcess = processableEvents.includes(eventType);

	logWebhookCall({
		source: 'github',
		method: c.req.method,
		path: c.req.path,
		headers: rawHeaders,
		body: payload,
		statusCode: 200,
		eventType,
		processed: shouldProcess,
	});

	if (shouldProcess) {
		console.log('[Router] Queueing GitHub job:', { eventType, repoFullName });

		// Fire-and-forget acknowledgment reaction — only for comment events that @mention the bot
		if (eventType === 'issue_comment' || eventType === 'pull_request_review_comment') {
			void (async () => {
				try {
					const project = await findProjectByRepo(repoFullName);
					if (!project) {
						console.warn('[Router] No project found for repo, skipping GitHub reaction', {
							repoFullName,
						});
						return;
					}
					const personaIdentities = await resolvePersonaIdentities(project.id);
					await sendAcknowledgeReaction(
						'github',
						repoFullName,
						payload,
						personaIdentities,
						project,
					);
				} catch (err) {
					console.warn('[Router] GitHub reaction error:', String(err));
				}
			})();
		}

		// Try to post an ack comment via trigger matching (non-blocking best-effort)
		let ackCommentId: number | undefined;
		try {
			ackCommentId = await tryPostGitHubAck(eventType, repoFullName, payload);
		} catch (err) {
			console.warn('[Router] GitHub ack comment failed (non-fatal):', String(err));
		}

		const job: CascadeJob = {
			type: 'github',
			source: 'github',
			payload,
			eventType,
			repoFullName,
			receivedAt: new Date().toISOString(),
			ackCommentId,
		};

		// Fire pre-actions (non-blocking) before queueing
		firePreActions(job as GitHubJob, p);

		try {
			const jobId = await addJob(job);
			console.log('[Router] GitHub job queued:', { jobId, eventType, ackCommentId });
		} catch (err) {
			console.error('[Router] Failed to queue GitHub job:', err);
		}
	} else {
		console.log('[Router] Ignoring GitHub event:', eventType);
	}

	return c.text('OK', 200);
});

// JIRA webhook verification
app.get('/jira/webhook', (c) => {
	return c.text('OK', 200);
});

// JIRA webhook handler
app.post('/jira/webhook', async (c) => {
	const rawHeaders = Object.fromEntries(
		Object.entries(c.req.header()).map(([k, v]) => [k, String(v)]),
	);
	let payload: unknown;
	try {
		payload = await c.req.json();
	} catch {
		logWebhookCall({
			source: 'jira',
			method: c.req.method,
			path: c.req.path,
			headers: rawHeaders,
			statusCode: 400,
			processed: false,
		});
		return c.text('Bad Request', 400);
	}

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

	// Process issue transitions and comment events
	const processableEvents = [
		'jira:issue_updated',
		'jira:issue_created',
		'comment_created',
		'comment_updated',
	];
	const shouldProcess = project && processableEvents.some((e) => webhookEvent.startsWith(e));

	logWebhookCall({
		source: 'jira',
		method: c.req.method,
		path: c.req.path,
		headers: rawHeaders,
		body: payload,
		statusCode: 200,
		projectId: project?.id,
		eventType: webhookEvent || undefined,
		processed: !!shouldProcess,
	});

	if (shouldProcess && project) {
		await queueJiraJob(project, issueKey, webhookEvent, payload, config.fullProjects);
	} else {
		console.log(`[Router] Ignoring JIRA: ${webhookEvent}`);
	}

	return c.text('OK', 200);
});

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
	console.log(`[Router] Received ${signal}, shutting down...`);
	await stopWorkerProcessor();
	process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Start server and worker processor
async function startRouter(): Promise<void> {
	const port = Number(process.env.PORT) || 3000;
	startWorkerProcessor();
	console.log(`[Router] Starting on port ${port}`);
	serve({ fetch: app.fetch, port });
}

startRouter().catch((err) => {
	console.error('[Router] Failed to start:', err);
	process.exit(1);
});
