import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectContext } from '../../../../../src/api/routers/webhooks/types.js';

// --- Shared fetch mock ---
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// --- Octokit mock ---
const mockListWebhooks = vi.fn();
const mockCreateWebhook = vi.fn();
const mockDeleteWebhook = vi.fn();

vi.mock('@octokit/rest', () => ({
	Octokit: vi.fn(() => ({
		repos: {
			listWebhooks: mockListWebhooks,
			createWebhook: mockCreateWebhook,
			deleteWebhook: mockDeleteWebhook,
		},
	})),
}));

vi.mock('../../../../../src/utils/repo.js', () => ({
	parseRepoFullName: (fullName: string) => {
		const slashIdx = fullName.indexOf('/');
		return { owner: fullName.slice(0, slashIdx), repo: fullName.slice(slashIdx + 1) };
	},
}));

import { GitHubWebhookAdapter } from '../../../../../src/api/routers/webhooks/github.js';
import {
	JiraWebhookAdapter,
	jiraEnsureLabels,
} from '../../../../../src/api/routers/webhooks/jira.js';
import { TrelloWebhookAdapter } from '../../../../../src/api/routers/webhooks/trello.js';

const trelloCtx: ProjectContext = {
	projectId: 'proj-1',
	orgId: 'org-1',
	repo: 'owner/repo',
	pmType: 'trello',
	boardId: 'board-123',
	trelloApiKey: 'key',
	trelloToken: 'token',
	githubToken: 'ghp_test',
};

const githubCtx: ProjectContext = {
	projectId: 'proj-1',
	orgId: 'org-1',
	repo: 'owner/repo',
	pmType: 'trello',
	trelloApiKey: '',
	trelloToken: '',
	githubToken: 'ghp_test',
};

const jiraCtx: ProjectContext = {
	projectId: 'proj-1',
	orgId: 'org-1',
	repo: 'owner/repo',
	pmType: 'jira',
	trelloApiKey: '',
	trelloToken: '',
	githubToken: '',
	jiraBaseUrl: 'https://test.atlassian.net',
	jiraEmail: 'bot@example.com',
	jiraApiToken: 'jira-token',
	jiraProjectKey: 'PROJ',
	jiraLabels: ['cascade-processing', 'cascade-processed', 'cascade-error', 'cascade-ready'],
};

const BASE_URL = 'http://example.com';

// ---------------------------------------------------------------------------
// TrelloWebhookAdapter
// ---------------------------------------------------------------------------

describe('TrelloWebhookAdapter', () => {
	const adapter = new TrelloWebhookAdapter();

	beforeEach(() => vi.clearAllMocks());

	it('has type "trello"', () => {
		expect(adapter.type).toBe('trello');
	});

	describe('list', () => {
		it('returns webhooks filtered by boardId', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve([
						{ id: 'tw-1', idModel: 'board-123', callbackURL: 'http://x', active: true },
						{ id: 'tw-2', idModel: 'other-board', callbackURL: 'http://y', active: true },
					]),
			});

			const result = await adapter.list(trelloCtx);
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe('tw-1');
		});

		it('returns empty array when credentials are missing', async () => {
			const ctx = { ...trelloCtx, trelloApiKey: '', trelloToken: '' };
			const result = await adapter.list(ctx);
			expect(result).toEqual([]);
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('throws on HTTP error', async () => {
			mockFetch.mockResolvedValue({ ok: false, status: 401 });
			await expect(adapter.list(trelloCtx)).rejects.toMatchObject({
				code: 'INTERNAL_SERVER_ERROR',
			});
		});
	});

	describe('create', () => {
		it('creates a webhook when no duplicate exists', async () => {
			// list returns empty, then create returns new webhook
			mockFetch
				.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							id: 'tw-new',
							callbackURL: `${BASE_URL}/trello/webhook`,
							idModel: 'board-123',
							active: true,
						}),
				});

			const result = await adapter.create(trelloCtx, BASE_URL);
			expect(result).toMatchObject({ id: 'tw-new' });
		});

		it('returns "Already exists" when duplicate found', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve([
						{
							id: 'tw-existing',
							callbackURL: `${BASE_URL}/trello/webhook`,
							idModel: 'board-123',
							active: true,
						},
					]),
			});

			const result = await adapter.create(trelloCtx, BASE_URL);
			expect(result).toBe('Already exists: tw-existing');
		});

		it('returns undefined when credentials are missing', async () => {
			const ctx = { ...trelloCtx, trelloApiKey: '' };
			const result = await adapter.create(ctx, BASE_URL);
			expect(result).toBeUndefined();
			expect(mockFetch).not.toHaveBeenCalled();
		});
	});

	describe('delete', () => {
		it('deletes matching webhooks and returns their IDs', async () => {
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve([
							{
								id: 'tw-1',
								callbackURL: `${BASE_URL}/trello/webhook`,
								idModel: 'board-123',
								active: true,
							},
						]),
				})
				.mockResolvedValueOnce({ ok: true });

			const result = await adapter.delete(trelloCtx, BASE_URL);
			expect(result).toEqual(['tw-1']);
		});

		it('returns empty array when no matching webhooks', async () => {
			mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });

			const result = await adapter.delete(trelloCtx, BASE_URL);
			expect(result).toEqual([]);
		});
	});
});

