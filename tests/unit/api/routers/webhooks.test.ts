import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';
import { createMockUser } from '../../../helpers/factories.js';

// --- Mock dependencies ---

const mockFindProjectByIdFromDb = vi.fn();
const mockGetAllProjectCredentials = vi.fn();

const mockDbSelect = vi.fn();
const mockDbFrom = vi.fn();
const mockDbWhere = vi.fn();

vi.mock('../../../../src/db/client.js', () => ({
	getDb: () => ({
		select: mockDbSelect,
	}),
}));

vi.mock('../../../../src/db/schema/index.js', () => ({
	projects: { id: 'id', orgId: 'org_id' },
}));

vi.mock('../../../../src/db/repositories/configRepository.js', () => ({
	findProjectByIdFromDb: (...args: unknown[]) => mockFindProjectByIdFromDb(...args),
}));

vi.mock('../../../../src/config/provider.js', () => ({
	getAllProjectCredentials: (...args: unknown[]) => mockGetAllProjectCredentials(...args),
}));

vi.mock('../../../../src/utils/repo.js', () => ({
	parseRepoFullName: (fullName: string) => {
		const slashIdx = fullName.indexOf('/');
		return { owner: fullName.slice(0, slashIdx), repo: fullName.slice(slashIdx + 1) };
	},
}));

// Mock global fetch for Trello API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock Octokit for GitHub API calls
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

import { webhooksRouter } from '../../../../src/api/routers/webhooks.js';

function createCaller(ctx: TRPCContext) {
	return webhooksRouter.createCaller(ctx);
}

const mockUser = createMockUser();

const mockProject = {
	id: 'my-project',
	orgId: 'org-1',
	repo: 'owner/repo',
	trello: { boardId: 'board-123' },
};

const mockJiraProject = {
	id: 'jira-project',
	orgId: 'org-1',
	repo: 'owner/jira-repo',
	pm: { type: 'jira' },
	jira: {
		projectKey: 'PROJ',
		baseUrl: 'https://test.atlassian.net',
		statuses: { splitting: 'Briefing' },
		labels: {
			processing: 'my-processing',
			processed: 'my-processed',
			error: 'my-error',
			readyToProcess: 'my-ready',
		},
	},
};

function setupJiraProjectContext() {
	mockDbSelect.mockReturnValue({ from: mockDbFrom });
	mockDbFrom.mockReturnValue({ where: mockDbWhere });
	mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
	mockFindProjectByIdFromDb.mockResolvedValue(mockJiraProject);
	mockGetAllProjectCredentials.mockResolvedValue({
		JIRA_EMAIL: 'bot@example.com',
		JIRA_API_TOKEN: 'jira-token-123',
		GITHUB_TOKEN_IMPLEMENTER: 'ghp_test123',
	});
}

function setupProjectContext(opts?: { noTrello?: boolean; noGithub?: boolean }) {
	mockDbSelect.mockReturnValue({ from: mockDbFrom });
	mockDbFrom.mockReturnValue({ where: mockDbWhere });
	mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
	mockFindProjectByIdFromDb.mockResolvedValue(mockProject);
	const creds: Record<string, string> = {};
	if (!opts?.noTrello) {
		creds.TRELLO_API_KEY = 'trello-key';
		creds.TRELLO_TOKEN = 'trello-token';
	}
	if (!opts?.noGithub) {
		creds.GITHUB_TOKEN_IMPLEMENTER = 'ghp_test123';
	}
	mockGetAllProjectCredentials.mockResolvedValue(creds);
}

