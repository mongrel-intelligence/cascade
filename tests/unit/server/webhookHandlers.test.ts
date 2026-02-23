import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Must mock heavy imports BEFORE importing the module under test
vi.mock('../../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/config/provider.js', () => ({
	findProjectByRepo: vi.fn(),
}));

vi.mock('../../../src/github/personas.js', () => ({
	resolvePersonaIdentities: vi.fn(),
}));

vi.mock('../../../src/utils/index.js', () => ({
	canAcceptWebhook: vi.fn().mockReturnValue(true),
	isCurrentlyProcessing: vi.fn().mockReturnValue(false),
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

import { findProjectByRepo } from '../../../src/config/provider.js';
import { resolvePersonaIdentities } from '../../../src/github/personas.js';
import { sendAcknowledgeReaction } from '../../../src/router/reactions.js';
import { captureException } from '../../../src/sentry.js';
import {
	buildGitHubReactionSender,
	buildJiraReactionSender,
	buildTrelloReactionSender,
	createWebhookHandler,
	parseGitHubPayload,
	parseJiraPayload,
	parseTrelloPayload,
} from '../../../src/server/webhookHandlers.js';
import { canAcceptWebhook, isCurrentlyProcessing } from '../../../src/utils/index.js';
import { logWebhookCall } from '../../../src/utils/webhookLogger.js';

const mockCaptureException = vi.mocked(captureException);
const mockLogWebhookCall = vi.mocked(logWebhookCall);
const mockIsCurrentlyProcessing = vi.mocked(isCurrentlyProcessing);
const mockCanAcceptWebhook = vi.mocked(canAcceptWebhook);
const mockSendAcknowledgeReaction = vi.mocked(sendAcknowledgeReaction);
const mockFindProjectByRepo = vi.mocked(findProjectByRepo);
const mockResolvePersonaIdentities = vi.mocked(resolvePersonaIdentities);

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
// createWebhookHandler — core factory behaviour
// ---------------------------------------------------------------------------

describe('createWebhookHandler', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsCurrentlyProcessing.mockReturnValue(false);
		mockCanAcceptWebhook.mockReturnValue(true);
	});

	it('returns 503 when at capacity (checkCapacity=true)', async () => {
		mockIsCurrentlyProcessing.mockReturnValue(true);
		mockCanAcceptWebhook.mockReturnValue(false);

		const handler = createWebhookHandler({
			source: 'trello',
			parsePayload: async () => ({ ok: true, payload: {}, eventType: 'test' }),
			processWebhook: vi.fn().mockResolvedValue(undefined),
			checkCapacity: true,
		});

		const app = buildApp(handler);
		const res = await postJson(app, {});
		expect(res.status).toBe(503);
	});

	it('does NOT return 503 when checkCapacity=false even at capacity', async () => {
		mockIsCurrentlyProcessing.mockReturnValue(true);
		mockCanAcceptWebhook.mockReturnValue(false);

		const handler = createWebhookHandler({
			source: 'trello',
			checkCapacity: false,
			parsePayload: async () => ({ ok: true, payload: {}, eventType: 'test' }),
			processWebhook: vi.fn().mockResolvedValue(undefined),
		});

		const app = buildApp(handler);
		const res = await postJson(app, {});
		expect(res.status).toBe(200);
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

	it('calls processWebhook asynchronously via setImmediate', async () => {
		vi.useFakeTimers();
		const processWebhook = vi.fn().mockResolvedValue(undefined);
		const handler = createWebhookHandler({
			source: 'trello',
			parsePayload: async () => ({ ok: true, payload: { x: 1 }, eventType: 'commentCard' }),
			processWebhook,
		});

		const app = buildApp(handler);
		await postJson(app, { x: 1 });

		// Not yet called — setImmediate hasn't fired
		expect(processWebhook).not.toHaveBeenCalled();

		await vi.runAllTimersAsync();
		expect(processWebhook).toHaveBeenCalledWith({ x: 1 }, 'commentCard');
		vi.useRealTimers();
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

	it('awaits processWebhook when fireAndForget=false', async () => {
		const callOrder: string[] = [];
		const processWebhook = vi.fn().mockImplementation(async () => {
			callOrder.push('process');
		});
		const handler = createWebhookHandler({
			source: 'trello',
			fireAndForget: false,
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

	it('uses processWebhook return value to enrich log when fireAndForget=false', async () => {
		const handler = createWebhookHandler({
			source: 'trello',
			fireAndForget: false,
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

	it('ignores processWebhook return value when fireAndForget=true (logs before processing)', async () => {
		vi.useFakeTimers();
		const handler = createWebhookHandler({
			source: 'github',
			fireAndForget: true,
			parsePayload: async () => ({ ok: true, payload: { y: 2 }, eventType: 'push' }),
			processWebhook: vi.fn().mockResolvedValue({ processed: false, projectId: 'proj-456' }),
		});

		const app = buildApp(handler);
		await postJson(app, { y: 2 });

		// In fire-and-forget mode, log happens before processing, so overrides are not available
		expect(mockLogWebhookCall).toHaveBeenCalledWith(
			expect.objectContaining({
				statusCode: 200,
				processed: true, // default, not the override
			}),
		);
		vi.useRealTimers();
	});

	it('logs processed:true by default when processWebhook returns void', async () => {
		const handler = createWebhookHandler({
			source: 'jira',
			fireAndForget: false,
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

	it('log overrides reflect actual processing outcome when fireAndForget=false', async () => {
		const handler = createWebhookHandler({
			source: 'trello',
			fireAndForget: false,
			parsePayload: async () => ({ ok: true, payload: {}, eventType: 'commentCard' }),
			processWebhook: async () => {
				// Simulate actual processing that determines outcome
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

	it('captures processWebhook errors to Sentry in fire-and-forget mode', async () => {
		vi.useFakeTimers();
		const processError = new Error('redis connection failed');
		const handler = createWebhookHandler({
			source: 'trello',
			fireAndForget: true,
			parsePayload: async () => ({ ok: true, payload: {}, eventType: 'commentCard' }),
			processWebhook: vi.fn().mockRejectedValue(processError),
		});

		const app = buildApp(handler);
		const res = await postJson(app, {});
		// Fire-and-forget always returns 200
		expect(res.status).toBe(200);

		// Let setImmediate fire and the rejection be caught
		await vi.runAllTimersAsync();

		expect(mockCaptureException).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'redis connection failed' }),
			expect.objectContaining({ tags: { source: 'trello_webhook' } }),
		);
		vi.useRealTimers();
	});

	it('lets processWebhook errors propagate when fireAndForget=false', async () => {
		const handler = createWebhookHandler({
			source: 'jira',
			fireAndForget: false,
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
});

// ---------------------------------------------------------------------------
// Platform parsers
// ---------------------------------------------------------------------------

describe('parseTrelloPayload', () => {
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

describe('parseJiraPayload', () => {
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

describe('parseGitHubPayload', () => {
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

// ---------------------------------------------------------------------------
// Reaction senders
// ---------------------------------------------------------------------------

describe('buildTrelloReactionSender', () => {
	const config = {
		defaults: {} as never,
		projects: [
			{
				id: 'proj-1',
				trello: { boardId: 'board-abc' },
			} as never,
		],
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('sends reaction for commentCard events', async () => {
		vi.useFakeTimers();
		const sender = buildTrelloReactionSender(config);
		const payload = { model: { id: 'board-abc' }, action: { type: 'commentCard' } };
		sender(payload, 'commentCard');
		await vi.runAllTimersAsync();
		expect(mockSendAcknowledgeReaction).toHaveBeenCalledWith('trello', 'proj-1', payload);
		vi.useRealTimers();
	});

	it('does not send reaction for non-commentCard events', () => {
		const sender = buildTrelloReactionSender(config);
		sender({ model: { id: 'board-abc' } }, 'updateCard');
		expect(mockSendAcknowledgeReaction).not.toHaveBeenCalled();
	});

	it('does not send reaction when board not found', async () => {
		vi.useFakeTimers();
		const sender = buildTrelloReactionSender(config);
		sender({ model: { id: 'unknown-board' } }, 'commentCard');
		await vi.runAllTimersAsync();
		expect(mockSendAcknowledgeReaction).not.toHaveBeenCalled();
		vi.useRealTimers();
	});
});

describe('buildGitHubReactionSender', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('sends reaction for issue_comment events', async () => {
		vi.useFakeTimers();
		const mockProject = { id: 'proj-1' } as never;
		mockFindProjectByRepo.mockResolvedValue(mockProject);
		mockResolvePersonaIdentities.mockResolvedValue({
			implementer: 'bot-impl',
			reviewer: 'bot-rev',
		});

		const sender = buildGitHubReactionSender();
		const payload = { repository: { full_name: 'owner/repo' }, comment: { id: 1 } };
		sender(payload, 'issue_comment');
		await vi.runAllTimersAsync();

		expect(mockFindProjectByRepo).toHaveBeenCalledWith('owner/repo');
		expect(mockSendAcknowledgeReaction).toHaveBeenCalledWith(
			'github',
			'owner/repo',
			payload,
			{ implementer: 'bot-impl', reviewer: 'bot-rev' },
			mockProject,
		);
		vi.useRealTimers();
	});

	it('does not send reaction for push events', async () => {
		vi.useFakeTimers();
		const sender = buildGitHubReactionSender();
		sender({ repository: { full_name: 'owner/repo' } }, 'push');
		await vi.runAllTimersAsync();
		expect(mockSendAcknowledgeReaction).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it('does not send reaction when repo is missing', async () => {
		vi.useFakeTimers();
		const sender = buildGitHubReactionSender();
		sender({}, 'issue_comment');
		await vi.runAllTimersAsync();
		expect(mockSendAcknowledgeReaction).not.toHaveBeenCalled();
		vi.useRealTimers();
	});
});

describe('buildJiraReactionSender', () => {
	const config = {
		defaults: {} as never,
		projects: [
			{
				id: 'jira-proj-1',
				jira: { projectKey: 'PROJ' },
			} as never,
		],
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('sends reaction for comment_created events', async () => {
		vi.useFakeTimers();
		const sender = buildJiraReactionSender(config);
		const payload = {
			webhookEvent: 'comment_created',
			issue: { fields: { project: { key: 'PROJ' } } },
		};
		sender(payload, 'comment_created');
		await vi.runAllTimersAsync();
		expect(mockSendAcknowledgeReaction).toHaveBeenCalledWith('jira', 'jira-proj-1', payload);
		vi.useRealTimers();
	});

	it('does not send reaction for non-comment_ events', async () => {
		vi.useFakeTimers();
		const sender = buildJiraReactionSender(config);
		sender(
			{ webhookEvent: 'jira:issue_updated', issue: { fields: { project: { key: 'PROJ' } } } },
			'jira:issue_updated',
		);
		await vi.runAllTimersAsync();
		expect(mockSendAcknowledgeReaction).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it('does not send reaction when project key not found', async () => {
		vi.useFakeTimers();
		const sender = buildJiraReactionSender(config);
		sender(
			{ webhookEvent: 'comment_created', issue: { fields: { project: { key: 'UNKNOWN' } } } },
			'comment_created',
		);
		await vi.runAllTimersAsync();
		expect(mockSendAcknowledgeReaction).not.toHaveBeenCalled();
		vi.useRealTimers();
	});
});
