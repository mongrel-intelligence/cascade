import { serve } from '@hono/node-server';
import { loadEnvConfigSafe } from './config/env.js';
import { loadConfig } from './config/provider.js';
import { createServer } from './server.js';
import {
	createTriggerRegistry,
	processGitHubWebhook,
	registerBuiltInTriggers,
} from './triggers/index.js';
import { processTrelloWebhook } from './triggers/trello/webhook-handler.js';
import { logger, setLogLevel, startFreshMachineTimer } from './utils/index.js';

async function main(): Promise<void> {
	// Load environment config
	const envConfig = loadEnvConfigSafe();
	setLogLevel(envConfig.logLevel);

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
	});

	// Start fresh machine timer (for Fly.io cost management)
	// Exits if no work received within timeout
	if (process.env.FLY_APP_NAME) {
		startFreshMachineTimer(config.defaults.freshMachineTimeoutMs);
	}

	// Start server
	const server = serve({
		fetch: app.fetch,
		port: envConfig.port || 3000,
	});

	logger.info(`Cascade server listening on port ${envConfig.port || 3000}`);

	// Graceful shutdown
	const shutdown = () => {
		logger.info('Shutting down...');
		server.close();
		process.exit(0);
	};

	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}

main().catch((err) => {
	console.error('Failed to start server:', err);
	process.exit(1);
});
