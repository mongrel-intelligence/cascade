import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';

// --- Mock dependencies ---

const mockFindProjectByIdFromDb = vi.fn();
const mockResolveAllCredentials = vi.fn();

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
	resolveAllCredentials: (...args: unknown[]) => mockResolveAllCredentials(...args),
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

function setupProjectContext(opts?: { noTrello?: boolean; noGithub?: boolean }) {
	mockDbSelect.mockReturnValue({ from: mockDbFrom });
	mockDbFrom.mockReturnValue({ where: mockDbWhere });
	mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
	mockFindProjectByIdFromDb.mockResolvedValue(mockProject);
	mockResolveAllCredentials.mockResolvedValue({
		TRELLO_API_KEY: opts?.noTrello ? undefined : 'trello-key',
		TRELLO_TOKEN: opts?.noTrello ? undefined : 'trello-token',
		GITHUB_TOKEN: opts?.noGithub ? undefined : 'ghp_test123',
	});
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
							callbackURL: 'http://example.com/webhook/trello',
							idModel: 'board-123',
							active: true,
						}),
				});

			mockListWebhooks.mockResolvedValue({ data: [] });
			mockCreateWebhook.mockResolvedValue({
				data: {
					id: 42,
					config: { url: 'http://example.com/webhook/github' },
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
							callbackURL: 'http://example.com/webhook/trello',
							idModel: 'board-123',
							active: true,
						},
					]),
			});

			mockListWebhooks.mockResolvedValue({
				data: [
					{
						id: 99,
						config: { url: 'http://example.com/webhook/github' },
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
					config: { url: 'http://example.com/webhook/github' },
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
						url: 'http://example.com/webhook/github',
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
							callbackURL: 'http://example.com/webhook/trello',
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
					config: { url: 'http://example.com/webhook/github' },
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
								callbackURL: 'http://example.com/webhook/trello',
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
						config: { url: 'http://example.com/webhook/github' },
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
								callbackURL: 'http://example.com/webhook/trello',
								idModel: 'board-123',
								active: true,
							},
							{
								id: 'tw-2',
								callbackURL: 'http://example.com/webhook/trello',
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
