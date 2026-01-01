import { serve } from '@hono/node-server';
import { loadEnvConfigSafe, loadProjectsConfig } from './config/index.js';
import { createServer } from './server.js';
import {
	createTriggerRegistry,
	processGitHubWebhook,
	registerBuiltInTriggers,
} from './triggers/index.js';
import { processTrelloWebhook } from './triggers/trello/webhook-handler.js';
import type { CascadeConfig } from './types/index.js';
import { logger, setLogLevel, startSelfDestructTimer } from './utils/index.js';

async function main(): Promise<void> {
	// Load environment config
	const envConfig = loadEnvConfigSafe();
	setLogLevel(envConfig.logLevel || 'info');

	logger.info('Starting Cascade server', { port: envConfig.port });

	// Load projects config
	let config: CascadeConfig;
	try {
		config = loadProjectsConfig(envConfig.configPath || './config/projects.json');
		logger.info('Loaded projects config', { projects: config.projects.map((p) => p.id) });
	} catch (err) {
		logger.warn('Failed to load projects config, using empty config', { error: String(err) });
		config = {
			defaults: {
				model: 'gemini:gemini-2.5-flash',
				agentModels: {},
				maxIterations: 50,
				selfDestructTimeoutMs: 30 * 60 * 1000,
				watchdogTimeoutMs: 30 * 60 * 1000,
				postJobGracePeriodMs: 5000,
			},
			projects: [],
		};
	}

	// Create trigger registry
	const triggerRegistry = createTriggerRegistry();
	registerBuiltInTriggers(triggerRegistry);

	// Create server
	const app = createServer({
		config,
		onTrelloWebhook: async (payload) => {
			await processTrelloWebhook(payload, config, triggerRegistry);
		},
		onGitHubWebhook: async (payload, eventType) => {
			await processGitHubWebhook(payload, eventType, config, triggerRegistry);
		},
	});

	// Start self-destruct timer (for Fly.io cost management)
	if (process.env.FLY_APP_NAME) {
		startSelfDestructTimer(config.defaults.selfDestructTimeoutMs);
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
