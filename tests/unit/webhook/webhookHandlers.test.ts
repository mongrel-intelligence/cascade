import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Must mock heavy imports BEFORE importing the module under test
vi.mock('../../../src/utils/index.js', () => ({
	logger: {
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../src/utils/webhookLogger.js', () => ({
	logWebhookCall: vi.fn(),
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

import { captureException } from '../../../src/sentry.js';
import { logWebhookCall } from '../../../src/utils/webhookLogger.js';
import {
	createWebhookHandler,
	parseGitHubPayload,
	parseJiraPayload,
	parseTrelloPayload,
} from '../../../src/webhook/webhookHandlers.js';

const mockCaptureException = vi.mocked(captureException);
const mockLogWebhookCall = vi.mocked(logWebhookCall);

/** Build a minimal Hono app with the handler mounted at POST /webhook */
function buildApp(handler: ReturnType<typeof createWebhookHandler>): Hono {
	const app = new Hono();
	app.post('/webhook', handler);
	return app;
}

async function postJson(
	app: Hono,
	body: unknown,
	headers: Record<string, string> = {},
): Promise<Response> {
	const request = new Request('http://localhost/webhook', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body),
	});
	return app.fetch(request);
}

// ---------------------------------------------------------------------------
// createWebhookHandler — router mode (always awaits processing)
// ---------------------------------------------------------------------------

describe('createWebhookHandler', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns 400 when parsePayload fails', async () => {
		const handler = createWebhookHandler({
			source: 'jira',
			parsePayload: async () => ({ ok: false, error: 'bad json' }),
			processWebhook: vi.fn().mockResolvedValue(undefined),
		});

		const app = buildApp(handler);
		const res = await postJson(app, 'not-json');
		expect(res.status).toBe(400);

		expect(mockLogWebhookCall).toHaveBeenCalledWith(
			expect.objectContaining({
				statusCode: 400,
				processed: false,
				bodyRaw: 'bad json',
			}),
		);
	});

	it('returns 200 and logs on success', async () => {
		const payload = { foo: 'bar' };
		const handler = createWebhookHandler({
			source: 'github',
			parsePayload: async () => ({ ok: true, payload, eventType: 'push' }),
			processWebhook: vi.fn().mockResolvedValue(undefined),
		});

		const app = buildApp(handler);
		const res = await postJson(app, payload);
		expect(res.status).toBe(200);

		expect(mockLogWebhookCall).toHaveBeenCalledWith(
			expect.objectContaining({
				source: 'github',
				statusCode: 200,
				processed: true,
				eventType: 'push',
				body: payload,
			}),
		);
	});

	it('awaits processWebhook before responding', async () => {
		const callOrder: string[] = [];
		const processWebhook = vi.fn().mockImplementation(async () => {
			callOrder.push('process');
		});
		const handler = createWebhookHandler({
			source: 'trello',
			parsePayload: async () => ({ ok: true, payload: { x: 1 }, eventType: 'commentCard' }),
			processWebhook,
		});

		const app = buildApp(handler);
		const res = await postJson(app, { x: 1 });

		// processWebhook was called synchronously before response
		expect(res.status).toBe(200);
		expect(processWebhook).toHaveBeenCalledWith({ x: 1 }, 'commentCard');
		expect(callOrder).toEqual(['process']);
	});

	it('calls sendReaction when provided and parse succeeds', async () => {
		const sendReaction = vi.fn();
		const handler = createWebhookHandler({
			source: 'trello',
			parsePayload: async () => ({ ok: true, payload: { a: 1 }, eventType: 'commentCard' }),
			sendReaction,
			processWebhook: vi.fn().mockResolvedValue(undefined),
		});

		const app = buildApp(handler);
		await postJson(app, { a: 1 });

		expect(sendReaction).toHaveBeenCalledWith({ a: 1 }, 'commentCard');
	});

	it('does NOT call sendReaction when parse fails', async () => {
		const sendReaction = vi.fn();
		const handler = createWebhookHandler({
			source: 'trello',
			parsePayload: async () => ({ ok: false, error: 'parse error' }),
			sendReaction,
			processWebhook: vi.fn().mockResolvedValue(undefined),
		});

		const app = buildApp(handler);
		await postJson(app, {});

		expect(sendReaction).not.toHaveBeenCalled();
	});

	it('uses processWebhook return value to enrich log', async () => {
		const handler = createWebhookHandler({
			source: 'trello',
			parsePayload: async () => ({ ok: true, payload: { x: 1 }, eventType: 'commentCard' }),
			processWebhook: vi.fn().mockResolvedValue({ processed: false, projectId: 'proj-123' }),
		});

		const app = buildApp(handler);
		await postJson(app, { x: 1 });

		expect(mockLogWebhookCall).toHaveBeenCalledWith(
			expect.objectContaining({
				statusCode: 200,
				processed: false,
				projectId: 'proj-123',
			}),
		);
	});

	it('logs processed:true by default when processWebhook returns void', async () => {
		const handler = createWebhookHandler({
			source: 'jira',
			parsePayload: async () => ({ ok: true, payload: {}, eventType: 'issue_updated' }),
			processWebhook: vi.fn().mockResolvedValue(undefined),
		});

		const app = buildApp(handler);
		await postJson(app, {});

		expect(mockLogWebhookCall).toHaveBeenCalledWith(
			expect.objectContaining({
				statusCode: 200,
				processed: true,
			}),
		);
	});

	it('log overrides reflect actual processing outcome', async () => {
		const handler = createWebhookHandler({
			source: 'trello',
			parsePayload: async () => ({ ok: true, payload: {}, eventType: 'commentCard' }),
			processWebhook: async () => {
				return { processed: true, projectId: 'proj-789' };
			},
		});

		const app = buildApp(handler);
		await postJson(app, {});

		expect(mockLogWebhookCall).toHaveBeenCalledWith(
			expect.objectContaining({
				processed: true,
				projectId: 'proj-789',
			}),
		);
	});

	it('propagates processWebhook errors to Hono error handler', async () => {
		const handler = createWebhookHandler({
			source: 'jira',
			parsePayload: async () => ({ ok: true, payload: {}, eventType: 'issue_updated' }),
			processWebhook: vi.fn().mockRejectedValue(new Error('queue connection failed')),
		});

		const app = new Hono();
		// Register an error handler to capture the propagated error
		app.post('/webhook', handler);
		app.onError((err, c) => {
			return c.text(`Error: ${err.message}`, 500);
		});

		const res = await postJson(app, {});
		expect(res.status).toBe(500);
		const body = await res.text();
		expect(body).toContain('queue connection failed');
	});

	it('captures processWebhook errors to Sentry before re-throwing', async () => {
		const processError = new Error('redis connection failed');
		const handler = createWebhookHandler({
			source: 'trello',
			parsePayload: async () => ({ ok: true, payload: {}, eventType: 'commentCard' }),
			processWebhook: vi.fn().mockRejectedValue(processError),
		});

		const app = new Hono();
		app.post('/webhook', handler);
		app.onError((_err, c) => c.text('Error', 500));

		await postJson(app, {});

		expect(mockCaptureException).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'redis connection failed' }),
			expect.objectContaining({ tags: { source: 'trello_webhook' } }),
		);
	});
});

