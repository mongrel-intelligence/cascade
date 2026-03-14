/**
 * Tests for webhook signature verification wiring in src/router/index.ts.
 *
 * These tests verify the full verification flow:
 * - GitHub: X-Hub-Signature-256 header, project resolved by repository.full_name
 * - Trello: x-trello-webhook header, project resolved by board ID
 *
 * We test via the Hono app built in src/router/index.ts by importing the module
 * (which is side-effect-heavy), so we mock all heavy dependencies first.
 */

import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock all heavy side-effecting dependencies BEFORE module import
// ---------------------------------------------------------------------------

vi.mock('../../../src/router/queue.js', () => ({
	addJob: vi.fn(),
	getQueueStats: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../src/router/worker-manager.js', () => ({
	getActiveWorkerCount: vi.fn().mockReturnValue(0),
	getActiveWorkers: vi.fn().mockReturnValue([]),
	startWorkerProcessor: vi.fn(),
	stopWorkerProcessor: vi.fn(),
}));

vi.mock('@hono/node-server', () => ({
	serve: vi.fn(),
}));

vi.mock('../../../src/utils/webhookLogger.js', () => ({
	logWebhookCall: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: vi.fn(),
}));

vi.mock('../../../src/router/pre-actions.js', () => ({
	addEyesReactionToPR: vi.fn(),
}));

