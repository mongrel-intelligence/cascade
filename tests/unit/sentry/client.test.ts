import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSentryClient } from '../../../src/sentry/client.js';

describe('sentry/client', () => {
	describe('getSentryClient factory', () => {
		it('throws when SENTRY_API_TOKEN is not set', () => {
			vi.stubEnv('SENTRY_API_TOKEN', '');

			expect(() => getSentryClient()).toThrow('SENTRY_API_TOKEN environment variable is not set');
		});

		it('throws with empty SENTRY_API_TOKEN', () => {
			vi.stubEnv('SENTRY_API_TOKEN', '');

			expect(() => getSentryClient()).toThrow('SENTRY_API_TOKEN environment variable is not set');
		});

		it('returns a client when SENTRY_API_TOKEN is set', () => {
			vi.stubEnv('SENTRY_API_TOKEN', 'test-token-123');

			const client = getSentryClient();

			expect(client).toBeDefined();
			expect(typeof client.getIssue).toBe('function');
			expect(typeof client.getIssueEvent).toBe('function');
			expect(typeof client.listIssueEvents).toBe('function');
		});
	});

	describe('getIssue', () => {
		let mockFetch: ReturnType<typeof vi.fn>;

		beforeEach(() => {
			vi.stubEnv('SENTRY_API_TOKEN', 'test-token');
			mockFetch = vi.fn();
			vi.stubGlobal('fetch', mockFetch);
		});

		it('makes GET request to correct URL', async () => {
			const mockIssue = { id: 'issue-1', title: 'TypeError', status: 'unresolved' };
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => mockIssue,
			});

			const client = getSentryClient();
			const result = await client.getIssue('my-org', 'issue-1');

			expect(mockFetch).toHaveBeenCalledWith(
				'https://sentry.io/api/0/organizations/my-org/issues/issue-1/',
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: 'Bearer test-token',
						'Content-Type': 'application/json',
					}),
				}),
			);
			expect(result).toEqual(mockIssue);
		});

		it('encodes organization slug in URL', async () => {
			const mockIssue = { id: 'issue-1', title: 'Error' };
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => mockIssue,
			});

			const client = getSentryClient();
			await client.getIssue('my org/company', 'issue-1');

			const calledUrl = mockFetch.mock.calls[0][0] as string;
			expect(calledUrl).toContain('my%20org%2Fcompany');
		});

		it('encodes issue id in URL', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: 'issue with spaces' }),
			});

			const client = getSentryClient();
			await client.getIssue('my-org', 'issue with spaces');

			const calledUrl = mockFetch.mock.calls[0][0] as string;
			expect(calledUrl).toContain('issue%20with%20spaces');
		});

		it('throws on non-OK response with status and body', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 403,
				text: async () => 'Forbidden',
			});

			const client = getSentryClient();
			await expect(client.getIssue('my-org', 'issue-1')).rejects.toThrow(
				'Sentry API error 403: Forbidden',
			);
		});

		it('throws on 404 not found', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 404,
				text: async () => 'Not Found',
			});

			const client = getSentryClient();
			await expect(client.getIssue('my-org', 'nonexistent')).rejects.toThrow(
				'Sentry API error 404',
			);
		});

		it('handles empty error body gracefully', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 500,
				text: async () => {
					throw new Error('failed to read body');
				},
			});

			const client = getSentryClient();
			await expect(client.getIssue('my-org', 'issue-1')).rejects.toThrow('Sentry API error 500: ');
		});
	});

	describe('getIssueEvent', () => {
		let mockFetch: ReturnType<typeof vi.fn>;

		beforeEach(() => {
			vi.stubEnv('SENTRY_API_TOKEN', 'test-token');
			mockFetch = vi.fn();
			vi.stubGlobal('fetch', mockFetch);
		});

		it('uses "latest" as default eventId', async () => {
			const mockEvent = { id: 'evt-1', type: 'error' };
			mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockEvent });

			const client = getSentryClient();
			await client.getIssueEvent('my-org', 'issue-1');

			const calledUrl = mockFetch.mock.calls[0][0] as string;
			expect(calledUrl).toContain('/events/latest/');
		});

		it('uses custom eventId when provided', async () => {
			const mockEvent = { id: 'evt-specific', type: 'error' };
			mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockEvent });

			const client = getSentryClient();
			await client.getIssueEvent('my-org', 'issue-1', 'oldest');

			const calledUrl = mockFetch.mock.calls[0][0] as string;
			expect(calledUrl).toContain('/events/oldest/');
		});

		it('uses recommended as eventId', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: 'evt-rec' }),
			});

			const client = getSentryClient();
			await client.getIssueEvent('my-org', 'issue-1', 'recommended');

			const calledUrl = mockFetch.mock.calls[0][0] as string;
			expect(calledUrl).toContain('/events/recommended/');
		});

		it('constructs correct URL structure', async () => {
			mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

			const client = getSentryClient();
			await client.getIssueEvent('test-org', 'issue-42', 'latest');

			expect(mockFetch).toHaveBeenCalledWith(
				'https://sentry.io/api/0/organizations/test-org/issues/issue-42/events/latest/',
				expect.anything(),
			);
		});

		it('throws on error response', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				text: async () => 'Unauthorized',
			});

			const client = getSentryClient();
			await expect(client.getIssueEvent('my-org', 'issue-1')).rejects.toThrow(
				'Sentry API error 401',
			);
		});
	});

	describe('listIssueEvents', () => {
		let mockFetch: ReturnType<typeof vi.fn>;

		beforeEach(() => {
			vi.stubEnv('SENTRY_API_TOKEN', 'test-token');
			mockFetch = vi.fn();
			vi.stubGlobal('fetch', mockFetch);
		});

		it('calls correct base URL without options', async () => {
			const mockEvents = [{ id: 'evt-1' }, { id: 'evt-2' }];
			mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockEvents });

			const client = getSentryClient();
			const result = await client.listIssueEvents('my-org', 'issue-1');

			const calledUrl = mockFetch.mock.calls[0][0] as string;
			expect(calledUrl).toContain('/organizations/my-org/issues/issue-1/events/');
			expect(calledUrl).not.toContain('?');
			expect(result).toEqual(mockEvents);
		});

		it('appends limit query param when provided', async () => {
			mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });

			const client = getSentryClient();
			await client.listIssueEvents('my-org', 'issue-1', { limit: 5 });

			const calledUrl = mockFetch.mock.calls[0][0] as string;
			expect(calledUrl).toContain('limit=5');
		});

		it('appends full=true when provided', async () => {
			mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });

			const client = getSentryClient();
			await client.listIssueEvents('my-org', 'issue-1', { full: true });

			const calledUrl = mockFetch.mock.calls[0][0] as string;
			expect(calledUrl).toContain('full=true');
		});

		it('appends both limit and full when provided', async () => {
			mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });

			const client = getSentryClient();
			await client.listIssueEvents('my-org', 'issue-1', { limit: 10, full: true });

			const calledUrl = mockFetch.mock.calls[0][0] as string;
			expect(calledUrl).toContain('limit=10');
			expect(calledUrl).toContain('full=true');
		});

		it('throws on error response', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 429,
				text: async () => 'Too Many Requests',
			});

			const client = getSentryClient();
			await expect(client.listIssueEvents('my-org', 'issue-1')).rejects.toThrow(
				'Sentry API error 429',
			);
		});
	});
});
