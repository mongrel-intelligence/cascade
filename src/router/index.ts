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
import { verifyGitHubSignature, verifyTrelloSignature } from '../webhook/signatureVerification.js';
import {
	createWebhookHandler,
	parseGitHubPayload,
	parseJiraPayload,
	parseTrelloPayload,
} from '../webhook/webhookHandlers.js';
import { GitHubRouterAdapter, injectEventType } from './adapters/github.js';
import { JiraRouterAdapter } from './adapters/jira.js';
import { TrelloRouterAdapter } from './adapters/trello.js';
import { startCancelListener, stopCancelListener } from './cancel-listener.js';
import { loadProjectConfig, routerConfig } from './config.js';
import { resolveWebhookSecret } from './platformClients/credentials.js';
import { getQueueStats } from './queue.js';
import { processRouterWebhook } from './webhook-processor.js';
import {
	getActiveWorkerCount,
	getActiveWorkers,
	startWorkerProcessor,
	stopWorkerProcessor,
} from './worker-manager.js';

setTag('role', 'router');

// ---------------------------------------------------------------------------
// Webhook signature verification helpers
// ---------------------------------------------------------------------------

/**
 * Extract the Trello board ID from a raw webhook payload.
 * Trello sends the board ID at `action.data.board.id` or, for board-level
 * events, at `model.id`.
 */
function extractTrelloBoardId(rawBody: string): string | undefined {
	try {
		const parsed = JSON.parse(rawBody) as Record<string, unknown>;
		const boardId = (
			((parsed?.action as Record<string, unknown>)?.data as Record<string, unknown>)
				?.board as Record<string, unknown>
		)?.id as string | undefined;
		if (boardId) return boardId;
		return (parsed?.model as Record<string, unknown>)?.id as string | undefined;
	} catch {
		return undefined;
	}
}

/**
 * Build the Trello webhook callback URL.
 * Uses `routerConfig.webhookCallbackBaseUrl` when set; otherwise derives the
 * base URL from the request's `x-forwarded-proto` / `host` headers.
 */
function buildTrelloCallbackUrl(host: string | undefined, proto: string | undefined): string {
	if (routerConfig.webhookCallbackBaseUrl) {
		return `${routerConfig.webhookCallbackBaseUrl}/trello/webhook`;
	}
	return `${proto ?? 'https'}://${host}/trello/webhook`;
}

/**
 * verifySignature callback for the Trello webhook handler.
 * Returns null to skip verification when no secret is configured (backwards compat).
 */
async function verifyTrelloWebhookSignature(
	c: import('hono').Context,
	rawBody: string,
): Promise<{ valid: boolean; reason: string } | null> {
	const signatureHeader = c.req.header('x-trello-webhook');
	const boardId = extractTrelloBoardId(rawBody);

	if (!boardId) return null;

	const { projects } = await loadProjectConfig();
	const project = projects.find((p) => p.trello?.boardId === boardId);
	if (!project) return null;

	const secret = await resolveWebhookSecret(project.id, 'trello');
	if (!secret) return null; // No secret configured — skip verification

	if (!signatureHeader) {
		return { valid: false, reason: 'Missing signature header' };
	}

	const callbackUrl = buildTrelloCallbackUrl(
		c.req.header('host'),
		c.req.header('x-forwarded-proto'),
	);
	const valid = verifyTrelloSignature(rawBody, callbackUrl, signatureHeader, secret);
	return valid
		? { valid: true, reason: 'Signature valid' }
		: { valid: false, reason: 'Trello signature mismatch' };
}

/**
 * verifySignature callback for the GitHub webhook handler.
 * Returns null to skip verification when no secret is configured (backwards compat).
 */
async function verifyGitHubWebhookSignature(
	c: import('hono').Context,
	rawBody: string,
): Promise<{ valid: boolean; reason: string } | null> {
	const signatureHeader = c.req.header('X-Hub-Signature-256');

	let repoFullName: string | undefined;
	try {
		const parsed = JSON.parse(rawBody) as Record<string, unknown>;
		repoFullName = (parsed?.repository as Record<string, unknown>)?.full_name as string | undefined;
	} catch {
		// If we can't parse the repo, skip verification
	}

	if (!repoFullName) return null;

	const { projects } = await loadProjectConfig();
	const project = projects.find((p) => p.repo === repoFullName);
	if (!project) return null;

	const secret = await resolveWebhookSecret(project.id, 'github');
	if (!secret) return null; // No secret configured — skip verification

	if (!signatureHeader) {
		return { valid: false, reason: 'Missing signature header' };
	}

	const valid = verifyGitHubSignature(rawBody, signatureHeader, secret);
	return valid
		? { valid: true, reason: 'Signature valid' }
		: { valid: false, reason: 'GitHub signature mismatch' };
}

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

	// Seed built-in agent definitions to DB, then initialize in-memory caches
	logger.info('Seeding agent definitions...');
	await seedAgentDefinitions();
	logger.info('Initializing agent messages...');
	await initAgentMessages();
	await initPrompts();

	// Start cancel listener for handling run cancellations
	await startCancelListener();

	startWorkerProcessor();
	logger.info('Starting router', { port });
	serve({ fetch: app.fetch, port });
}

startRouter().catch(async (err) => {
	logger.error('Failed to start router', { error: String(err) });
	captureException(err, { tags: { source: 'router_startup' }, level: 'fatal' });
	await flush(3000);
	process.exit(1);
});