describe('webhooksRouter', () => {
	describe('list', () => {
		it('returns trello and github webhooks', async () => {
			setupProjectContext();

			const trelloWebhooks = [
				{
					id: 'tw-1',
					description: 'test',
					idModel: 'board-123',
					callbackURL: 'http://x',
					active: true,
				},
			];
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(trelloWebhooks),
			});

			const githubWebhooks = [
				{ id: 1, name: 'web', active: true, events: ['push'], config: { url: 'http://y' } },
			];
			mockListWebhooks.mockResolvedValue({ data: githubWebhooks });

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.list({ projectId: 'my-project' });

			expect(result.trello).toHaveLength(1);
			expect(result.trello[0].id).toBe('tw-1');
			expect(result.github).toHaveLength(1);
			expect(result.github[0].id).toBe(1);
		});

		it('filters trello webhooks by board ID', async () => {
			setupProjectContext();

			mockFetch.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve([
						{ id: 'tw-1', idModel: 'board-123', callbackURL: 'http://x', active: true },
						{ id: 'tw-2', idModel: 'other-board', callbackURL: 'http://y', active: true },
					]),
			});
			mockListWebhooks.mockResolvedValue({ data: [] });

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.list({ projectId: 'my-project' });

			expect(result.trello).toHaveLength(1);
			expect(result.trello[0].id).toBe('tw-1');
		});

		it('returns empty arrays when no credentials', async () => {
			setupProjectContext({ noTrello: true, noGithub: true });

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.list({ projectId: 'my-project' });

			expect(result.trello).toEqual([]);
			expect(result.github).toEqual([]);
			expect(mockFetch).not.toHaveBeenCalled();
			expect(mockListWebhooks).not.toHaveBeenCalled();
		});

		it('throws NOT_FOUND when project belongs to different org', async () => {
			mockDbSelect.mockReturnValue({ from: mockDbFrom });
			mockDbFrom.mockReturnValue({ where: mockDbWhere });
			mockDbWhere.mockResolvedValue([{ orgId: 'different-org' }]);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.list({ projectId: 'my-project' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.list({ projectId: 'my-project' })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});

		it('does not use legacy GITHUB_TOKEN org default for github operations', async () => {
			mockDbSelect.mockReturnValue({ from: mockDbFrom });
			mockDbFrom.mockReturnValue({ where: mockDbWhere });
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockFindProjectByIdFromDb.mockResolvedValue(mockProject);

			// No GitHub integration credential linked, only legacy GITHUB_TOKEN org default
			mockGetAllProjectCredentials.mockResolvedValue({
				TRELLO_API_KEY: 'trello-key',
				TRELLO_TOKEN: 'trello-token',
				GITHUB_TOKEN: 'ghp_legacy_should_not_be_used',
			});

			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve([]),
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.list({ projectId: 'my-project' });

			// GITHUB_TOKEN_IMPLEMENTER was not set, so GitHub webhooks should not be listed
			expect(result.github).toEqual([]);
			expect(mockListWebhooks).not.toHaveBeenCalled();
		});
	});

	describe('create', () => {
		it('creates both trello and github webhooks', async () => {
			setupProjectContext();

			// First fetch: trello list (for duplicate check) - empty
			// Second fetch: trello create
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve([]),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							id: 'tw-new',
							callbackURL: 'http://example.com/trello/webhook',
							idModel: 'board-123',
							active: true,
						}),
				});

			mockListWebhooks.mockResolvedValue({ data: [] });
			mockCreateWebhook.mockResolvedValue({
				data: {
					id: 42,
					config: { url: 'http://example.com/github/webhook' },
					events: ['pull_request'],
					active: true,
				},
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.create({
				projectId: 'my-project',
				callbackBaseUrl: 'http://example.com',
			});

			expect(result.trello).toMatchObject({ id: 'tw-new' });
			expect(result.github).toMatchObject({ id: 42 });
		});

		it('returns duplicate message when webhook already exists', async () => {
			setupProjectContext();

			mockFetch.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve([
						{
							id: 'tw-existing',
							callbackURL: 'http://example.com/trello/webhook',
							idModel: 'board-123',
							active: true,
						},
					]),
			});

			mockListWebhooks.mockResolvedValue({
				data: [
					{
						id: 99,
						config: { url: 'http://example.com/github/webhook' },
						events: ['push'],
						active: true,
					},
				],
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.create({
				projectId: 'my-project',
				callbackBaseUrl: 'http://example.com',
			});

			expect(result.trello).toBe('Already exists: tw-existing');
			expect(result.github).toBe('Already exists: 99');
		});

		it('strips trailing slash from callback URL', async () => {
			setupProjectContext({ noTrello: true });

			mockListWebhooks.mockResolvedValue({ data: [] });
			mockCreateWebhook.mockResolvedValue({
				data: {
					id: 1,
					config: { url: 'http://example.com/github/webhook' },
					events: [],
					active: true,
				},
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await caller.create({
				projectId: 'my-project',
				callbackBaseUrl: 'http://example.com/',
			});

			expect(mockCreateWebhook).toHaveBeenCalledWith(
				expect.objectContaining({
					config: expect.objectContaining({
						url: 'http://example.com/github/webhook',
					}),
				}),
			);
		});

		it('respects trelloOnly flag', async () => {
			setupProjectContext();

			mockFetch
				.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							id: 'tw-new',
							callbackURL: 'http://example.com/trello/webhook',
							idModel: 'board-123',
							active: true,
						}),
				});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.create({
				projectId: 'my-project',
				callbackBaseUrl: 'http://example.com',
				trelloOnly: true,
			});

			expect(result.trello).toMatchObject({ id: 'tw-new' });
			expect(result.github).toBeUndefined();
			expect(mockCreateWebhook).not.toHaveBeenCalled();
		});

		it('respects githubOnly flag', async () => {
			setupProjectContext();

			mockListWebhooks.mockResolvedValue({ data: [] });
			mockCreateWebhook.mockResolvedValue({
				data: {
					id: 1,
					config: { url: 'http://example.com/github/webhook' },
					events: [],
					active: true,
				},
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.create({
				projectId: 'my-project',
				callbackBaseUrl: 'http://example.com',
				githubOnly: true,
			});

			expect(result.trello).toBeUndefined();
			expect(result.github).toMatchObject({ id: 1 });
			// No Trello fetch calls (only GitHub Octokit calls)
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('seeds JIRA labels when creating JIRA webhook', async () => {
			setupJiraProjectContext();

			// Calls in order:
			// 1. jiraListWebhooks (GET /rest/api/3/webhook) - empty
			// 2. jiraCreateWebhook (POST /rest/api/3/webhook) - success
			// 3. jiraEnsureLabels: JQL search (GET /rest/api/3/search) - returns 1 issue
			// 4. jiraEnsureLabels: add labels (PUT /rest/api/3/issue/PROJ-1)
			// 5. jiraEnsureLabels: restore labels (PUT /rest/api/3/issue/PROJ-1)
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ values: [] }),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							id: 100,
							name: 'cascade-webhook',
							url: 'http://example.com/jira/webhook',
							events: [],
							enabled: true,
						}),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							issues: [
								{
									key: 'PROJ-1',
									fields: { labels: ['existing-label'] },
								},
							],
						}),
				})
				.mockResolvedValueOnce({ ok: true }) // add labels
				.mockResolvedValueOnce({ ok: true }); // restore labels

			mockListWebhooks.mockResolvedValue({ data: [] });
			mockCreateWebhook.mockResolvedValue({
				data: {
					id: 1,
					config: { url: 'http://example.com/github/webhook' },
					events: [],
					active: true,
				},
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.create({
				projectId: 'jira-project',
				callbackBaseUrl: 'http://example.com',
			});

			expect(result.jira).toMatchObject({ id: 100 });
			expect(result.labelsEnsured).toEqual([
				'my-processing',
				'my-processed',
				'my-error',
				'my-ready',
			]);
		});

		it('returns empty labelsEnsured when JIRA project has no issues', async () => {
			setupJiraProjectContext();

			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ values: [] }),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							id: 101,
							name: 'cascade-webhook',
							url: 'http://example.com/jira/webhook',
							events: [],
							enabled: true,
						}),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ issues: [] }),
				});

			mockListWebhooks.mockResolvedValue({ data: [] });
			mockCreateWebhook.mockResolvedValue({
				data: {
					id: 1,
					config: { url: 'http://example.com/github/webhook' },
					events: [],
					active: true,
				},
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.create({
				projectId: 'jira-project',
				callbackBaseUrl: 'http://example.com',
			});

			expect(result.jira).toMatchObject({ id: 101 });
			expect(result.labelsEnsured).toEqual([]);
		});
	});

	describe('delete', () => {
		it('deletes matching trello and github webhooks', async () => {
			setupProjectContext();

			mockFetch
				// trello list
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve([
							{
								id: 'tw-1',
								callbackURL: 'http://example.com/trello/webhook',
								idModel: 'board-123',
								active: true,
							},
						]),
				})
				// trello delete
				.mockResolvedValueOnce({ ok: true });

			mockListWebhooks.mockResolvedValue({
				data: [
					{
						id: 10,
						config: { url: 'http://example.com/github/webhook' },
						events: [],
						active: true,
					},
				],
			});
			mockDeleteWebhook.mockResolvedValue({});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.delete({
				projectId: 'my-project',
				callbackBaseUrl: 'http://example.com',
			});

			expect(result.trello).toEqual(['tw-1']);
			expect(result.github).toEqual([10]);
		});

		it('returns empty arrays when no matching webhooks', async () => {
			setupProjectContext();

			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve([]),
			});
			mockListWebhooks.mockResolvedValue({ data: [] });

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.delete({
				projectId: 'my-project',
				callbackBaseUrl: 'http://example.com',
			});

			expect(result.trello).toEqual([]);
			expect(result.github).toEqual([]);
		});

		it('deletes multiple matching webhooks', async () => {
			setupProjectContext();

			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve([
							{
								id: 'tw-1',
								callbackURL: 'http://example.com/trello/webhook',
								idModel: 'board-123',
								active: true,
							},
							{
								id: 'tw-2',
								callbackURL: 'http://example.com/trello/webhook',
								idModel: 'board-123',
								active: true,
							},
						]),
				})
				// Two delete calls
				.mockResolvedValueOnce({ ok: true })
				.mockResolvedValueOnce({ ok: true });

			mockListWebhooks.mockResolvedValue({ data: [] });

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.delete({
				projectId: 'my-project',
				callbackBaseUrl: 'http://example.com',
			});

			expect(result.trello).toEqual(['tw-1', 'tw-2']);
		});

		it('uses oneTimeTokens to override credentials', async () => {
			setupProjectContext({ noGithub: true });

			// The DB has no GitHub token, but we provide one via oneTimeTokens
			mockListWebhooks.mockResolvedValue({ data: [] });

			// Trello list call (project has Trello creds from DB)
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve([]),
			});

			// Provide a one-time GitHub token; delete should use it and call GitHub
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.delete({
				projectId: 'my-project',
				callbackBaseUrl: 'http://example.com',
				oneTimeTokens: { github: 'ghp_one_time_admin' },
			});

			// GitHub was called because oneTimeTokens overrode the missing credential
			expect(mockListWebhooks).toHaveBeenCalled();
			expect(result.github).toEqual([]);
		});
	});

	describe('per-provider errors', () => {
		it('list returns errors object with null values when all providers succeed', async () => {
			setupProjectContext();

			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve([]),
			});
			mockListWebhooks.mockResolvedValue({ data: [] });

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.list({ projectId: 'my-project' });

			expect(result.errors).toEqual({
				trello: null,
				github: null,
				jira: null,
			});
		});

		it('list captures github error while trello still succeeds', async () => {
			setupProjectContext();

			// Trello succeeds
			mockFetch.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve([
						{
							id: 'tw-1',
							idModel: 'board-123',
							callbackURL: 'http://x',
							active: true,
						},
					]),
			});

			// GitHub fails with 404
			mockListWebhooks.mockRejectedValue(new Error('Not Found'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.list({ projectId: 'my-project' });

			expect(result.trello).toHaveLength(1);
			expect(result.github).toEqual([]);
			expect(result.errors.trello).toBeNull();
			expect(result.errors.github).toContain('Not Found');
			expect(result.errors.jira).toBeNull();
		});

		it('list captures trello error while github still succeeds', async () => {
			setupProjectContext();

			// Trello fails
			mockFetch.mockResolvedValue({
				ok: false,
				status: 401,
				json: () => Promise.resolve({}),
			});

			// GitHub succeeds
			mockListWebhooks.mockResolvedValue({
				data: [{ id: 1, name: 'web', active: true, events: [], config: { url: 'http://y' } }],
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.list({ projectId: 'my-project' });

			expect(result.trello).toEqual([]);
			expect(result.github).toHaveLength(1);
			expect(result.errors.trello).toBeTruthy();
			expect(result.errors.github).toBeNull();
		});
	});

	describe('oneTimeTokens', () => {
		it('list uses oneTimeTokens to override github credential', async () => {
			setupProjectContext({ noGithub: true });

			// Trello succeeds with DB creds
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve([]),
			});

			// GitHub should now be called because we provide oneTimeTokens
			const ghWebhooks = [
				{ id: 5, name: 'web', active: true, events: ['push'], config: { url: 'http://z' } },
			];
			mockListWebhooks.mockResolvedValue({ data: ghWebhooks });

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.list({
				projectId: 'my-project',
				oneTimeTokens: { github: 'ghp_admin_token' },
			});

			// GitHub was called because oneTimeTokens overrode the missing DB credential
			expect(mockListWebhooks).toHaveBeenCalled();
			expect(result.github).toHaveLength(1);
			expect(result.github[0].id).toBe(5);
		});

		it('create uses oneTimeTokens for github', async () => {
			setupProjectContext({ noGithub: true });

			// Trello: skip (no Trello flag), but we have creds from DB so it'll try
			mockFetch
				.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							id: 'tw-new',
							callbackURL: 'http://example.com/trello/webhook',
							idModel: 'board-123',
							active: true,
						}),
				});

			mockListWebhooks.mockResolvedValue({ data: [] });
			mockCreateWebhook.mockResolvedValue({
				data: {
					id: 77,
					config: { url: 'http://example.com/github/webhook' },
					events: ['push'],
					active: true,
				},
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.create({
				projectId: 'my-project',
				callbackBaseUrl: 'http://example.com',
				oneTimeTokens: { github: 'ghp_one_time' },
			});

			expect(mockCreateWebhook).toHaveBeenCalled();
			expect(result.github).toMatchObject({ id: 77 });
		});

		it('list passes oneTimeTokens without affecting DB credentials', async () => {
			setupProjectContext();

			// Both Trello and GitHub succeed with DB creds
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve([]),
			});
			mockListWebhooks.mockResolvedValue({ data: [] });

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.list({
				projectId: 'my-project',
				oneTimeTokens: { github: 'ghp_override' },
			});

			expect(result.errors.trello).toBeNull();
			expect(result.errors.github).toBeNull();
			expect(result.errors.jira).toBeNull();
		});
	});
});
