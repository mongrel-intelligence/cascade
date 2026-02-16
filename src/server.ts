import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { trpcServer } from '@hono/trpc-server';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { loginHandler } from './api/auth/login.js';
import { logoutHandler } from './api/auth/logout.js';
import { resolveUserFromSession } from './api/auth/session.js';
import { appRouter } from './api/router.js';
import type { CascadeConfig } from './types/index.js';
import { canAcceptWebhook, isCurrentlyProcessing, logger } from './utils/index.js';

export interface ServerDependencies {
	config: CascadeConfig;
	onTrelloWebhook: (payload: unknown) => Promise<void>;
	onGitHubWebhook: (payload: unknown, eventType: string) => Promise<void>;
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

	// =========================================================================
	// Dashboard auth routes (plain Hono — they set cookies)
	// =========================================================================
	app.post('/api/auth/login', loginHandler);
	app.post('/api/auth/logout', logoutHandler);

	// =========================================================================
	// tRPC (all dashboard data queries)
	// =========================================================================
	app.use(
		'/trpc/*',
		trpcServer({
			endpoint: '/trpc',
			router: appRouter,
			createContext: async (_opts, c) => {
				const token = getCookie(c, 'cascade_session');
				const user = token ? await resolveUserFromSession(token) : null;
				return { user };
			},
		}),
	);

	// =========================================================================
	// Webhooks
	// =========================================================================

	// Trello webhook - GET/HEAD for verification (Trello sends HEAD to verify)
	app.get('/trello/webhook', (c) => {
		return c.text('OK', 200);
	});

	// Trello webhook - POST for events
	app.post('/trello/webhook', async (c) => {
		// Check capacity synchronously - return 503 if at capacity so Fly.io routes to another machine
		if (isCurrentlyProcessing() && !canAcceptWebhook()) {
			logger.warn('Machine at capacity, returning 503');
			return c.text('Service Unavailable', 503);
		}

		try {
			const payload = await c.req.json();
			logger.debug('Received Trello webhook', { action: payload?.action?.type });

			// Process asynchronously - respond immediately
			setImmediate(() => {
				deps.onTrelloWebhook(payload).catch((err) => {
					logger.error('Error processing Trello webhook', {
						error: String(err),
						stack: err instanceof Error ? err.stack : undefined,
					});
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
		// Check capacity synchronously - return 503 if at capacity so Fly.io routes to another machine
		if (isCurrentlyProcessing() && !canAcceptWebhook()) {
			logger.warn('Machine at capacity, returning 503');
			return c.text('Service Unavailable', 503);
		}

		const eventType = c.req.header('X-GitHub-Event') || 'unknown';
		const contentType = c.req.header('Content-Type') || '';

		let payload: unknown;

		try {
			// GitHub can send webhooks as JSON or form-urlencoded
			if (contentType.includes('application/x-www-form-urlencoded')) {
				// Form-urlencoded: payload is in the 'payload' field
				const formData = await c.req.parseBody();
				const payloadStr = formData.payload;
				if (typeof payloadStr === 'string') {
					payload = JSON.parse(payloadStr);
				} else {
					throw new Error('Missing payload field in form data');
				}
			} else {
				// Assume JSON
				payload = await c.req.json();
			}

			logger.info('Received GitHub webhook', {
				event: eventType,
				contentType,
				action: (payload as Record<string, unknown>)?.action,
				repository: ((payload as Record<string, unknown>)?.repository as Record<string, unknown>)
					?.full_name,
			});

			// Process asynchronously - respond immediately
			setImmediate(() => {
				deps.onGitHubWebhook(payload, eventType).catch((err) => {
					logger.error('Error processing GitHub webhook', {
						error: String(err),
						stack: err instanceof Error ? err.stack : undefined,
					});
				});
			});

			return c.text('OK', 200);
		} catch (err) {
			logger.error('Failed to parse GitHub webhook', {
				error: String(err),
				contentType,
				eventType,
			});
			return c.text('Bad Request', 400);
		}
	});

	// =========================================================================
	// Static file serving (production — built frontend)
	// =========================================================================
	const webDistPath = join(import.meta.dirname, '..', 'dist', 'web');
	const webDistExists = existsSync(webDistPath);

	if (webDistExists) {
		app.use('/*', serveStatic({ root: './dist/web' }));
	}

	// SPA fallback — serve index.html for unmatched routes
	app.notFound((c) => {
		if (webDistExists) {
			const accept = c.req.header('Accept') ?? '';
			if (accept.includes('text/html')) {
				const indexPath = join(webDistPath, 'index.html');
				try {
					const html = readFileSync(indexPath, 'utf-8');
					return c.html(html);
				} catch {
					// fall through to JSON 404
				}
			}
		}
		return c.json({ error: 'Not Found' }, 404);
	});

	// Error handler
	app.onError((err, c) => {
		logger.error('Unhandled error', { error: String(err), path: c.req.path });
		return c.json({ error: 'Internal Server Error' }, 500);
	});

	return app;
}
