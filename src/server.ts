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
import { computeEffectiveOrgId } from './api/context.js';
import { appRouter } from './api/router.js';
import { captureException } from './sentry.js';
import {
	buildGitHubReactionSender,
	buildJiraReactionSender,
	buildTrelloReactionSender,
	createWebhookHandler,
	parseGitHubPayload,
	parseJiraPayload,
	parseTrelloPayload,
} from './server/webhookHandlers.js';
import type { CascadeConfig } from './types/index.js';
import { logger } from './utils/index.js';

export interface ServerDependencies {
	config: CascadeConfig;
	onTrelloWebhook: (payload: unknown) => Promise<void>;
	onGitHubWebhook: (payload: unknown, eventType: string) => Promise<void>;
	onJiraWebhook: (payload: unknown) => Promise<void>;
}

export function createServer(deps: ServerDependencies): Hono {
	const app = new Hono();

	// Middleware
	const corsOrigin = process.env.CORS_ORIGIN;
	app.use('*', corsOrigin ? cors({ origin: corsOrigin, credentials: true }) : cors());
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
				const effectiveOrgId = await computeEffectiveOrgId(user, c.req.header('x-org-context'));

				return { user, effectiveOrgId };
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
	app.post(
		'/trello/webhook',
		createWebhookHandler({
			source: 'trello',
			parsePayload: parseTrelloPayload,
			sendReaction: buildTrelloReactionSender(deps.config),
			processWebhook: (payload) => deps.onTrelloWebhook(payload),
		}),
	);

	// GitHub webhook - GET/HEAD for verification
	app.get('/github/webhook', (c) => {
		return c.text('OK', 200);
	});

	// GitHub webhook - POST for events
	app.post(
		'/github/webhook',
		createWebhookHandler({
			source: 'github',
			parsePayload: parseGitHubPayload,
			sendReaction: buildGitHubReactionSender(),
			processWebhook: (payload, eventType) => deps.onGitHubWebhook(payload, eventType ?? 'unknown'),
		}),
	);

	// JIRA webhook - GET/HEAD for verification
	app.get('/jira/webhook', (c) => {
		return c.text('OK', 200);
	});

	// JIRA webhook - POST for events
	app.post(
		'/jira/webhook',
		createWebhookHandler({
			source: 'jira',
			parsePayload: parseJiraPayload,
			sendReaction: buildJiraReactionSender(deps.config),
			processWebhook: (payload) => deps.onJiraWebhook(payload),
		}),
	);

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
		captureException(err, {
			tags: { source: 'hono_error' },
			extra: { path: c.req.path, method: c.req.method },
		});
		return c.json({ error: 'Internal Server Error' }, 500);
	});

	return app;
}
