/**
 * Dashboard API Entry Point
 *
 * Hono server for the dashboard container.
 * Serves auth routes + tRPC. In self-hosted mode (dist/web/ exists),
 * also serves the frontend as static files.
 *
 * Environment variables:
 * - PORT (default: 3001)
 * - DATABASE_URL — PostgreSQL connection string
 * - CORS_ORIGIN — Frontend origin (e.g. https://ca.sca.de.com)
 * - COOKIE_DOMAIN — Cookie domain for cross-origin auth
 * - REDIS_URL — Redis for job dispatch to the router's worker-manager
 */

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { trpcServer } from '@hono/trpc-server';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { initPrompts } from './agents/prompts/index.js';
import { SESSION_COOKIE_NAME } from './api/auth/cookie.js';
import { loginHandler } from './api/auth/login.js';
import { logoutHandler } from './api/auth/logout.js';
import { resolveUserFromSession } from './api/auth/session.js';
import { computeEffectiveOrgId } from './api/context.js';
import { appRouter } from './api/router.js';
import { captureException, flush, setTag } from './sentry.js';

setTag('role', 'dashboard');

const app = new Hono();

// Middleware
const corsOrigin = process.env.CORS_ORIGIN;
app.use('*', corsOrigin ? cors({ origin: corsOrigin, credentials: true }) : cors());
app.use('*', honoLogger());

// Health check
app.get('/health', (c) => {
	return c.json({
		status: 'ok',
		service: 'cascade-dashboard',
		timestamp: new Date().toISOString(),
	});
});

// Auth routes
app.post('/api/auth/login', loginHandler);
app.post('/api/auth/logout', logoutHandler);

// tRPC
app.use(
	'/trpc/*',
	trpcServer({
		endpoint: '/trpc',
		router: appRouter,
		createContext: async (_opts, c) => {
			const token = getCookie(c, SESSION_COOKIE_NAME);
			const user = token ? await resolveUserFromSession(token) : null;
			const effectiveOrgId = await computeEffectiveOrgId(user, c.req.header('x-org-context'));
			return { user, effectiveOrgId };
		},
	}),
);

// Self-hosted mode: serve frontend static files when built into dist/web/
app.use('/assets/*', serveStatic({ root: './dist/web' }));
app.get(
	'*',
	serveStatic({
		root: './dist/web',
		rewriteRequestPath: () => '/index.html',
	}),
);

// 404
app.notFound((c) => c.json({ error: 'Not Found' }, 404));

// Error handler
app.onError((err, c) => {
	console.error('Unhandled error', { error: String(err), path: c.req.path });
	captureException(err, {
		tags: { source: 'hono_error' },
		extra: { path: c.req.path, method: c.req.method },
	});
	return c.json({ error: 'Internal Server Error' }, 500);
});

// Start
const port = Number(process.env.PORT) || 3001;

async function startDashboard(): Promise<void> {
	await initPrompts();
	console.log(`[Dashboard] Starting on port ${port}`);
	serve({ fetch: app.fetch, port });
}

startDashboard().catch(async (err) => {
	console.error('[Dashboard] Failed to start', { error: String(err) });
	captureException(err, { tags: { source: 'dashboard_startup' }, level: 'fatal' });
	await flush(3000);
	process.exit(1);
});
