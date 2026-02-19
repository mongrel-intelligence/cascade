/**
 * Dashboard API Entry Point
 *
 * Lightweight Hono server for the dashboard container.
 * Serves only auth routes + tRPC — no webhooks, no trigger registry, no static files.
 *
 * Environment variables:
 * - PORT (default: 3001)
 * - DATABASE_URL — PostgreSQL connection string
 * - CORS_ORIGIN — Frontend origin (e.g. https://ca.sca.de.com)
 * - COOKIE_DOMAIN — Cookie domain for cross-origin auth
 * - REDIS_URL — Redis for job dispatch to the router's worker-manager
 */

import { serve } from '@hono/node-server';
import { trpcServer } from '@hono/trpc-server';
import * as Sentry from '@sentry/node';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { loginHandler } from './api/auth/login.js';
import { logoutHandler } from './api/auth/logout.js';
import { resolveUserFromSession } from './api/auth/session.js';
import { computeEffectiveOrgId } from './api/context.js';
import { appRouter } from './api/router.js';
import { initSentry } from './utils/sentry.js';

// Initialize Sentry (no-op if SENTRY_DSN is unset)
initSentry('cascade-dashboard');

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
			const token = getCookie(c, 'cascade_session');
			const user = token ? await resolveUserFromSession(token) : null;
			const effectiveOrgId = await computeEffectiveOrgId(user, c.req.header('x-org-context'));
			return { user, effectiveOrgId };
		},
	}),
);

// 404
app.notFound((c) => c.json({ error: 'Not Found' }, 404));

// Error handler
app.onError((err, c) => {
	console.error('Unhandled error', { error: String(err), path: c.req.path });
	Sentry.captureException(err);
	return c.json({ error: 'Internal Server Error' }, 500);
});

// Start
const port = Number(process.env.PORT) || 3001;
console.log(`[Dashboard] Starting on port ${port}`);
serve({ fetch: app.fetch, port });