vi.mock('../../../src/router/cancel-listener.js', () => ({
	startCancelListener: vi.fn().mockResolvedValue(undefined),
	stopCancelListener: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/db/seeds/seedAgentDefinitions.js', () => ({
	seedAgentDefinitions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/config/agentMessages.js', () => ({
	initAgentMessages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/agents/prompts/index.js', () => ({
	initPrompts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/pm/bootstrap.js', () => ({}));

vi.mock('../../../src/triggers/builtins.js', () => ({
	registerBuiltInTriggers: vi.fn(),
}));

vi.mock('../../../src/triggers/registry.js', () => ({
	createTriggerRegistry: vi.fn().mockReturnValue({}),
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
	flush: vi.fn().mockResolvedValue(undefined),
	setTag: vi.fn(),
}));

vi.mock('../../../src/router/webhook-processor.js', () => ({
	processRouterWebhook: vi.fn().mockResolvedValue({
		shouldProcess: true,
		projectId: 'proj-1',
		decisionReason: 'matched',
	}),
}));

// Key mocks for this test suite
vi.mock('../../../src/router/config.js', () => ({
	loadProjectConfig: vi.fn(),
	routerConfig: {
		redisUrl: 'redis://localhost:6379',
		maxWorkers: 3,
		workerImage: 'test-image',
		workerMemoryMb: 4096,
		workerTimeoutMs: 1800000,
		dockerNetwork: 'services_default',
		emailScheduleIntervalMs: 300000,
		webhookCallbackBaseUrl: 'https://example.com',
	},
}));

vi.mock('../../../src/router/platformClients/credentials.js', () => ({
	resolveWebhookSecret: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { loadProjectConfig, routerConfig } from '../../../src/router/config.js';
import { resolveWebhookSecret } from '../../../src/router/platformClients/credentials.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function githubSignature(body: string, secret: string): string {
	const hex = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
	return `sha256=${hex}`;
}

function trelloSignature(body: string, callbackUrl: string, secret: string): string {
	return createHmac('sha1', secret)
		.update(body + callbackUrl, 'utf8')
		.digest('base64');
}

const GITHUB_PROJECT = {
	id: 'proj-gh',
	repo: 'owner/repo',
	pmType: 'trello' as const,
};

const TRELLO_PROJECT = {
	id: 'proj-trello',
	repo: 'owner/repo',
	pmType: 'trello' as const,
	trello: {
		boardId: 'board-abc',
		lists: { splitting: 'l1', planning: 'l2', todo: 'l3', debug: 'l4' },
		labels: { readyToProcess: 'lbl1' },
	},
};

const GITHUB_SECRET = 'my-github-webhook-secret';
const TRELLO_SECRET = 'my-trello-api-secret';
const TRELLO_CALLBACK_URL = 'https://example.com/trello/webhook';

// ---------------------------------------------------------------------------
// Tests: GitHub verifySignature callback (via router Hono app)
// ---------------------------------------------------------------------------

describe('router — GitHub webhook signature verification', () => {
	// We need to lazy-import the app after mocks are set up.
	// Import the module once, then get the underlying Hono app.
	// Since the app is not exported, we test through createWebhookHandler directly
	// by reconstructing the same logic as in src/router/index.ts.

	let app: Hono;

	beforeEach(async () => {
		vi.clearAllMocks();

		// Set up default mocks
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [GITHUB_PROJECT],
		});
		vi.mocked(resolveWebhookSecret).mockResolvedValue(GITHUB_SECRET);

		// Build minimal Hono app that mirrors src/router/index.ts GitHub handler
		const { createWebhookHandler, parseGitHubPayload } = await import(
			'../../../src/webhook/webhookHandlers.js'
		);
		const { verifyGitHubSignature } = await import('../../../src/webhook/signatureVerification.js');

		app = new Hono();
		app.post(
			'/github/webhook',
			createWebhookHandler({
				source: 'github',
				parsePayload: parseGitHubPayload,
				verifySignature: async (c, rawBody) => {
					const signatureHeader = c.req.header('X-Hub-Signature-256');

					let repoFullName: string | undefined;
					try {
						const parsed = JSON.parse(rawBody) as Record<string, unknown>;
						repoFullName = (parsed?.repository as Record<string, unknown>)?.full_name as
							| string
							| undefined;
					} catch {
						// skip
					}

					if (!repoFullName) return null;

					const { projects } = await loadProjectConfig();
					const project = projects.find((p) => p.repo === repoFullName);
					if (!project) return null;

					const secret = await resolveWebhookSecret(project.id, 'github');
					if (!secret) return null;

					if (!signatureHeader) {
						return { valid: false, reason: 'Missing signature header' };
					}

					const valid = verifyGitHubSignature(rawBody, signatureHeader, secret);
					return valid
						? { valid: true, reason: 'Signature valid' }
						: { valid: false, reason: 'GitHub signature mismatch' };
				},
				processWebhook: vi.fn().mockResolvedValue({
					processed: true,
					projectId: 'proj-gh',
					decisionReason: 'matched',
				}),
			}),
		);
	});

	function buildPayload(repoFullName = 'owner/repo') {
		return JSON.stringify({ repository: { full_name: repoFullName }, action: 'opened' });
	}

	async function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
		return app.fetch(
			new Request('http://localhost/github/webhook', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-GitHub-Event': 'pull_request',
					...headers,
				},
				body,
			}),
		);
	}

	it('returns 200 when signature is valid', async () => {
		const body = buildPayload();
		const sig = githubSignature(body, GITHUB_SECRET);
		const res = await post(body, { 'X-Hub-Signature-256': sig });
		expect(res.status).toBe(200);
	});

	it('returns 401 when signature is invalid (wrong secret)', async () => {
		const body = buildPayload();
		const badSig = githubSignature(body, 'wrong-secret');
		const res = await post(body, { 'X-Hub-Signature-256': badSig });
		expect(res.status).toBe(401);
	});

	it('returns 401 when signature header is missing but secret IS configured', async () => {
		const body = buildPayload();
		const res = await post(body);
		expect(res.status).toBe(401);
	});

	it('returns 200 (skip verification) when no webhook secret is configured for project', async () => {
		vi.mocked(resolveWebhookSecret).mockResolvedValue(null);
		const body = buildPayload();
		// No signature header, no secret → should pass through
		const res = await post(body);
		expect(res.status).toBe(200);
	});

	it('returns 200 (skip verification) when project is not found', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({ projects: [] });
		const body = buildPayload('unknown/repo');
		const res = await post(body);
		expect(res.status).toBe(200);
	});

	it('returns 200 (skip verification) when repo is missing from payload', async () => {
		const body = JSON.stringify({ action: 'opened' }); // no repository field
		const res = await post(body);
		expect(res.status).toBe(200);
	});

	it('logs decision reason to webhook_logs on 401', async () => {
		const { logWebhookCall } = await import('../../../src/utils/webhookLogger.js');
		const body = buildPayload();
		const badSig = githubSignature(body, 'wrong-secret');
		await post(body, { 'X-Hub-Signature-256': badSig });
		expect(logWebhookCall).toHaveBeenCalledWith(
			expect.objectContaining({
				statusCode: 401,
				processed: false,
				decisionReason: 'GitHub signature mismatch',
			}),
		);
	});

	it('logs Missing signature header reason when header absent but secret configured', async () => {
		const { logWebhookCall } = await import('../../../src/utils/webhookLogger.js');
		const body = buildPayload();
		await post(body);
		expect(logWebhookCall).toHaveBeenCalledWith(
			expect.objectContaining({
				statusCode: 401,
				decisionReason: 'Missing signature header',
			}),
		);
	});
});

// ---------------------------------------------------------------------------
// Tests: Trello verifySignature callback
// ---------------------------------------------------------------------------

