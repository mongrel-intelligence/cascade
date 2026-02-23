import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import {
	createWebhookHandler,
	parseGitHubPayload,
	parseJiraPayload,
	parseTrelloPayload,
} from '../server/webhookHandlers.js';
import { registerBuiltInTriggers } from '../triggers/builtins.js';
import { createTriggerRegistry } from '../triggers/registry.js';
import { handleGitHubWebhook } from './github.js';
import { handleJiraWebhook } from './jira.js';
import { getQueueStats } from './queue.js';
import { handleTrelloWebhook } from './trello.js';
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
app.post(
	'/trello/webhook',
	(() => {
		let lastResult: { shouldProcess: boolean; projectId?: string } | undefined;
		return createWebhookHandler({
			source: 'trello',
			checkCapacity: false,
			fireAndForget: false,
			parsePayload: parseTrelloPayload,
			processWebhook: async (payload) => {
				const { shouldProcess, project, cardId } = await handleTrelloWebhook(
					payload,
					triggerRegistry,
				);
				lastResult = {
					shouldProcess: shouldProcess && !!project && !!cardId,
					projectId: project?.id,
				};
			},
			resolveLogFields: () => {
				const result = lastResult;
				lastResult = undefined;
				return {
					processed: result?.shouldProcess ?? false,
					projectId: result?.projectId,
				};
			},
		});
	})(),
);

// GitHub webhook verification
app.get('/github/webhook', (c) => {
	return c.text('OK', 200);
});

// GitHub webhook handler
app.post(
	'/github/webhook',
	(() => {
		let lastResult: { shouldProcess: boolean } | undefined;
		return createWebhookHandler({
			source: 'github',
			checkCapacity: false,
			fireAndForget: false,
			parsePayload: parseGitHubPayload,
			processWebhook: async (payload, eventType) => {
				const { shouldProcess } = await handleGitHubWebhook(
					eventType ?? 'unknown',
					payload,
					triggerRegistry,
				);
				lastResult = { shouldProcess };
			},
			resolveLogFields: () => {
				const result = lastResult;
				lastResult = undefined;
				return { processed: result?.shouldProcess ?? false };
			},
		});
	})(),
);

// JIRA webhook verification
app.get('/jira/webhook', (c) => {
	return c.text('OK', 200);
});

// JIRA webhook handler
app.post(
	'/jira/webhook',
	(() => {
		let lastResult: { shouldProcess: boolean; projectId?: string } | undefined;
		return createWebhookHandler({
			source: 'jira',
			checkCapacity: false,
			fireAndForget: false,
			parsePayload: parseJiraPayload,
			processWebhook: async (payload) => {
				const { shouldProcess, project } = await handleJiraWebhook(payload, triggerRegistry);
				lastResult = {
					shouldProcess: !!shouldProcess,
					projectId: project?.id,
				};
			},
			resolveLogFields: () => {
				const result = lastResult;
				lastResult = undefined;
				return {
					processed: result?.shouldProcess ?? false,
					projectId: result?.projectId,
				};
			},
		});
	})(),
);

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
