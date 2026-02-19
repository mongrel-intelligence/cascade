import { serve } from '@hono/node-server';
import { loadEnvConfigSafe } from './config/env.js';
import { loadConfig } from './config/provider.js';
import { createServer } from './server.js';
import {
	createTriggerRegistry,
	processGitHubWebhook,
	processJiraWebhook,
	registerBuiltInTriggers,
} from './triggers/index.js';
import { processTrelloWebhook } from './triggers/trello/webhook-handler.js';
import { logger, setLogLevel } from './utils/index.js';
import { flushSentry, initSentry } from './utils/sentry.js';

async function main(): Promise<void> {
	// Load environment config
	const envConfig = loadEnvConfigSafe();
	setLogLevel(envConfig.logLevel);

	// Initialize Sentry (no-op if SENTRY_DSN is unset)
	initSentry('cascade-server');

	logger.info('Starting Cascade server', { port: envConfig.port });

	// Load projects config from database
	const config = await loadConfig();
	logger.info('Loaded projects config', { projects: config.projects.map((p) => p.id) });

	// Create trigger registry
	const triggerRegistry = createTriggerRegistry();
	registerBuiltInTriggers(triggerRegistry);

	// Create server
	const app = createServer({
		config,
		onTrelloWebhook: async (payload) => {
			await processTrelloWebhook(payload, triggerRegistry);
		},
		onGitHubWebhook: async (payload, eventType) => {
			await processGitHubWebhook(payload, eventType, triggerRegistry);
		},
		onJiraWebhook: async (payload) => {
			await processJiraWebhook(payload, triggerRegistry);
		},
	});

	// Start server
	const server = serve({
		fetch: app.fetch,
		port: envConfig.port || 3000,
	});

	logger.info(`Cascade server listening on port ${envConfig.port || 3000}`);

	// Graceful shutdown
	const shutdown = async () => {
		logger.info('Shutting down...');
		server.close();
		await flushSentry(2000);
		process.exit(0);
	};

	process.on('SIGINT', () => void shutdown());
	process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
	console.error('Failed to start server:', err);
	process.exit(1);
});
