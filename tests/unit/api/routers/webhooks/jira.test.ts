import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the shared JIRA REST host resolver so we can assert which base URL each
// webhook function routes through, without importing the heavy jira.js client
// or hitting the /_edge/tenant_info cloudId flow.
const { mockResolveJiraApiBaseUrl, mockFetch } = vi.hoisted(() => ({
	mockResolveJiraApiBaseUrl: vi.fn(),
	mockFetch: vi.fn(),
}));

vi.mock('../../../../../src/jira/api-host.js', () => ({
	resolveJiraApiBaseUrl: mockResolveJiraApiBaseUrl,
}));

vi.mock('../../../../../src/utils/logging.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.stubGlobal('fetch', mockFetch);

import {
	jiraCreateWebhook,
	jiraDeleteWebhook,
	jiraEnsureLabels,
	jiraListWebhooks,
} from '../../../../../src/api/routers/webhooks/jira.js';
import type { ProjectContext } from '../../../../../src/api/routers/webhooks/types.js';

const SITE = 'https://acme.atlassian.net';
const GATEWAY = 'https://api.atlassian.com/ex/jira/cloud-abc-123';
const CALLBACK = 'https://cascade.example.com/jira/webhook';

function jiraCtx(overrides: Partial<ProjectContext> = {}): ProjectContext {
	return {
		projectId: 'proj-1',
		orgId: 'org-1',
		pmType: 'jira',
		jiraBaseUrl: SITE,
		jiraProjectKey: 'PROJ',
		jiraAuthType: 'scoped',
		jiraEmail: 'bot@example.com',
		jiraApiToken: 'jira-token',
		jiraLabels: ['cascade-processing', 'cascade-auto'],
		trelloApiKey: '',
		trelloToken: '',
		githubToken: '',
		...overrides,
	};
}

const expectedAuth = `Basic ${Buffer.from('bot@example.com:jira-token').toString('base64')}`;

describe('webhooks/jira REST host routing', () => {
	beforeEach(() => {
		mockResolveJiraApiBaseUrl.mockResolvedValue(GATEWAY);
	});

	describe('jiraListWebhooks', () => {
		it('routes the GET through the resolved gateway base under a scoped token', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ values: [{ id: 1, url: CALLBACK }] }),
			});

			const result = await jiraListWebhooks(jiraCtx());

			// The credentials bag forwarded to the resolver carries the scoped authType.
			expect(mockResolveJiraApiBaseUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					baseUrl: SITE,
					authType: 'scoped',
					email: 'bot@example.com',
					apiToken: 'jira-token',
				}),
			);
			expect(mockFetch).toHaveBeenCalledWith(
				`${GATEWAY}/rest/api/3/webhook`,
				expect.objectContaining({
					headers: expect.objectContaining({ Authorization: expectedAuth }),
				}),
			);
			expect(result).toEqual([{ id: 1, url: CALLBACK }]);
		});

		it('routes the GET through the site base URL when authType is basic', async () => {
			mockResolveJiraApiBaseUrl.mockResolvedValue(SITE);
			mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ values: [] }) });

			await jiraListWebhooks(jiraCtx({ jiraAuthType: 'basic' }));

			expect(mockFetch).toHaveBeenCalledWith(`${SITE}/rest/api/3/webhook`, expect.anything());
		});

		it('returns [] without resolving a host when credentials are missing', async () => {
			const result = await jiraListWebhooks(jiraCtx({ jiraApiToken: undefined }));

			expect(result).toEqual([]);
			expect(mockResolveJiraApiBaseUrl).not.toHaveBeenCalled();
			expect(mockFetch).not.toHaveBeenCalled();
		});
	});

	describe('jiraCreateWebhook', () => {
		it('routes the POST through the resolved gateway base', async () => {
			mockFetch
				.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ values: [] }) }) // dedup list
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ id: 100, url: CALLBACK }),
				}); // POST

			const result = await jiraCreateWebhook(jiraCtx(), CALLBACK);

			expect(mockFetch).toHaveBeenLastCalledWith(
				`${GATEWAY}/rest/api/3/webhook`,
				expect.objectContaining({ method: 'POST' }),
			);
			expect(result).toMatchObject({ id: 100 });
		});

		it('surfaces a friendly scope / manual-registration message on 403', async () => {
			mockFetch
				.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ values: [] }) }) // dedup list
				.mockResolvedValueOnce({
					ok: false,
					status: 403,
					text: () => Promise.resolve('Unauthorized; scope does not match'),
				});

			const err = await jiraCreateWebhook(jiraCtx(), CALLBACK).catch((e) => e);

			expect(err).toBeInstanceOf(TRPCError);
			expect(err.code).toBe('FORBIDDEN');
			expect(err.message).toContain('403');
			expect(err.message).toContain('manage:jira-webhook');
			expect(err.message).toContain('write:webhook:jira');
			expect(err.message).toMatch(/register the webhook manually/i);
			expect(err.message).toContain(CALLBACK);
			// Site URL (not the gateway) is offered as the manual-registration target.
			expect(err.message).toContain(SITE);
			// The raw JIRA response is preserved for diagnostics.
			expect(err.message).toContain('Unauthorized; scope does not match');
		});

		it('surfaces the same friendly message on 401 (scope does not match)', async () => {
			mockFetch
				.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ values: [] }) }) // dedup list
				.mockResolvedValueOnce({
					ok: false,
					status: 401,
					text: () => Promise.resolve('Unauthorized; scope does not match'),
				});

			const err = await jiraCreateWebhook(jiraCtx(), CALLBACK).catch((e) => e);

			expect(err).toBeInstanceOf(TRPCError);
			expect(err.code).toBe('FORBIDDEN');
			expect(err.message).toContain('401');
			expect(err.message).toContain('manage:jira-webhook');
		});

		it('keeps the generic error for non-permission failures', async () => {
			mockFetch
				.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ values: [] }) }) // dedup list
				.mockResolvedValueOnce({
					ok: false,
					status: 500,
					text: () => Promise.resolve('boom'),
				});

			const err = await jiraCreateWebhook(jiraCtx(), CALLBACK).catch((e) => e);

			expect(err).toBeInstanceOf(TRPCError);
			expect(err.code).toBe('INTERNAL_SERVER_ERROR');
			expect(err.message).toContain('Failed to create JIRA webhook: 500');
			expect(err.message).not.toContain('manage:jira-webhook');
		});

		it('still attempts the create (and surfaces its error) when dedup listing is denied', async () => {
			// GET /webhook rejected (scope-restricted token) -> jiraListWebhooks throws.
			// The create must still be attempted so its actionable error surfaces.
			mockFetch
				.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) }) // dedup list denied
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ id: 101, url: CALLBACK }),
				}); // POST

			const result = await jiraCreateWebhook(jiraCtx(), CALLBACK);

			expect(result).toMatchObject({ id: 101 });
			// Two fetches: the failed dedup list + the successful create.
			expect(mockFetch).toHaveBeenCalledTimes(2);
			expect(mockFetch).toHaveBeenLastCalledWith(
				`${GATEWAY}/rest/api/3/webhook`,
				expect.objectContaining({ method: 'POST' }),
			);
		});

		it('throws BAD_REQUEST without resolving a host when credentials are missing', async () => {
			const err = await jiraCreateWebhook(jiraCtx({ jiraEmail: undefined }), CALLBACK).catch(
				(e) => e,
			);

			expect(err).toBeInstanceOf(TRPCError);
			expect(err.code).toBe('BAD_REQUEST');
			expect(mockResolveJiraApiBaseUrl).not.toHaveBeenCalled();
		});
	});

	describe('jiraDeleteWebhook', () => {
		it('routes the DELETE through the resolved gateway base', async () => {
			mockFetch.mockResolvedValue({ ok: true });

			await jiraDeleteWebhook(jiraCtx(), 55);

			expect(mockFetch).toHaveBeenCalledWith(
				`${GATEWAY}/rest/api/3/webhook`,
				expect.objectContaining({ method: 'DELETE' }),
			);
		});
	});

	describe('jiraEnsureLabels', () => {
		it('routes the search and issue label mutations through the resolved gateway base', async () => {
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({ issues: [{ key: 'PROJ-1', fields: { labels: ['keep'] } }] }),
				}) // JQL search
				.mockResolvedValueOnce({ ok: true }) // add labels
				.mockResolvedValueOnce({ ok: true }); // restore labels

			const result = await jiraEnsureLabels(jiraCtx());

			expect(mockFetch.mock.calls[0][0]).toContain(`${GATEWAY}/rest/api/3/search`);
			expect(mockFetch.mock.calls[1][0]).toBe(`${GATEWAY}/rest/api/3/issue/PROJ-1`);
			expect(mockFetch.mock.calls[2][0]).toBe(`${GATEWAY}/rest/api/3/issue/PROJ-1`);
			expect(result).toEqual(['cascade-processing', 'cascade-auto']);
		});

		it('returns [] without resolving a host when the project key is missing', async () => {
			const result = await jiraEnsureLabels(jiraCtx({ jiraProjectKey: undefined }));

			expect(result).toEqual([]);
			expect(mockResolveJiraApiBaseUrl).not.toHaveBeenCalled();
			expect(mockFetch).not.toHaveBeenCalled();
		});
	});
});