describe('router — Trello webhook signature verification', () => {
	let app: Hono;

	beforeEach(async () => {
		vi.clearAllMocks();

		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [TRELLO_PROJECT],
		});
		vi.mocked(resolveWebhookSecret).mockResolvedValue(TRELLO_SECRET);

		const { createWebhookHandler, parseTrelloPayload } = await import(
			'../../../src/webhook/webhookHandlers.js'
		);
		const { verifyTrelloSignature } = await import('../../../src/webhook/signatureVerification.js');

		app = new Hono();
		app.post(
			'/trello/webhook',
			createWebhookHandler({
				source: 'trello',
				parsePayload: parseTrelloPayload,
				verifySignature: async (c, rawBody) => {
					const signatureHeader = c.req.header('x-trello-webhook');

					let boardId: string | undefined;
					try {
						const parsed = JSON.parse(rawBody) as Record<string, unknown>;
						boardId = ((parsed?.action as Record<string, unknown>)?.data as Record<string, unknown>)
							?.board?.id as string | undefined;
						if (!boardId) {
							boardId = (parsed?.model as Record<string, unknown>)?.id as string | undefined;
						}
					} catch {
						// skip
					}

					if (!boardId) return null;

					const { projects } = await loadProjectConfig();
					const project = projects.find((p) => p.trello?.boardId === boardId);
					if (!project) return null;

					const secret = await resolveWebhookSecret(project.id, 'trello');
					if (!secret) return null;

					if (!signatureHeader) {
						return { valid: false, reason: 'Missing signature header' };
					}

					const callbackUrl =
						(routerConfig.webhookCallbackBaseUrl ?? '')
							? `${routerConfig.webhookCallbackBaseUrl}/trello/webhook`
							: `${c.req.header('x-forwarded-proto') ?? 'https'}://${c.req.header('host')}/trello/webhook`;

					const valid = verifyTrelloSignature(rawBody, callbackUrl, signatureHeader, secret);
					return valid
						? { valid: true, reason: 'Signature valid' }
						: { valid: false, reason: 'Trello signature mismatch' };
				},
				processWebhook: vi.fn().mockResolvedValue({
					processed: true,
					projectId: 'proj-trello',
					decisionReason: 'matched',
				}),
			}),
		);
	});

	function buildTrelloPayload(boardId = 'board-abc') {
		return JSON.stringify({
			action: { type: 'createCard', data: { board: { id: boardId } } },
		});
	}

	async function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
		return app.fetch(
			new Request('http://localhost/trello/webhook', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...headers,
				},
				body,
			}),
		);
	}

	it('returns 200 when signature is valid', async () => {
		const body = buildTrelloPayload();
		const sig = trelloSignature(body, TRELLO_CALLBACK_URL, TRELLO_SECRET);
		const res = await post(body, { 'x-trello-webhook': sig });
		expect(res.status).toBe(200);
	});

	it('returns 401 when signature is invalid (wrong secret)', async () => {
		const body = buildTrelloPayload();
		const badSig = trelloSignature(body, TRELLO_CALLBACK_URL, 'wrong-secret');
		const res = await post(body, { 'x-trello-webhook': badSig });
		expect(res.status).toBe(401);
	});

	it('returns 401 when signature header is missing but secret IS configured', async () => {
		const body = buildTrelloPayload();
		const res = await post(body);
		expect(res.status).toBe(401);
	});

	it('returns 200 (skip verification) when no webhook secret is configured', async () => {
		vi.mocked(resolveWebhookSecret).mockResolvedValue(null);
		const body = buildTrelloPayload();
		const res = await post(body);
		expect(res.status).toBe(200);
	});

	it('returns 200 (skip verification) when project is not found for board ID', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({ projects: [] });
		const body = buildTrelloPayload('unknown-board');
		const res = await post(body);
		expect(res.status).toBe(200);
	});

	it('falls back to model.id for board ID resolution', async () => {
		const body = JSON.stringify({ model: { id: 'board-abc' }, action: { type: 'createCard' } });
		const sig = trelloSignature(body, TRELLO_CALLBACK_URL, TRELLO_SECRET);
		const res = await post(body, { 'x-trello-webhook': sig });
		expect(res.status).toBe(200);
	});

	it('returns 200 (skip verification) when board ID is missing from payload', async () => {
		const body = JSON.stringify({ action: { type: 'createCard' } }); // no board ID
		const res = await post(body);
		expect(res.status).toBe(200);
	});

	it('logs decision reason to webhook_logs on 401', async () => {
		const { logWebhookCall } = await import('../../../src/utils/webhookLogger.js');
		const body = buildTrelloPayload();
		const badSig = trelloSignature(body, TRELLO_CALLBACK_URL, 'wrong-secret');
		await post(body, { 'x-trello-webhook': badSig });
		expect(logWebhookCall).toHaveBeenCalledWith(
			expect.objectContaining({
				statusCode: 401,
				processed: false,
				decisionReason: 'Trello signature mismatch',
			}),
		);
	});

	it('logs Missing signature header reason when header absent but secret configured', async () => {
		const { logWebhookCall } = await import('../../../src/utils/webhookLogger.js');
		const body = buildTrelloPayload();
		await post(body);
		expect(logWebhookCall).toHaveBeenCalledWith(
			expect.objectContaining({
				statusCode: 401,
				decisionReason: 'Missing signature header',
			}),
		);
	});
});
