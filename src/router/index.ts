import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { registerBuiltInTriggers } from '../triggers/builtins.js';
import { createTriggerRegistry } from '../triggers/registry.js';
import { logWebhookCall } from '../utils/webhookLogger.js';
import { handleGitHubWebhook } from './github.js';
import { handleJiraWebhook } from './jira.js';
import { getQueueStats } from './queue.js';
import { handleTrelloWebhook } from './trello.js';
import { parseTrelloWebhook } from './trello.js';
import { extractRawHeaders, parseGitHubWebhookPayload } from './webhookParsing.js';
import {
	getActiveWorkerCount,
	getActiveWorkers,
	startWorkerProcessor,
	stopWorkerProcessor,
} from './worker-manager.js';

// Create trigger registry once at router startup for matchTrigger() calls
const triggerRegistry = createTriggerRegistry();
registerBuiltInTriggers(triggerRegistry);

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
	const rawHeaders = extractRawHeaders(c);
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

	await handleTrelloWebhook(payload, triggerRegistry);

	return c.text('OK', 200);
});

// GitHub webhook verification
app.get('/github/webhook', (c) => {
	return c.text('OK', 200);
});

// GitHub webhook handler
app.post('/github/webhook', async (c) => {
	const eventType = c.req.header('X-GitHub-Event') || 'unknown';
	const contentType = c.req.header('Content-Type') || '';
	const rawHeaders = extractRawHeaders(c);

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

	const { shouldProcess } = await handleGitHubWebhook(eventType, payload, triggerRegistry);

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

	return c.text('OK', 200);
});

// JIRA webhook verification
app.get('/jira/webhook', (c) => {
	return c.text('OK', 200);
});

// JIRA webhook handler
app.post('/jira/webhook', async (c) => {
	const rawHeaders = extractRawHeaders(c);
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

	const { shouldProcess, project, webhookEvent } = await handleJiraWebhook(
		payload,
		triggerRegistry,
	);

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
