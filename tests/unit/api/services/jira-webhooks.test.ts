import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JiraWebhookManager } from '../../../../src/api/services/jira-webhooks.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const baseCtx = {
	jiraBaseUrl: 'https://test.atlassian.net',
	jiraEmail: 'bot@example.com',
	jiraApiToken: 'token-123',
	jiraProjectKey: 'PROJ',
	jiraLabels: ['cascade-processing', 'cascade-processed', 'cascade-error', 'cascade-ready'],
};

describe('JiraWebhookManager', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('list', () => {
		it('returns webhook values from JIRA response', async () => {
			const webhooks = [
				{ id: 1, name: 'cascade-webhook', url: 'http://a', events: [], enabled: true },
			];
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ values: webhooks }),
			});

			const mgr = new JiraWebhookManager(baseCtx);
			const result = await mgr.list();

			expect(result).toHaveLength(1);
			expect(result[0].id).toBe(1);
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining('/rest/api/3/webhook'),
				expect.objectContaining({
					headers: expect.objectContaining({ Authorization: expect.stringContaining('Basic ') }),
				}),
			);
		});

		it('returns empty array when credentials are missing', async () => {
			const mgr = new JiraWebhookManager({ ...baseCtx, jiraEmail: undefined });
			const result = await mgr.list();
			expect(result).toEqual([]);
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('throws TRPCError when fetch fails', async () => {
			mockFetch.mockResolvedValue({ ok: false, status: 403 });

			const mgr = new JiraWebhookManager(baseCtx);
			await expect(mgr.list()).rejects.toMatchObject({
				code: 'INTERNAL_SERVER_ERROR',
				message: expect.stringContaining('403'),
			});
		});
	});

	describe('create', () => {
		it('creates a webhook with correct event types', async () => {
			const created = {
				id: 100,
				name: 'cascade-webhook',
				url: 'http://example.com/jira/webhook',
				events: ['jira:issue_created'],
				enabled: true,
			};
			mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(created) });

			const mgr = new JiraWebhookManager(baseCtx);
			const result = await mgr.create('http://example.com/jira/webhook');

			expect(result.id).toBe(100);
			const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
			expect(body.webhooks[0].events).toContain('jira:issue_created');
			expect(body.webhooks[0].events).toContain('comment_created');
		});

		it('throws BAD_REQUEST when credentials are missing', async () => {
			const mgr = new JiraWebhookManager({ ...baseCtx, jiraEmail: undefined });
			await expect(mgr.create('http://example.com/jira/webhook')).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});

		it('throws TRPCError on non-ok fetch', async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 400,
				text: () => Promise.resolve('invalid jql'),
			});

			const mgr = new JiraWebhookManager(baseCtx);
			await expect(mgr.create('http://example.com/jira/webhook')).rejects.toMatchObject({
				code: 'INTERNAL_SERVER_ERROR',
				message: expect.stringContaining('400'),
			});
		});
	});

	describe('delete', () => {
		it('deletes a webhook by id', async () => {
			mockFetch.mockResolvedValue({ ok: true });

			const mgr = new JiraWebhookManager(baseCtx);
			await expect(mgr.delete(42)).resolves.toBeUndefined();

			const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
			expect(body.webhookIds).toContain(42);
		});

		it('returns without calling fetch when credentials missing', async () => {
			const mgr = new JiraWebhookManager({ ...baseCtx, jiraBaseUrl: undefined });
			await expect(mgr.delete(42)).resolves.toBeUndefined();
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('throws TRPCError on non-ok fetch', async () => {
			mockFetch.mockResolvedValue({ ok: false, status: 404 });

			const mgr = new JiraWebhookManager(baseCtx);
			await expect(mgr.delete(42)).rejects.toMatchObject({
				code: 'INTERNAL_SERVER_ERROR',
				message: expect.stringContaining('42'),
			});
		});
	});

	describe('ensureLabels', () => {
		it('seeds labels into an issue and restores original labels', async () => {
			mockFetch
				// JQL search
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							issues: [{ key: 'PROJ-1', fields: { labels: ['existing'] } }],
						}),
				})
				// add labels
				.mockResolvedValueOnce({ ok: true })
				// restore labels
				.mockResolvedValueOnce({ ok: true });

			const mgr = new JiraWebhookManager(baseCtx);
			const result = await mgr.ensureLabels();

			expect(result).toEqual(baseCtx.jiraLabels);
			expect(mockFetch).toHaveBeenCalledTimes(3);

			// Add call includes existing + new labels
			const addBody = JSON.parse(mockFetch.mock.calls[1][1].body as string);
			expect(addBody.fields.labels).toContain('existing');
			expect(addBody.fields.labels).toContain('cascade-processing');

			// Restore call puts back only original labels
			const restoreBody = JSON.parse(mockFetch.mock.calls[2][1].body as string);
			expect(restoreBody.fields.labels).toEqual(['existing']);
		});

		it('returns all labels when they already exist in JIRA', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						issues: [
							{
								key: 'PROJ-1',
								fields: {
									labels: [
										'cascade-processing',
										'cascade-processed',
										'cascade-error',
										'cascade-ready',
									],
								},
							},
						],
					}),
			});

			const mgr = new JiraWebhookManager(baseCtx);
			const result = await mgr.ensureLabels();

			expect(result).toEqual(baseCtx.jiraLabels);
			// Only the search call, no add/restore
			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it('returns empty array when no issues in project', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ issues: [] }),
			});

			const mgr = new JiraWebhookManager(baseCtx);
			const result = await mgr.ensureLabels();

			expect(result).toEqual([]);
			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it('returns empty array when credentials are missing', async () => {
			const mgr = new JiraWebhookManager({ ...baseCtx, jiraProjectKey: undefined });
			const result = await mgr.ensureLabels();
			expect(result).toEqual([]);
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('returns empty array when labels list is empty', async () => {
			const mgr = new JiraWebhookManager({ ...baseCtx, jiraLabels: [] });
			const result = await mgr.ensureLabels();
			expect(result).toEqual([]);
			expect(mockFetch).not.toHaveBeenCalled();
		});
	});
});
