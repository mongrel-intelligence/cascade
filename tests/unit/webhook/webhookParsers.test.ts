import { describe, expect, it, vi } from 'vitest';

const { mockParseGitHubWebhookPayload, mockLogger } = vi.hoisted(() => ({
	mockParseGitHubWebhookPayload: vi.fn(),
	mockLogger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../src/router/webhookParsing.js', () => ({
	parseGitHubWebhookPayload: mockParseGitHubWebhookPayload,
}));

vi.mock('../../../src/utils/index.js', () => ({
	logger: mockLogger,
}));

import {
	parseGitHubPayload,
	parseJiraPayload,
	parseTrelloPayload,
} from '../../../src/webhook/webhookParsers.js';

function makeHonoContext(body: unknown, headers: Record<string, string> = {}) {
	const rawBody = JSON.stringify(body);
	return {
		req: {
			json: vi.fn().mockResolvedValue(body),
			text: vi.fn().mockResolvedValue(rawBody),
			header: vi.fn((name: string) => headers[name] ?? ''),
		},
	};
}

describe('parseTrelloPayload', () => {
	it('returns ok=true with payload and eventType extracted from action.type', async () => {
		const payload = {
			action: { type: 'commentCard', data: {} },
			model: { id: 'board-1' },
		};
		const ctx = makeHonoContext(payload);

		const result = await parseTrelloPayload(ctx as never);

		expect(result.ok).toBe(true);
		expect(result.payload).toEqual(payload);
		expect(result.eventType).toBe('commentCard');
	});

	it('returns undefined eventType when action is missing', async () => {
		const payload = { model: { id: 'board-1' } };
		const ctx = makeHonoContext(payload);

		const result = await parseTrelloPayload(ctx as never);

		expect(result.ok).toBe(true);
		expect(result.eventType).toBeUndefined();
	});

	it('returns ok=false and error string on parse failure', async () => {
		const ctx = {
			req: {
				text: vi.fn().mockResolvedValue('not valid json {{{'),
				header: vi.fn(),
			},
		};

		const result = await parseTrelloPayload(ctx as never);

		expect(result.ok).toBe(false);
		expect(result.error).toBeDefined();
	});

	it('logs debug message with action type on success', async () => {
		const payload = { action: { type: 'updateCard' } };
		const ctx = makeHonoContext(payload);

		await parseTrelloPayload(ctx as never);

		expect(mockLogger.debug).toHaveBeenCalledWith('Received Trello webhook', {
			action: 'updateCard',
		});
	});
});

describe('parseGitHubPayload', () => {
	it('extracts event type from X-GitHub-Event header', async () => {
		const payload = { action: 'opened', repository: { full_name: 'owner/repo' } };
		mockParseGitHubWebhookPayload.mockResolvedValue({ ok: true, payload });
		const ctx = makeHonoContext(payload, {
			'X-GitHub-Event': 'pull_request',
			'Content-Type': 'application/json',
		});

		const result = await parseGitHubPayload(ctx as never);

		expect(result.ok).toBe(true);
		expect(result.eventType).toBe('pull_request');
		expect(result.payload).toEqual(payload);
	});

	it('defaults to "unknown" eventType when X-GitHub-Event header is absent', async () => {
		const payload = { action: 'opened' };
		mockParseGitHubWebhookPayload.mockResolvedValue({ ok: true, payload });
		const ctx = makeHonoContext(payload, { 'Content-Type': 'application/json' });

		const result = await parseGitHubPayload(ctx as never);

		expect(result.ok).toBe(true);
		expect(result.eventType).toBe('unknown');
	});

	it('returns ok=false when parseGitHubWebhookPayload fails', async () => {
		mockParseGitHubWebhookPayload.mockResolvedValue({
			ok: false,
			error: 'Bad signature',
		});
		const ctx = makeHonoContext(
			{},
			{ 'X-GitHub-Event': 'push', 'Content-Type': 'application/json' },
		);

		const result = await parseGitHubPayload(ctx as never);

		expect(result.ok).toBe(false);
		expect(result.error).toBe('Bad signature');
		expect(result.eventType).toBe('push');
	});

	it('logs error when parsing fails', async () => {
		mockParseGitHubWebhookPayload.mockResolvedValue({
			ok: false,
			error: 'Signature mismatch',
		});
		const ctx = makeHonoContext(
			{},
			{ 'X-GitHub-Event': 'push', 'Content-Type': 'application/json' },
		);

		await parseGitHubPayload(ctx as never);

		expect(mockLogger.error).toHaveBeenCalledWith(
			'Failed to parse GitHub webhook',
			expect.objectContaining({ error: 'Signature mismatch' }),
		);
	});

	it('logs info with event and repository on success', async () => {
		const payload = { action: 'opened', repository: { full_name: 'owner/repo' } };
		mockParseGitHubWebhookPayload.mockResolvedValue({ ok: true, payload });
		const ctx = makeHonoContext(payload, {
			'X-GitHub-Event': 'pull_request',
			'Content-Type': 'application/json',
		});

		await parseGitHubPayload(ctx as never);

		expect(mockLogger.info).toHaveBeenCalledWith(
			'Received GitHub webhook',
			expect.objectContaining({ event: 'pull_request', action: 'opened' }),
		);
	});
});

describe('parseJiraPayload', () => {
	it('extracts webhookEvent as eventType', async () => {
		const payload = {
			webhookEvent: 'comment_created',
			issue: { key: 'PROJ-123' },
		};
		const ctx = makeHonoContext(payload);

		const result = await parseJiraPayload(ctx as never);

		expect(result.ok).toBe(true);
		expect(result.eventType).toBe('comment_created');
		expect(result.payload).toEqual(payload);
	});

	it('returns undefined eventType when webhookEvent is absent', async () => {
		const payload = { issue: { key: 'PROJ-1' } };
		const ctx = makeHonoContext(payload);

		const result = await parseJiraPayload(ctx as never);

		expect(result.ok).toBe(true);
		expect(result.eventType).toBeUndefined();
	});

	it('returns ok=false and error string on parse failure', async () => {
		const ctx = {
			req: {
				text: vi.fn().mockResolvedValue('not valid json {{{'),
				header: vi.fn(),
			},
		};

		const result = await parseJiraPayload(ctx as never);

		expect(result.ok).toBe(false);
		expect(result.error).toBeDefined();
	});

	it('logs info with event and issue key', async () => {
		const payload = { webhookEvent: 'comment_created', issue: { key: 'PROJ-42' } };
		const ctx = makeHonoContext(payload);

		await parseJiraPayload(ctx as never);

		expect(mockLogger.info).toHaveBeenCalledWith(
			'Received JIRA webhook',
			expect.objectContaining({ event: 'comment_created' }),
		);
	});
});
