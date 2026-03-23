/**
 * Tests for webhook signature verification helpers in src/router/webhookVerification.ts.
 *
 * These tests exercise the actual production functions:
 * - `verifyGitHubWebhookSignature` — verifySignature callback for GitHub webhooks
 * - `verifyTrelloWebhookSignature` — verifySignature callback for Trello webhooks
 * - `extractTrelloBoardId` — board ID extraction from raw Trello payloads
 * - `buildTrelloCallbackUrl` — callback URL construction with fallback logic
 *
 * The verification callbacks are also tested end-to-end by wiring them into a
 * minimal Hono app (mirroring the wiring in src/router/index.ts), verifying the
 * full HTTP request/response flow.
 */

import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import {
	buildTrelloCallbackUrl,
	createWebhookVerifier,
	extractJiraProjectKey,
	extractTrelloBoardId,
	verifyGitHubWebhookSignature,
	verifyJiraWebhookSignature,
	verifyTrelloWebhookSignature,
} from '../../../src/router/webhookVerification.js';
import { logger } from '../../../src/utils/logging.js';

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

function jiraSignature(body: string, secret: string): string {
	const hex = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
	return `sha256=${hex}`;
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

const JIRA_PROJECT = {
	id: 'proj-jira',
	repo: 'owner/repo',
	pmType: 'jira' as const,
	jira: {
		projectKey: 'PROJ',
		baseUrl: 'https://example.atlassian.net',
		statuses: {},
	},
};

const GITHUB_SECRET = 'my-github-webhook-secret';
const TRELLO_SECRET = 'my-trello-api-secret';
const JIRA_SECRET = 'my-jira-webhook-secret';
const TRELLO_CALLBACK_URL = 'https://example.com/trello/webhook';

// ---------------------------------------------------------------------------
// Unit tests: extractTrelloBoardId
// ---------------------------------------------------------------------------

describe('extractTrelloBoardId', () => {
	it('extracts board ID from action.data.board.id', () => {
		const body = JSON.stringify({
			action: { type: 'createCard', data: { board: { id: 'board-abc' } } },
		});
		expect(extractTrelloBoardId(body)).toBe('board-abc');
	});

	it('falls back to model.id when action.data.board.id is missing', () => {
		const body = JSON.stringify({ model: { id: 'board-xyz' }, action: { type: 'createBoard' } });
		expect(extractTrelloBoardId(body)).toBe('board-xyz');
	});

	it('returns undefined when board ID is absent', () => {
		const body = JSON.stringify({ action: { type: 'createCard' } });
		expect(extractTrelloBoardId(body)).toBeUndefined();
	});

	it('returns undefined for invalid JSON', () => {
		expect(extractTrelloBoardId('not json')).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Unit tests: buildTrelloCallbackUrl
// ---------------------------------------------------------------------------

describe('buildTrelloCallbackUrl', () => {
	it('uses webhookCallbackBaseUrl from routerConfig when set', () => {
		// routerConfig is mocked with webhookCallbackBaseUrl: 'https://example.com'
		const url = buildTrelloCallbackUrl('other-host.com', 'http');
		expect(url).toBe('https://example.com/trello/webhook');
	});

	describe('when webhookCallbackBaseUrl is not set', () => {
		beforeEach(() => {
			// Temporarily clear the base URL to test fallback behaviour
			(routerConfig as { webhookCallbackBaseUrl: string | undefined }).webhookCallbackBaseUrl =
				undefined;
		});

		afterEach(() => {
			// Restore the mocked base URL so other tests are unaffected
			(routerConfig as { webhookCallbackBaseUrl: string | undefined }).webhookCallbackBaseUrl =
				'https://example.com';
		});

		it('falls back to proto and host headers to construct the URL', () => {
			const url = buildTrelloCallbackUrl('myhost.example.com', 'https');
			expect(url).toBe('https://myhost.example.com/trello/webhook');
		});

		it('uses http proto from header when provided', () => {
			const url = buildTrelloCallbackUrl('myhost.example.com', 'http');
			expect(url).toBe('http://myhost.example.com/trello/webhook');
		});

		it('defaults proto to https when proto header is missing', () => {
			const url = buildTrelloCallbackUrl('myhost.example.com', undefined);
			expect(url).toBe('https://myhost.example.com/trello/webhook');
		});

		it('warns when host header is missing and no base URL is configured', () => {
			buildTrelloCallbackUrl(undefined, undefined);
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Host header is missing'));
		});

		it('still returns a URL (with undefined host) even when host is missing', () => {
			const url = buildTrelloCallbackUrl(undefined, 'https');
			expect(url).toBe('https://undefined/trello/webhook');
		});
	});
});

// ---------------------------------------------------------------------------
// Unit tests: verifyGitHubWebhookSignature (function directly)
// ---------------------------------------------------------------------------

describe('verifyGitHubWebhookSignature — direct function tests', () => {
	beforeEach(() => {
		vi.mocked(loadProjectConfig).mockResolvedValue({ projects: [GITHUB_PROJECT] });
		vi.mocked(resolveWebhookSecret).mockResolvedValue(GITHUB_SECRET);
	});

	function makeContext(headers: Record<string, string> = {}) {
		return {
			req: {
				header: (name: string) => headers[name.toLowerCase()] ?? headers[name],
			},
		} as unknown as import('hono').Context;
	}

	it('returns { valid: true } when signature is correct', async () => {
		const body = JSON.stringify({ repository: { full_name: 'owner/repo' }, action: 'opened' });
		const sig = githubSignature(body, GITHUB_SECRET);
		const result = await verifyGitHubWebhookSignature(
			makeContext({ 'X-Hub-Signature-256': sig }),
			body,
		);
		expect(result).toEqual({ valid: true, reason: 'Signature valid' });
	});

	it('returns { valid: false } when signature is wrong', async () => {
		const body = JSON.stringify({ repository: { full_name: 'owner/repo' }, action: 'opened' });
		const badSig = githubSignature(body, 'wrong-secret');
		const result = await verifyGitHubWebhookSignature(
			makeContext({ 'X-Hub-Signature-256': badSig }),
			body,
		);
		expect(result).toEqual({ valid: false, reason: 'GitHub signature mismatch' });
	});

	it('returns { valid: false, reason: "Missing signature header" } when header absent but secret configured', async () => {
		const body = JSON.stringify({ repository: { full_name: 'owner/repo' }, action: 'opened' });
		const result = await verifyGitHubWebhookSignature(makeContext({}), body);
		expect(result).toEqual({ valid: false, reason: 'Missing signature header' });
	});

	it('returns null (skip) when no secret configured', async () => {
		vi.mocked(resolveWebhookSecret).mockResolvedValue(null);
		const body = JSON.stringify({ repository: { full_name: 'owner/repo' }, action: 'opened' });
		const result = await verifyGitHubWebhookSignature(makeContext({}), body);
		expect(result).toBeNull();
	});

	it('returns null (skip) when project not found', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({ projects: [] });
		const body = JSON.stringify({ repository: { full_name: 'unknown/repo' }, action: 'opened' });
		const result = await verifyGitHubWebhookSignature(makeContext({}), body);
		expect(result).toBeNull();
	});

	it('returns null (skip) when repo is missing from payload', async () => {
		const body = JSON.stringify({ action: 'opened' });
		const result = await verifyGitHubWebhookSignature(makeContext({}), body);
		expect(result).toBeNull();
	});

	it('verifies signature correctly for form-urlencoded delivery (valid signature)', async () => {
		const payloadObj = { repository: { full_name: 'owner/repo' }, action: 'opened' };
		const rawBody = `payload=${encodeURIComponent(JSON.stringify(payloadObj))}`;
		const sig = githubSignature(rawBody, GITHUB_SECRET);
		const result = await verifyGitHubWebhookSignature(
			makeContext({ 'X-Hub-Signature-256': sig }),
			rawBody,
		);
		expect(result).toEqual({ valid: true, reason: 'Signature valid' });
	});

	it('returns { valid: false } for form-urlencoded delivery with wrong signature', async () => {
		const payloadObj = { repository: { full_name: 'owner/repo' }, action: 'opened' };
		const rawBody = `payload=${encodeURIComponent(JSON.stringify(payloadObj))}`;
		const badSig = githubSignature(rawBody, 'wrong-secret');
		const result = await verifyGitHubWebhookSignature(
			makeContext({ 'X-Hub-Signature-256': badSig }),
			rawBody,
		);
		expect(result).toEqual({ valid: false, reason: 'GitHub signature mismatch' });
	});

	it('returns { valid: false, reason: "Missing signature header" } for form-urlencoded when header absent but secret configured', async () => {
		const payloadObj = { repository: { full_name: 'owner/repo' }, action: 'opened' };
		const rawBody = `payload=${encodeURIComponent(JSON.stringify(payloadObj))}`;
		const result = await verifyGitHubWebhookSignature(makeContext({}), rawBody);
		expect(result).toEqual({ valid: false, reason: 'Missing signature header' });
	});
});

// ---------------------------------------------------------------------------
// Unit tests: verifyTrelloWebhookSignature (function directly)
// ---------------------------------------------------------------------------

describe('verifyTrelloWebhookSignature — direct function tests', () => {
	beforeEach(() => {
		vi.mocked(loadProjectConfig).mockResolvedValue({ projects: [TRELLO_PROJECT] });
		vi.mocked(resolveWebhookSecret).mockResolvedValue(TRELLO_SECRET);
	});

	function makeContext(headers: Record<string, string> = {}) {
		return {
			req: {
				header: (name: string) => headers[name.toLowerCase()] ?? headers[name],
			},
		} as unknown as import('hono').Context;
	}

	it('returns { valid: true } when signature is correct', async () => {
		const body = JSON.stringify({
			action: { type: 'createCard', data: { board: { id: 'board-abc' } } },
		});
		const sig = trelloSignature(body, TRELLO_CALLBACK_URL, TRELLO_SECRET);
		const result = await verifyTrelloWebhookSignature(
			makeContext({ 'x-trello-webhook': sig }),
			body,
		);
		expect(result).toEqual({ valid: true, reason: 'Signature valid' });
	});

	it('returns { valid: false } when signature is wrong', async () => {
		const body = JSON.stringify({
			action: { type: 'createCard', data: { board: { id: 'board-abc' } } },
		});
		const badSig = trelloSignature(body, TRELLO_CALLBACK_URL, 'wrong-secret');
		const result = await verifyTrelloWebhookSignature(
			makeContext({ 'x-trello-webhook': badSig }),
			body,
		);
		expect(result).toEqual({ valid: false, reason: 'Trello signature mismatch' });
	});

	it('returns { valid: false, reason: "Missing signature header" } when header absent', async () => {
		const body = JSON.stringify({
			action: { type: 'createCard', data: { board: { id: 'board-abc' } } },
		});
		const result = await verifyTrelloWebhookSignature(makeContext({}), body);
		expect(result).toEqual({ valid: false, reason: 'Missing signature header' });
	});

	it('returns null (skip) when no secret configured', async () => {
		vi.mocked(resolveWebhookSecret).mockResolvedValue(null);
		const body = JSON.stringify({
			action: { type: 'createCard', data: { board: { id: 'board-abc' } } },
		});
		const result = await verifyTrelloWebhookSignature(makeContext({}), body);
		expect(result).toBeNull();
	});

	it('returns null (skip) when project not found', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({ projects: [] });
		const body = JSON.stringify({
			action: { type: 'createCard', data: { board: { id: 'unknown-board' } } },
		});
		const result = await verifyTrelloWebhookSignature(makeContext({}), body);
		expect(result).toBeNull();
	});

	it('returns null (skip) when board ID is missing from payload', async () => {
		const body = JSON.stringify({ action: { type: 'createCard' } });
		const result = await verifyTrelloWebhookSignature(makeContext({}), body);
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Integration tests: end-to-end via Hono app (mirrors src/router/index.ts wiring)
// ---------------------------------------------------------------------------

describe('router — GitHub webhook signature verification (end-to-end)', () => {
	let app: Hono;

	beforeEach(async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [GITHUB_PROJECT],
		});
		vi.mocked(resolveWebhookSecret).mockResolvedValue(GITHUB_SECRET);

		// Build minimal Hono app that mirrors src/router/index.ts GitHub handler,
		// using the actual production verifyGitHubWebhookSignature function.
		const { createWebhookHandler, parseGitHubPayload } = await import(
			'../../../src/webhook/webhookHandlers.js'
		);

		app = new Hono();
		app.post(
			'/github/webhook',
			createWebhookHandler({
				source: 'github',
				parsePayload: parseGitHubPayload,
				verifySignature: verifyGitHubWebhookSignature,
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
// Integration tests: end-to-end via Hono app — Trello
// ---------------------------------------------------------------------------

describe('router — Trello webhook signature verification (end-to-end)', () => {
	let app: Hono;

	beforeEach(async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [TRELLO_PROJECT],
		});
		vi.mocked(resolveWebhookSecret).mockResolvedValue(TRELLO_SECRET);

		const { createWebhookHandler, parseTrelloPayload } = await import(
			'../../../src/webhook/webhookHandlers.js'
		);

		app = new Hono();
		app.post(
			'/trello/webhook',
			createWebhookHandler({
				source: 'trello',
				parsePayload: parseTrelloPayload,
				verifySignature: verifyTrelloWebhookSignature,
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

// ---------------------------------------------------------------------------
// Unit tests: extractJiraProjectKey
// ---------------------------------------------------------------------------

describe('extractJiraProjectKey', () => {
	it('extracts project key from issue.fields.project.key', () => {
		const body = JSON.stringify({
			webhookEvent: 'jira:issue_updated',
			issue: { key: 'PROJ-1', fields: { project: { key: 'PROJ' } } },
		});
		expect(extractJiraProjectKey(body)).toBe('PROJ');
	});

	it('returns undefined when project key is absent', () => {
		const body = JSON.stringify({ webhookEvent: 'jira:issue_updated', issue: { key: 'PROJ-1' } });
		expect(extractJiraProjectKey(body)).toBeUndefined();
	});

	it('returns undefined for invalid JSON', () => {
		expect(extractJiraProjectKey('not json')).toBeUndefined();
	});

	it('returns undefined when issue field is missing', () => {
		const body = JSON.stringify({ webhookEvent: 'jira:issue_updated' });
		expect(extractJiraProjectKey(body)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Unit tests: verifyJiraWebhookSignature (function directly)
// ---------------------------------------------------------------------------

describe('verifyJiraWebhookSignature — direct function tests', () => {
	beforeEach(() => {
		vi.mocked(loadProjectConfig).mockResolvedValue({ projects: [JIRA_PROJECT] });
		vi.mocked(resolveWebhookSecret).mockResolvedValue(JIRA_SECRET);
	});

	function makeContext(headers: Record<string, string> = {}) {
		return {
			req: {
				header: (name: string) => headers[name.toLowerCase()] ?? headers[name],
			},
		} as unknown as import('hono').Context;
	}

	function buildJiraBody(projectKey = 'PROJ') {
		return JSON.stringify({
			webhookEvent: 'jira:issue_updated',
			issue: { key: `${projectKey}-1`, fields: { project: { key: projectKey } } },
		});
	}

	it('returns { valid: true } when signature is correct', async () => {
		const body = buildJiraBody();
		const sig = jiraSignature(body, JIRA_SECRET);
		const result = await verifyJiraWebhookSignature(makeContext({ 'X-Hub-Signature': sig }), body);
		expect(result).toEqual({ valid: true, reason: 'Signature valid' });
	});

	it('returns { valid: false } when signature is wrong', async () => {
		const body = buildJiraBody();
		const badSig = jiraSignature(body, 'wrong-secret');
		const result = await verifyJiraWebhookSignature(
			makeContext({ 'X-Hub-Signature': badSig }),
			body,
		);
		expect(result).toEqual({ valid: false, reason: 'JIRA signature mismatch' });
	});

	it('returns { valid: false, reason: "Missing signature header" } when header absent but secret configured', async () => {
		const body = buildJiraBody();
		const result = await verifyJiraWebhookSignature(makeContext({}), body);
		expect(result).toEqual({ valid: false, reason: 'Missing signature header' });
	});

	it('returns null (skip) when no secret configured', async () => {
		vi.mocked(resolveWebhookSecret).mockResolvedValue(null);
		const body = buildJiraBody();
		const result = await verifyJiraWebhookSignature(makeContext({}), body);
		expect(result).toBeNull();
	});

	it('returns null (skip) when project not found', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({ projects: [] });
		const body = buildJiraBody('UNKNOWN');
		const result = await verifyJiraWebhookSignature(makeContext({}), body);
		expect(result).toBeNull();
	});

	it('returns null (skip) when project key is missing from payload', async () => {
		const body = JSON.stringify({ webhookEvent: 'jira:issue_updated' });
		const result = await verifyJiraWebhookSignature(makeContext({}), body);
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Integration tests: end-to-end via Hono app — JIRA
// ---------------------------------------------------------------------------

describe('router — JIRA webhook signature verification (end-to-end)', () => {
	let app: Hono;

	beforeEach(async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [JIRA_PROJECT],
		});
		vi.mocked(resolveWebhookSecret).mockResolvedValue(JIRA_SECRET);

		const { createWebhookHandler, parseJiraPayload } = await import(
			'../../../src/webhook/webhookHandlers.js'
		);

		app = new Hono();
		app.post(
			'/jira/webhook',
			createWebhookHandler({
				source: 'jira',
				parsePayload: parseJiraPayload,
				verifySignature: verifyJiraWebhookSignature,
				processWebhook: vi.fn().mockResolvedValue({
					processed: true,
					projectId: 'proj-jira',
					decisionReason: 'matched',
				}),
			}),
		);
	});

	function buildJiraPayload(projectKey = 'PROJ') {
		return JSON.stringify({
			webhookEvent: 'jira:issue_updated',
			issue: { key: `${projectKey}-1`, fields: { project: { key: projectKey } } },
		});
	}

	async function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
		return app.fetch(
			new Request('http://localhost/jira/webhook', {
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
		const body = buildJiraPayload();
		const sig = jiraSignature(body, JIRA_SECRET);
		const res = await post(body, { 'X-Hub-Signature': sig });
		expect(res.status).toBe(200);
	});

	it('returns 401 when signature is invalid (wrong secret)', async () => {
		const body = buildJiraPayload();
		const badSig = jiraSignature(body, 'wrong-secret');
		const res = await post(body, { 'X-Hub-Signature': badSig });
		expect(res.status).toBe(401);
	});

	it('returns 401 when signature header is missing but secret IS configured', async () => {
		const body = buildJiraPayload();
		const res = await post(body);
		expect(res.status).toBe(401);
	});

	it('returns 200 (skip verification) when no webhook secret is configured', async () => {
		vi.mocked(resolveWebhookSecret).mockResolvedValue(null);
		const body = buildJiraPayload();
		const res = await post(body);
		expect(res.status).toBe(200);
	});

	it('returns 200 (skip verification) when project is not found', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({ projects: [] });
		const body = buildJiraPayload('UNKNOWN');
		const res = await post(body);
		expect(res.status).toBe(200);
	});

	it('returns 200 (skip verification) when project key is missing from payload', async () => {
		const body = JSON.stringify({ webhookEvent: 'jira:issue_updated' });
		const res = await post(body);
		expect(res.status).toBe(200);
	});

	it('logs decision reason to webhook_logs on 401', async () => {
		const { logWebhookCall } = await import('../../../src/utils/webhookLogger.js');
		const body = buildJiraPayload();
		const badSig = jiraSignature(body, 'wrong-secret');
		await post(body, { 'X-Hub-Signature': badSig });
		expect(logWebhookCall).toHaveBeenCalledWith(
			expect.objectContaining({
				statusCode: 401,
				processed: false,
				decisionReason: 'JIRA signature mismatch',
			}),
		);
	});

	it('logs Missing signature header reason when header absent but secret configured', async () => {
		const { logWebhookCall } = await import('../../../src/utils/webhookLogger.js');
		const body = buildJiraPayload();
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
// Unit tests: createWebhookVerifier factory
// ---------------------------------------------------------------------------

describe('createWebhookVerifier factory', () => {
	const PROJECT = { id: 'proj-factory', repo: 'owner/factory-repo' };
	const SECRET = 'factory-test-secret';
	const IDENTIFIER = 'factory-id';
	const HEADER_NAME = 'X-Test-Signature';

	function makeContext(headers: Record<string, string> = {}, params: Record<string, string> = {}) {
		return {
			req: {
				header: (name: string) => headers[name.toLowerCase()] ?? headers[name],
				param: (name: string) => params[name],
			},
		} as unknown as import('hono').Context;
	}

	const mockVerify = vi.fn<[string, string, string], boolean>();
	const mockExtract = vi.fn<[import('hono').Context, string], string | undefined>();
	const mockFind = vi.fn<[string, Array<Record<string, unknown>>], { id: string } | undefined>();

	const verifier = createWebhookVerifier({
		headerName: HEADER_NAME,
		platform: 'test-platform',
		platformLabel: 'TestPlatform',
		extractIdentifier: mockExtract,
		findProject: mockFind,
		verify: mockVerify,
	});

	beforeEach(() => {
		vi.mocked(loadProjectConfig).mockResolvedValue({ projects: [PROJECT] });
		vi.mocked(resolveWebhookSecret).mockResolvedValue(SECRET);
		mockExtract.mockReturnValue(IDENTIFIER);
		mockFind.mockReturnValue(PROJECT);
		mockVerify.mockReturnValue(true);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('returns { valid: true } when all conditions are met and verify returns true', async () => {
		const result = await verifier(makeContext({ [HEADER_NAME]: 'valid-sig' }), 'body');
		expect(result).toEqual({ valid: true, reason: 'Signature valid' });
		expect(mockVerify).toHaveBeenCalledWith('body', 'valid-sig', SECRET, expect.anything());
	});

	it('returns { valid: false, reason: "TestPlatform signature mismatch" } when verify returns false', async () => {
		mockVerify.mockReturnValue(false);
		const result = await verifier(makeContext({ [HEADER_NAME]: 'bad-sig' }), 'body');
		expect(result).toEqual({ valid: false, reason: 'TestPlatform signature mismatch' });
	});

	it('returns null when extractIdentifier returns undefined', async () => {
		mockExtract.mockReturnValue(undefined);
		const result = await verifier(makeContext({ [HEADER_NAME]: 'sig' }), 'body');
		expect(result).toBeNull();
	});

	it('returns null when findProject returns undefined (no matching project)', async () => {
		mockFind.mockReturnValue(undefined);
		const result = await verifier(makeContext({ [HEADER_NAME]: 'sig' }), 'body');
		expect(result).toBeNull();
	});

	it('returns null when resolveWebhookSecret returns null (no secret configured)', async () => {
		vi.mocked(resolveWebhookSecret).mockResolvedValue(null);
		const result = await verifier(makeContext({ [HEADER_NAME]: 'sig' }), 'body');
		expect(result).toBeNull();
	});

	it('returns { valid: false, reason: "Missing signature header" } when header is absent but secret is set', async () => {
		const result = await verifier(makeContext({}), 'body');
		expect(result).toEqual({ valid: false, reason: 'Missing signature header' });
	});

	it('passes the Hono context to the verify function (needed for Trello callback URL)', async () => {
		const ctx = makeContext({ [HEADER_NAME]: 'sig' });
		await verifier(ctx, 'body');
		// The 4th argument to verify should be the Hono context object
		expect(mockVerify).toHaveBeenCalledWith('body', 'sig', SECRET, ctx);
	});

	it('passes the Hono context to extractIdentifier', async () => {
		const ctx = makeContext({ [HEADER_NAME]: 'sig' });
		await verifier(ctx, 'body');
		expect(mockExtract).toHaveBeenCalledWith(ctx, 'body');
	});

	it('passes the extracted identifier and projects array to findProject', async () => {
		await verifier(makeContext({ [HEADER_NAME]: 'sig' }), 'body');
		expect(mockFind).toHaveBeenCalledWith(IDENTIFIER, expect.any(Array));
	});
});