// ---------------------------------------------------------------------------
// Platform parsers (integration tests via Hono)
// ---------------------------------------------------------------------------

describe('parseTrelloPayload (via createWebhookHandler)', () => {
	it('extracts eventType from action.type', async () => {
		const app = new Hono();
		app.post('/test', async (c) => {
			const result = await parseTrelloPayload(c);
			return c.json(result);
		});
		const res = await app.fetch(
			new Request('http://localhost/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: { type: 'commentCard' } }),
			}),
		);
		const body = await res.json();
		expect(body).toMatchObject({ ok: true, eventType: 'commentCard' });
	});

	it('returns ok:false for invalid JSON', async () => {
		const app = new Hono();
		app.post('/test', async (c) => {
			const result = await parseTrelloPayload(c);
			return c.json(result);
		});
		const res = await app.fetch(
			new Request('http://localhost/test', {
				method: 'POST',
				headers: { 'Content-Type': 'text/plain' },
				body: 'not-json',
			}),
		);
		const body = await res.json();
		expect(body.ok).toBe(false);
	});
});

describe('parseJiraPayload (via createWebhookHandler)', () => {
	it('extracts eventType from webhookEvent', async () => {
		const app = new Hono();
		app.post('/test', async (c) => {
			const result = await parseJiraPayload(c);
			return c.json(result);
		});
		const res = await app.fetch(
			new Request('http://localhost/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ webhookEvent: 'comment_created', issue: { key: 'PROJ-1' } }),
			}),
		);
		const body = await res.json();
		expect(body).toMatchObject({ ok: true, eventType: 'comment_created' });
	});
});

describe('parseGitHubPayload (via createWebhookHandler)', () => {
	it('extracts eventType from X-GitHub-Event header', async () => {
		const app = new Hono();
		app.post('/test', async (c) => {
			const result = await parseGitHubPayload(c);
			return c.json(result);
		});
		const res = await app.fetch(
			new Request('http://localhost/test', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-GitHub-Event': 'issue_comment',
				},
				body: JSON.stringify({ action: 'created', repository: { full_name: 'owner/repo' } }),
			}),
		);
		const body = await res.json();
		expect(body).toMatchObject({ ok: true, eventType: 'issue_comment' });
	});
});
