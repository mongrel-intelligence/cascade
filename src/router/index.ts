import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { captureException, flush, setTag } from '../sentry.js';
// Bootstrap PM integrations before any adapters are loaded
import '../pm/bootstrap.js';
import { initPrompts } from '../agents/prompts/index.js';
import { initAgentMessages } from '../config/agentMessages.js';
import { seedAgentDefinitions } from '../db/seeds/seedAgentDefinitions.js';
import { registerBuiltInTriggers } from '../triggers/builtins.js';
import { createTriggerRegistry } from '../triggers/registry.js';
import { logger } from '../utils/logging.js';
import {
	createWebhookHandler,
	parseGitHubPayload,
	parseJiraPayload,
	parseTrelloPayload,
} from '../webhook/webhookHandlers.js';
import { GitHubRouterAdapter, injectEventType } from './adapters/github.js';
import { JiraRouterAdapter } from './adapters/jira.js';
import { TrelloRouterAdapter } from './adapters/trello.js';
import { startEmailScheduler, stopEmailScheduler } from './email-scheduler.js';
import { getQueueStats } from './queue.js';
import { processRouterWebhook } from './webhook-processor.js';
import {
	getActiveWorkerCount,
	getActiveWorkers,
	startWorkerProcessor,
	stopWorkerProcessor,
} from './worker-manager.js';

setTag('role', 'router');

// Create trigger registry once at router startup for dispatch() calls
const triggerRegistry = createTriggerRegistry();
registerBuiltInTriggers(triggerRegistry);

const app = new Hono();

app.onError((err, c) => {
	captureException(err, {
		tags: { source: 'hono_error' },
		extra: { path: c.req.path, method: c.req.method },
	});
	return c.text('Internal Server Error', 500);
});

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
	createWebhookHandler({
		source: 'trello',
		parsePayload: parseTrelloPayload,
		processWebhook: async (payload) => {
			const adapter = new TrelloRouterAdapter();
			const result = await processRouterWebhook(adapter, payload, triggerRegistry);
			return {
				processed: result.shouldProcess,
				projectId: result.projectId,
				decisionReason: result.decisionReason,
			};
		},
	}),
);

// GitHub webhook verification
app.get('/github/webhook', (c) => {
	return c.text('OK', 200);
});

// GitHub webhook handler
app.post(
	'/github/webhook',
	createWebhookHandler({
		source: 'github',
		parsePayload: parseGitHubPayload,
		processWebhook: async (payload, eventType) => {
			const adapter = new GitHubRouterAdapter();
			const augmented = injectEventType(payload, eventType ?? 'unknown');
			const result = await processRouterWebhook(adapter, augmented, triggerRegistry);
			return {
				processed: result.shouldProcess,
				projectId: result.projectId,
				decisionReason: result.decisionReason,
			};
		},
	}),
);

// JIRA webhook verification
app.get('/jira/webhook', (c) => {
	return c.text('OK', 200);
});

// JIRA webhook handler
app.post(
	'/jira/webhook',
	createWebhookHandler({
		source: 'jira',
		parsePayload: parseJiraPayload,
		processWebhook: async (payload) => {
			const adapter = new JiraRouterAdapter();
			const result = await processRouterWebhook(adapter, payload, triggerRegistry);
			return {
				processed: result.shouldProcess,
				projectId: result.projectId,
				decisionReason: result.decisionReason,
			};
		},
	}),
);

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
	logger.info('Received shutdown signal', { signal });
	await stopWorkerProcessor();
	stopEmailScheduler();
	await flush(3000);
	process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
	captureException(err, { tags: { source: 'uncaughtException' }, level: 'fatal' });
});

process.on('unhandledRejection', (reason) => {
	captureException(reason instanceof Error ? reason : new Error(String(reason)), {
		tags: { source: 'unhandledRejection' },
		level: 'error',
	});
});

// Start server and worker processor
async function startRouter(): Promise<void> {
	const port = Number(process.env.PORT) || 3000;

	// Seed built-in agent definitions to DB, then initialize in-memory caches
	logger.info('Seeding agent definitions...');
	await seedAgentDefinitions();
	logger.info('Initializing agent messages...');
	await initAgentMessages();
	await initPrompts();

	startWorkerProcessor();
	startEmailScheduler();
	logger.info('Starting router', { port });
	serve({ fetch: app.fetch, port });
}

startRouter().catch(async (err) => {
	logger.error('Failed to start router', { error: String(err) });
	captureException(err, { tags: { source: 'router_startup' }, level: 'fatal' });
	await flush(3000);
	process.exit(1);
});
