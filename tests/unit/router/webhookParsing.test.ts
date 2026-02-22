import type { Context } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import {
	extractRawHeaders,
	parseGitHubWebhookPayload,
} from '../../../src/router/webhookParsing.js';

function makeContext(
	overrides: Partial<{
		json: () => Promise<unknown>;
		parseBody: () => Promise<Record<string, unknown>>;
		header: () => Record<string, string>;
	}> = {},
): Context {
	return {
		req: {
			json: overrides.json ?? vi.fn().mockResolvedValue({ event: 'push' }),
			parseBody: overrides.parseBody ?? vi.fn().mockResolvedValue({}),
			header:
				overrides.header ??
				vi.fn().mockReturnValue({ 'content-type': 'application/json', 'x-github-event': 'push' }),
		},
	} as unknown as Context;
}

describe('parseGitHubWebhookPayload', () => {
	it('parses JSON body', async () => {
		const ctx = makeContext({ json: vi.fn().mockResolvedValue({ action: 'opened' }) });
		const result = await parseGitHubWebhookPayload(ctx, 'application/json');
		expect(result).toEqual({ ok: true, payload: { action: 'opened' } });
	});

	it('parses form-urlencoded body with payload field', async () => {
		const payloadObj = { action: 'opened' };
		const ctx = makeContext({
			parseBody: vi.fn().mockResolvedValue({ payload: JSON.stringify(payloadObj) }),
		});
		const result = await parseGitHubWebhookPayload(ctx, 'application/x-www-form-urlencoded');
		expect(result).toEqual({ ok: true, payload: payloadObj });
	});

	it('returns error when form-urlencoded missing payload field', async () => {
		const ctx = makeContext({
			parseBody: vi.fn().mockResolvedValue({}),
		});
		const result = await parseGitHubWebhookPayload(ctx, 'application/x-www-form-urlencoded');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('Missing payload field');
		}
	});

	it('returns error when JSON parsing fails', async () => {
		const ctx = makeContext({
			json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
		});
		const result = await parseGitHubWebhookPayload(ctx, 'application/json');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('Invalid JSON');
		}
	});
});

describe('extractRawHeaders', () => {
	it('converts headers to plain string record', () => {
		const ctx = makeContext({
			header: vi.fn().mockReturnValue({
				'content-type': 'application/json',
				'x-github-event': 'push',
			}),
		});
		const headers = extractRawHeaders(ctx);
		expect(headers).toEqual({
			'content-type': 'application/json',
			'x-github-event': 'push',
		});
	});

	it('returns empty object for no headers', () => {
		const ctx = makeContext({ header: vi.fn().mockReturnValue({}) });
		const headers = extractRawHeaders(ctx);
		expect(headers).toEqual({});
	});
});
