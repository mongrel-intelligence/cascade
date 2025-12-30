import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import type { CascadeConfig } from './types/index.js';
import { logger } from './utils/logging.js';

export interface ServerDependencies {
	config: CascadeConfig;
	onTrelloWebhook: (payload: unknown) => Promise<void>;
}

export function createServer(deps: ServerDependencies): Hono {
	const app = new Hono();

	// Middleware
	app.use('*', cors());
	app.use('*', honoLogger());

	// Health check
	app.get('/health', (c) => {
		return c.json({
			status: 'ok',
			timestamp: new Date().toISOString(),
			projects: deps.config.projects.map((p) => p.id),
		});
	});

	// Trello webhook - GET/HEAD for verification (Trello sends HEAD to verify)
	app.get('/trello/webhook', (c) => {
		return c.text('OK', 200);
	});

	// Trello webhook - POST for events
	app.post('/trello/webhook', async (c) => {
		try {
			const payload = await c.req.json();
			logger.debug('Received Trello webhook', { action: payload?.action?.type });

			// Process asynchronously - respond immediately
			setImmediate(() => {
				deps.onTrelloWebhook(payload).catch((err) => {
					logger.error('Error processing Trello webhook', { error: String(err) });
				});
			});

			return c.text('OK', 200);
		} catch (err) {
			logger.error('Failed to parse Trello webhook', { error: String(err) });
			return c.text('Bad Request', 400);
		}
	});

	// Future: GitHub webhook - GET/HEAD for verification
	app.get('/github/webhook', (c) => {
		return c.text('OK', 200);
	});

	app.post('/github/webhook', async (c) => {
		try {
			await c.req.json(); // Validate JSON body
			const event = c.req.header('X-GitHub-Event');
			logger.debug('Received GitHub webhook', { event });

			// TODO: Implement GitHub webhook handling
			return c.json({ status: 'received', event });
		} catch (err) {
			logger.error('Failed to parse GitHub webhook', { error: String(err) });
			return c.text('Bad Request', 400);
		}
	});

	// 404 handler
	app.notFound((c) => {
		return c.json({ error: 'Not Found' }, 404);
	});

	// Error handler
	app.onError((err, c) => {
		logger.error('Unhandled error', { error: String(err), path: c.req.path });
		return c.json({ error: 'Internal Server Error' }, 500);
	});

	return app;
}