// ---------------------------------------------------------------------------
// GitHubWebhookAdapter
// ---------------------------------------------------------------------------

describe('GitHubWebhookAdapter', () => {
	const adapter = new GitHubWebhookAdapter();

	beforeEach(() => vi.clearAllMocks());

	it('has type "github"', () => {
		expect(adapter.type).toBe('github');
	});

	describe('list', () => {
		it('returns github webhooks', async () => {
			mockListWebhooks.mockResolvedValue({
				data: [{ id: 1, name: 'web', active: true, events: ['push'], config: { url: 'http://x' } }],
			});

			const result = await adapter.list(githubCtx);
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe(1);
		});

		it('returns empty array when no github token', async () => {
			const ctx = { ...githubCtx, githubToken: '' };
			const result = await adapter.list(ctx);
			expect(result).toEqual([]);
			expect(mockListWebhooks).not.toHaveBeenCalled();
		});
	});

	describe('create', () => {
		it('creates webhook when no duplicate exists', async () => {
			mockListWebhooks.mockResolvedValue({ data: [] });
			mockCreateWebhook.mockResolvedValue({
				data: {
					id: 42,
					config: { url: `${BASE_URL}/github/webhook` },
					events: ['pull_request'],
					active: true,
				},
			});

			const result = await adapter.create(githubCtx, BASE_URL);
			expect(result).toMatchObject({ id: 42 });
		});

		it('returns "Already exists" when duplicate found', async () => {
			mockListWebhooks.mockResolvedValue({
				data: [{ id: 99, config: { url: `${BASE_URL}/github/webhook` }, events: [], active: true }],
			});

			const result = await adapter.create(githubCtx, BASE_URL);
			expect(result).toBe('Already exists: 99');
		});

		it('returns undefined when no github token', async () => {
			const ctx = { ...githubCtx, githubToken: '' };
			const result = await adapter.create(ctx, BASE_URL);
			expect(result).toBeUndefined();
		});
	});

	describe('delete', () => {
		it('deletes matching webhooks and returns their IDs', async () => {
			mockListWebhooks.mockResolvedValue({
				data: [{ id: 10, config: { url: `${BASE_URL}/github/webhook` }, events: [], active: true }],
			});
			mockDeleteWebhook.mockResolvedValue({});

			const result = await adapter.delete(githubCtx, BASE_URL);
			expect(result).toEqual([10]);
		});

		it('returns empty array when no github token', async () => {
			const ctx = { ...githubCtx, githubToken: '' };
			const result = await adapter.delete(ctx, BASE_URL);
			expect(result).toEqual([]);
		});
	});
});

