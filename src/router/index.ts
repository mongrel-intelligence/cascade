import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { captureException, flush, setTag } from '../sentry.js';
// Bootstrap all integrations via the single canonical entrypoint. The
// entrypoint side-effect-imports every PM / SCM / alerting registration
// barrel; a per-runtime list here is what caused Linear registration to
// drift across router, worker, CLI, and dashboard during the 2026-04
// workstream (see plan 009/1 task 4). A single file is the fix.
import '../integrations/entrypoint.js';
import { initPrompts } from '../agents/prompts/index.js';
import { registerBuiltInEngines } from '../backends/bootstrap.js';
import { initAgentMessages } from '../config/agentMessages.js';
import { validateCredentialMasterKey } from '../db/crypto.js';
import { seedAgentDefinitions } from '../db/seeds/seedAgentDefinitions.js';
import { registerBuiltInTriggers } from '../triggers/builtins.js';
import { createTriggerRegistry } from '../triggers/registry.js';
import { logger } from '../utils/logging.js';
import {
	createWebhookHandler,
	parseGitHubPayload,
	parseGitHubProjectsPayload,
	parseJiraPayload,
	parseLinearPayload,
	parseSentryPayload,
	parseTrelloPayload,
} from '../webhook/webhookHandlers.js';
import { GitHubRouterAdapter, injectEventType } from './adapters/github.js';
import { GitHubProjectsRouterAdapter } from './adapters/github-projects.js';
import { JiraRouterAdapter } from './adapters/jira.js';
import { LinearRouterAdapter } from './adapters/linear.js';
import { SentryRouterAdapter } from './adapters/sentry.js';
import { TrelloRouterAdapter } from './adapters/trello.js';
import { startCancelListener, stopCancelListener } from './cancel-listener.js';
import { ROUTER_INSTANCE_ID } from './instance-id.js';
import { getQueueStats } from './queue.js';
import { processRouterWebhook } from './webhook-processor.js';
import {
	verifyGitHubProjectsWebhookSignature,
	verifyGitHubWebhookSignature,
	verifyJiraWebhookSignature,
	verifyLinearWebhookSignature,
	verifySentryWebhookSignature,
	verifyTrelloWebhookSignature,
} from './webhookVerification.js';
import {
	getActiveWorkerCount,
	getActiveWorkers,
	startWorkerProcessor,
	stopWorkerProcessor,
} from './worker-manager.js';

setTag('role', 'router');

// Register engine settings schemas before any loadConfig() call.
// EngineSettingsSchema uses a dynamic registry; without this, any project
// with claude-code/codex/opencode engineSettings causes a ZodError that
// silently drops all webhooks (same fix as dashboard.ts in #896).
registerBuiltInEngines();

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
		verifySignature: verifyTrelloWebhookSignature,
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
		verifySignature: verifyGitHubWebhookSignature,
		processWebhook: async (payload, eventType, headers) => {
			const adapter = new GitHubRouterAdapter();
			const deliveryId = headers['x-github-delivery'] ?? headers['X-GitHub-Delivery'];
			const augmented = injectEventType(payload, eventType ?? 'unknown', deliveryId);
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
		verifySignature: verifyJiraWebhookSignature,
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

// Sentry webhook handler (alerting integration)
// Uses project-specific URLs: /sentry/webhook/:projectId
// The projectId in the URL is the CASCADE project ID, making routing unambiguous.
app.post(
	'/sentry/webhook/:projectId',
	createWebhookHandler({
		source: 'sentry',
		parsePayload: (c) => parseSentryPayload(c, c.req.param('projectId') ?? ''),
		verifySignature: verifySentryWebhookSignature,
		processWebhook: async (payload) => {
			const adapter = new SentryRouterAdapter();
			const result = await processRouterWebhook(adapter, payload, triggerRegistry);
			return {
				processed: result.shouldProcess,
				projectId: result.projectId,
				decisionReason: result.decisionReason,
			};
		},
	}),
);

// Linear webhook verification
app.get('/linear/webhook', (c) => {
	return c.text('OK', 200);
});

// Linear webhook handler
app.post(
	'/linear/webhook',
	createWebhookHandler({
		source: 'linear',
		parsePayload: parseLinearPayload,
		verifySignature: verifyLinearWebhookSignature,
		processWebhook: async (payload) => {
			const adapter = new LinearRouterAdapter();
			const result = await processRouterWebhook(adapter, payload, triggerRegistry);
			return {
				processed: result.shouldProcess,
				projectId: result.projectId,
				decisionReason: result.decisionReason,
			};
		},
	}),
);

// GitHub Projects webhook verification
app.get('/github-projects/webhook', (c) => {
	return c.text('OK', 200);
});

// GitHub Projects webhook handler
app.post(
	'/github-projects/webhook',
	createWebhookHandler({
		source: 'github-projects',
		parsePayload: parseGitHubProjectsPayload,
		verifySignature: verifyGitHubProjectsWebhookSignature,
		processWebhook: async (payload) => {
			const adapter = new GitHubProjectsRouterAdapter();
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
	await stopCancelListener();
	await stopWorkerProcessor();
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

	const keyValidation = validateCredentialMasterKey();
	if (!keyValidation.valid) {
		logger.error('Invalid CREDENTIAL_MASTER_KEY', { reason: keyValidation.reason });
		process.exit(1);
	}

	// Seed built-in agent definitions to DB, then initialize in-memory caches
	logger.info('Seeding agent definitions...');
	await seedAgentDefinitions();
	logger.info('Initializing agent messages...');
	await initAgentMessages();
	await initPrompts();

	// Start cancel listener for handling run cancellations
	await startCancelListener();

	startWorkerProcessor();
	logger.info('Starting router', { port, instanceId: ROUTER_INSTANCE_ID });
	serve({ fetch: app.fetch, port });
}

startRouter().catch(async (err) => {
	logger.error('Failed to start router', { error: String(err) });
	captureException(err, { tags: { source: 'router_startup' }, level: 'fatal' });
	await flush(3000);
	process.exit(1);
});
