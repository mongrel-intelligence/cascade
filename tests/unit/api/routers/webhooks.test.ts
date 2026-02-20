import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';

// --- Mock dependencies ---

const mockFindProjectByIdFromDb = vi.fn();
const mockResolveAllIntegrationCredentials = vi.fn();
const mockResolveAllOrgCredentials = vi.fn();

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

vi.mock('../../../../src/db/repositories/credentialsRepository.js', () => ({
	resolveAllIntegrationCredentials: (...args: unknown[]) =>
		mockResolveAllIntegrationCredentials(...args),
	resolveAllOrgCredentials: (...args: unknown[]) => mockResolveAllOrgCredentials(...args),
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

const mockUser = {
	id: 'user-1',
	orgId: 'org-1',
	email: 'test@example.com',
	name: 'Test',
	role: 'admin',
};

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
		statuses: { briefing: 'Briefing' },
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
	mockResolveAllIntegrationCredentials.mockResolvedValue([
		{ category: 'pm', provider: 'jira', role: 'email', value: 'bot@example.com' },
		{ category: 'pm', provider: 'jira', role: 'api_token', value: 'jira-token-123' },
		{ category: 'scm', provider: 'github', role: 'implementer_token', value: 'ghp_test123' },
	]);
	mockResolveAllOrgCredentials.mockResolvedValue({});
}

function setupProjectContext(opts?: { noTrello?: boolean; noGithub?: boolean }) {
	mockDbSelect.mockReturnValue({ from: mockDbFrom });
	mockDbFrom.mockReturnValue({ where: mockDbWhere });
	mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
	mockFindProjectByIdFromDb.mockResolvedValue(mockProject);
	const integrationCreds: { category: string; provider: string; role: string; value: string }[] =
		[];
	if (!opts?.noTrello) {
		integrationCreds.push(
			{ category: 'pm', provider: 'trello', role: 'api_key', value: 'trello-key' },
			{ category: 'pm', provider: 'trello', role: 'token', value: 'trello-token' },
		);
	}
	if (!opts?.noGithub) {
		integrationCreds.push({
			category: 'scm',
			provider: 'github',
			role: 'implementer_token',
			value: 'ghp_test123',
		});
	}
	mockResolveAllIntegrationCredentials.mockResolvedValue(integrationCreds);
	mockResolveAllOrgCredentials.mockResolvedValue({});
}

describe('webhooksRouter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

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

			// No GitHub integration credential linked
			mockResolveAllIntegrationCredentials.mockResolvedValue([
				{ category: 'pm', provider: 'trello', role: 'api_key', value: 'trello-key' },
				{ category: 'pm', provider: 'trello', role: 'token', value: 'trello-token' },
			]);
			// Org default has a legacy GITHUB_TOKEN — should be ignored
			mockResolveAllOrgCredentials.mockResolvedValue({
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
	});
});