// ---------------------------------------------------------------------------
// JiraWebhookAdapter
// ---------------------------------------------------------------------------

describe('JiraWebhookAdapter', () => {
	const adapter = new JiraWebhookAdapter();

	beforeEach(() => vi.clearAllMocks());

	it('has type "jira"', () => {
		expect(adapter.type).toBe('jira');
	});

	describe('list', () => {
		it('returns JIRA webhooks', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						values: [
							{ id: 1, name: 'cascade-webhook', url: 'http://x', events: [], enabled: true },
						],
					}),
			});

			const result = await adapter.list(jiraCtx);
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe(1);
		});

		it('returns empty array when JIRA credentials missing', async () => {
			const ctx = { ...jiraCtx, jiraEmail: undefined };
			const result = await adapter.list(ctx);
			expect(result).toEqual([]);
			expect(mockFetch).not.toHaveBeenCalled();
		});
	});

	describe('create', () => {
		it('creates webhook when no duplicate exists', async () => {
			mockFetch
				.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ values: [] }) })
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							id: 100,
							name: 'cascade-webhook',
							url: `${BASE_URL}/jira/webhook`,
							events: [],
							enabled: true,
						}),
				});

			const result = await adapter.create(jiraCtx, BASE_URL);
			expect(result).toMatchObject({ id: 100 });
		});

		it('returns "Already exists" when duplicate found', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						values: [
							{
								id: 50,
								name: 'cascade-webhook',
								url: `${BASE_URL}/jira/webhook`,
								events: [],
								enabled: true,
							},
						],
					}),
			});

			const result = await adapter.create(jiraCtx, BASE_URL);
			expect(result).toBe('Already exists: 50');
		});

		it('returns undefined when JIRA credentials missing', async () => {
			const ctx = { ...jiraCtx, jiraEmail: undefined };
			const result = await adapter.create(ctx, BASE_URL);
			expect(result).toBeUndefined();
		});
	});

	describe('delete', () => {
		it('deletes matching JIRA webhooks and returns their IDs', async () => {
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							values: [
								{
									id: 20,
									name: 'w',
									url: `${BASE_URL}/jira/webhook`,
									events: [],
									enabled: true,
								},
							],
						}),
				})
				.mockResolvedValueOnce({ ok: true });

			const result = await adapter.delete(jiraCtx, BASE_URL);
			expect(result).toEqual([20]);
		});

		it('returns empty array when JIRA credentials missing', async () => {
			const ctx = { ...jiraCtx, jiraEmail: undefined };
			const result = await adapter.delete(ctx, BASE_URL);
			expect(result).toEqual([]);
		});
	});
});

// ---------------------------------------------------------------------------
// jiraEnsureLabels
// ---------------------------------------------------------------------------

describe('jiraEnsureLabels', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns empty array when credentials are missing', async () => {
		const ctx = { ...jiraCtx, jiraEmail: undefined };
		const result = await jiraEnsureLabels(ctx);
		expect(result).toEqual([]);
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('returns empty array when no issues in project', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ issues: [] }),
		});

		const result = await jiraEnsureLabels(jiraCtx);
		expect(result).toEqual([]);
	});

	it('seeds labels and returns them when new labels needed', async () => {
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						issues: [{ key: 'PROJ-1', fields: { labels: ['existing'] } }],
					}),
			})
			.mockResolvedValueOnce({ ok: true }) // add labels
			.mockResolvedValueOnce({ ok: true }); // restore labels

		const result = await jiraEnsureLabels(jiraCtx);
		expect(result).toEqual(jiraCtx.jiraLabels);
	});

	it('returns labels without fetch when all labels already exist', async () => {
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

		const result = await jiraEnsureLabels(jiraCtx);
		expect(result).toEqual(jiraCtx.jiraLabels);
		// Only the search call is made, no add/restore calls
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});
});
