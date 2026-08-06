import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import { createMockUser } from '../../../helpers/factories.js';
import {
	createCallerFor,
	expectTRPCError,
	setupOwnershipCheckMock,
} from '../../../helpers/trpcTestHarness.js';

// --- Mock dependencies ---

const {
	mockFindProjectByIdFromDb,
	mockGetAllProjectCredentials,
	mockGetIntegrationByProjectAndCategory,
	mockListWebhooks,
	mockCreateWebhook,
	mockDeleteWebhook,
	mockFetch,
} = vi.hoisted(() => ({
	mockFindProjectByIdFromDb: vi.fn(),
	mockGetAllProjectCredentials: vi.fn(),
	mockGetIntegrationByProjectAndCategory: vi.fn(),
	mockListWebhooks: vi.fn(),
	mockCreateWebhook: vi.fn(),
	mockDeleteWebhook: vi.fn(),
	mockFetch: vi.fn(),
}));

const { mockDbSelect, mockDbFrom, mockDbWhere } = setupOwnershipCheckMock();

vi.mock('../../../../src/db/client.js', () => ({
	getDb: () => ({
		select: mockDbSelect,
	}),
}));

vi.mock('../../../../src/db/schema/index.js', () => ({
	projects: { id: 'id', orgId: 'org_id' },
}));

vi.mock('../../../../src/db/repositories/configRepository.js', () => ({
	findProjectByIdFromDb: mockFindProjectByIdFromDb,
}));

vi.mock('../../../../src/db/repositories/integrationsRepository.js', () => ({
	getIntegrationByProjectAndCategory: mockGetIntegrationByProjectAndCategory,
}));

vi.mock('../../../../src/config/provider.js', () => ({
	getAllProjectCredentials: mockGetAllProjectCredentials,
}));

vi.mock('../../../../src/utils/repo.js', () => ({
	parseRepoFullName: (fullName: string) => {
		const slashIdx = fullName.indexOf('/');
		return { owner: fullName.slice(0, slashIdx), repo: fullName.slice(slashIdx + 1) };
	},
}));

// Passthrough the JIRA REST host resolver so these tests stay hermetic (no
// jira.js import) and preserve site-URL behavior for basic/absent authType.
// Scoped-mode gateway routing is covered in webhooks/jira.test.ts.
vi.mock('../../../../src/jira/api-host.js', () => ({
	resolveJiraApiBaseUrl: vi.fn(async (creds: { baseUrl: string }) => creds.baseUrl),
}));

// Mock global fetch for Trello API calls
vi.stubGlobal('fetch', mockFetch);

// Mock Octokit for GitHub API calls
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

const createCaller = createCallerFor(webhooksRouter);

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

const mockLinearProject = {
	id: 'linear-project',
	orgId: 'org-1',
	repo: 'owner/linear-repo',
	pm: { type: 'linear' },
	linear: {
		teamId: 'TEAM-123',
		statuses: { todo: 'Todo', inProgress: 'In Progress' },
	},
};

const mockSentryProject = {
	id: 'sentry-project',
	orgId: 'org-1',
	repo: 'owner/sentry-repo',
	pm: { type: 'linear' },
	linear: {
		teamId: 'TEAM-123',
		statuses: { todo: 'Todo' },
	},
};

function setupJiraProjectContext() {
	mockDbSelect.mockReturnValue({ from: mockDbFrom });
	mockDbFrom.mockReturnValue({ where: mockDbWhere });
	mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
	mockFindProjectByIdFromDb.mockResolvedValue(mockJiraProject);
	mockGetIntegrationByProjectAndCategory.mockResolvedValue(null);
	mockGetAllProjectCredentials.mockResolvedValue({
		JIRA_EMAIL: 'bot@example.com',
		JIRA_API_TOKEN: 'jira-token-123',
		GITHUB_TOKEN_IMPLEMENTER: 'ghp_test123',
	});
}

function setupLinearProjectContext(opts?: { noLinearApiKey?: boolean; webhookSecret?: boolean }) {
	mockDbSelect.mockReturnValue({ from: mockDbFrom });
	mockDbFrom.mockReturnValue({ where: mockDbWhere });
	mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
	mockFindProjectByIdFromDb.mockResolvedValue(mockLinearProject);
	mockGetIntegrationByProjectAndCategory.mockResolvedValue(null);
	const creds: Record<string, string> = {
		GITHUB_TOKEN_IMPLEMENTER: 'ghp_test123',
	};
	if (!opts?.noLinearApiKey) {
		creds.LINEAR_API_KEY = 'lin_api_test123';
	}
	if (opts?.webhookSecret) {
		creds.LINEAR_WEBHOOK_SECRET = 'linear-secret-abc';
	}
	mockGetAllProjectCredentials.mockResolvedValue(creds);
}

function setupProjectContext(opts?: {
	noTrello?: boolean;
	noGithub?: boolean;
	webhookSecret?: string;
}) {
	mockDbSelect.mockReturnValue({ from: mockDbFrom });
	mockDbFrom.mockReturnValue({ where: mockDbWhere });
	mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
	mockFindProjectByIdFromDb.mockResolvedValue(mockProject);
	mockGetIntegrationByProjectAndCategory.mockResolvedValue(null);
	const creds: Record<string, string> = {};
	if (!opts?.noTrello) {
		creds.TRELLO_API_KEY = 'trello-key';
		creds.TRELLO_TOKEN = 'trello-token';
	}
	if (!opts?.noGithub) {
		creds.GITHUB_TOKEN_IMPLEMENTER = 'ghp_test123';
	}
	if (opts?.webhookSecret) {
		creds.GITHUB_WEBHOOK_SECRET = opts.webhookSecret;
	}
	mockGetAllProjectCredentials.mockResolvedValue(creds);
}

function setupSentryProjectContext(opts?: {
	noSentryApiToken?: boolean;
	webhookSecret?: boolean;
	config?: Record<string, unknown> | null;
	provider?: string;
}) {
	mockDbSelect.mockReturnValue({ from: mockDbFrom });
	mockDbFrom.mockReturnValue({ where: mockDbWhere });
	mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
	mockFindProjectByIdFromDb.mockResolvedValue(mockSentryProject);
	mockGetIntegrationByProjectAndCategory.mockResolvedValue(
		opts?.config === null
			? null
			: {
					provider: opts?.provider ?? 'sentry',
					config: opts?.config ?? { organizationSlug: 'my-org', projectSlug: 'api' },
				},
	);
	const creds: Record<string, string> = {};
	if (!opts?.noSentryApiToken) {
		creds.SENTRY_API_TOKEN = 'sntrys_test123';
	}
	if (opts?.webhookSecret) {
		creds.SENTRY_WEBHOOK_SECRET = 'sentry-secret-abc';
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
			await expectTRPCError(caller.list({ projectId: 'my-project' }), 'UNAUTHORIZED');
		});

		it('allows admin role to list webhooks', async () => {
			setupProjectContext();

			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve([]),
			});
			mockListWebhooks.mockResolvedValue({ data: [] });

			const adminUser = createMockUser({ role: 'admin' });
			const caller = createCaller({ user: adminUser, effectiveOrgId: adminUser.orgId });
			const result = await caller.list({ projectId: 'my-project' });
			expect(result.trello).toEqual([]);
			expect(result.github).toEqual([]);
		});

		it('throws FORBIDDEN for member role', async () => {
			const memberUser = createMockUser({ role: 'member' });
			const caller = createCaller({ user: memberUser, effectiveOrgId: memberUser.orgId });
			await expectTRPCError(caller.list({ projectId: 'my-project' }), 'FORBIDDEN');
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

		it('returns Sentry project pairing when alerting config and API token are complete', async () => {
			setupSentryProjectContext({ webhookSecret: true });

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.list({
				projectId: 'sentry-project',
				callbackBaseUrl: 'http://example.com/',
			});

			expect(result.sentry).toEqual({
				url: 'http://example.com/sentry/webhook/sentry-project',
				webhookSecretSet: true,
				organizationSlug: 'my-org',
				projectSlug: 'api',
				note: expect.stringContaining('my-org/api'),
			});
			expect(result.sentry?.note).toContain('project matches the configured project slug "api"');
		});

		it('does not return Sentry info without project slug or API token', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			setupSentryProjectContext({ config: { organizationSlug: 'my-org' } });
			const missingProjectSlug = await caller.list({
				projectId: 'sentry-project',
				callbackBaseUrl: 'http://example.com',
			});
			expect(missingProjectSlug.sentry).toBeNull();

			setupSentryProjectContext({ noSentryApiToken: true });
			const missingApiToken = await caller.list({
				projectId: 'sentry-project',
				callbackBaseUrl: 'http://example.com',
			});
			expect(missingApiToken.sentry).toBeNull();
		});
	});

	describe('create', () => {
		it('creates both trello and github webhooks', async () => {
			setupProjectContext();

			// Fetch calls in order:
			// 1. trelloListWebhooks (router duplicate check) - returns empty
			// 2. trelloListWebhooks (inside trelloCreateWebhook for delete-before-create) - returns empty
			// 3. trelloCreateWebhook POST - creates new webhook
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve([]), // router duplicate check
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve([]), // trelloCreateWebhook internal list
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

			// githubCreateWebhook also calls githubListWebhooks internally (via mockListWebhooks)
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

			// Fetch calls:
			// 1. trelloListWebhooks (router duplicate check)
			// 2. trelloListWebhooks (inside trelloCreateWebhook)
			// 3. trelloCreateWebhook POST
			mockFetch
				.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // router duplicate check
				.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // internal list
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

			// Fetch calls in order:
			// 1. jiraListWebhooks (router duplicate check at line 103)
			// 2. jiraListWebhooks (inside jiraCreateWebhook for delete-before-create)
			// 3. jiraCreateWebhook (POST /rest/api/3/webhook) - success
			// 4. jiraEnsureLabels: JQL search (GET /rest/api/3/search) - returns 1 issue
			// 5. jiraEnsureLabels: add labels (PUT /rest/api/3/issue/PROJ-1)
			// 6. jiraEnsureLabels: restore labels (PUT /rest/api/3/issue/PROJ-1)
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ values: [] }), // router duplicate check
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ values: [] }), // jiraCreateWebhook internal list
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
				'cascade-auto',
			]);
		});

		it('returns empty labelsEnsured when JIRA project has no issues', async () => {
			setupJiraProjectContext();

			// Fetch calls in order:
			// 1. jiraListWebhooks (router duplicate check)
			// 2. jiraListWebhooks (inside jiraCreateWebhook for delete-before-create)
			// 3. jiraCreateWebhook POST
			// 4. jiraEnsureLabels search (returns no issues)
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ values: [] }), // router duplicate check
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ values: [] }), // jiraCreateWebhook internal list
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

		it('surfaces the create actionable error when the router-level dedup list is denied (scoped token)', async () => {
			setupJiraProjectContext();

			// Scoped-token scenario (MNG-1735): the token cannot even list webhooks,
			// so GET /rest/api/3/webhook returns 401. The router-level dedup must be
			// best-effort so jiraCreateWebhook still runs and its actionable 403
			// scope / manual-registration message surfaces — instead of a generic
			// "Failed to list JIRA webhooks: 401" masking it.
			//
			// Fetch calls in order:
			// 1. jiraListWebhooks (router duplicate check) - 401 (caught, best-effort)
			// 2. jiraListWebhooks (inside jiraCreateWebhook dedup) - 401 (caught, best-effort)
			// 3. jiraCreateWebhook POST - 403 (throws the friendly FORBIDDEN message)
			mockFetch
				.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) })
				.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) })
				.mockResolvedValueOnce({
					ok: false,
					status: 403,
					text: () => Promise.resolve('Unauthorized; scope does not match'),
				});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const err = await caller
				.create({
					projectId: 'jira-project',
					callbackBaseUrl: 'http://example.com',
					jiraOnly: true,
				})
				.catch((e) => e);

			// The actionable FORBIDDEN message reaches the caller (not INTERNAL_SERVER_ERROR
			// from the router-level list) — this is the crux of the best-effort dedup fix.
			expect(err).toBeInstanceOf(TRPCError);
			expect(err.code).toBe('FORBIDDEN');
			expect(err.message).toContain('manage:jira-webhook');
			expect(err.message).toContain('write:webhook:jira');
			expect(err.message).toMatch(/register the webhook manually/i);
			// The POST create was actually reached: 2 denied list calls + the create.
			expect(mockFetch).toHaveBeenCalledTimes(3);
		});

		it('returns Sentry manual setup info with paired project context', async () => {
			setupSentryProjectContext();

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.create({
				projectId: 'sentry-project',
				callbackBaseUrl: 'http://example.com/',
			});

			expect(result.sentry).toEqual({
				url: 'http://example.com/sentry/webhook/sentry-project',
				webhookSecretSet: false,
				organizationSlug: 'my-org',
				projectSlug: 'api',
				note: expect.stringContaining('project matches the configured project slug "api"'),
			});
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
				gitlab: null,
				jira: null,
				linear: null,
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

		it('passes webhook secret to GitHub when GITHUB_WEBHOOK_SECRET credential is set', async () => {
			setupProjectContext({ noTrello: true, webhookSecret: 'my-hmac-secret' });

			mockListWebhooks.mockResolvedValue({ data: [] });
			mockCreateWebhook.mockResolvedValue({
				data: {
					id: 55,
					config: { url: 'http://example.com/github/webhook' },
					events: ['pull_request'],
					active: true,
				},
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await caller.create({
				projectId: 'my-project',
				callbackBaseUrl: 'http://example.com',
			});

			expect(mockCreateWebhook).toHaveBeenCalledWith(
				expect.objectContaining({
					config: expect.objectContaining({
						secret: 'my-hmac-secret',
					}),
				}),
			);
		});

		it('omits secret from GitHub webhook when no GITHUB_WEBHOOK_SECRET credential', async () => {
			setupProjectContext({ noTrello: true });

			mockListWebhooks.mockResolvedValue({ data: [] });
			mockCreateWebhook.mockResolvedValue({
				data: {
					id: 56,
					config: { url: 'http://example.com/github/webhook' },
					events: ['pull_request'],
					active: true,
				},
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await caller.create({
				projectId: 'my-project',
				callbackBaseUrl: 'http://example.com',
			});

			// secret should not be in the config at all
			expect(mockCreateWebhook).toHaveBeenCalledWith(
				expect.objectContaining({
					config: expect.not.objectContaining({
						secret: expect.anything(),
					}),
				}),
			);
		});

		it('create uses oneTimeTokens for github', async () => {
			setupProjectContext({ noGithub: true });

			// Fetch calls in order:
			// 1. trelloListWebhooks (router duplicate check)
			// 2. trelloListWebhooks (inside trelloCreateWebhook for delete-before-create)
			// 3. trelloCreateWebhook POST
			mockFetch
				.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // router duplicate check
				.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // trelloCreateWebhook internal list
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

		it('list uses linearApiKey oneTimeToken to show Linear webhook info', async () => {
			setupLinearProjectContext({ noLinearApiKey: true });

			mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
			mockListWebhooks.mockResolvedValue({ data: [] });

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.list({
				projectId: 'linear-project',
				callbackBaseUrl: 'https://cascade.example.com',
				oneTimeTokens: { linearApiKey: 'lin_api_onetime' },
			});

			expect(result.linear).not.toBeNull();
			expect(result.linear?.url).toBe('https://cascade.example.com/linear/webhook');
		});
	});

	describe('Linear webhook info', () => {
		it('list returns linear webhook info when project uses Linear PM and has linearApiKey', async () => {
			setupLinearProjectContext();

			mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
			mockListWebhooks.mockResolvedValue({ data: [] });

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.list({
				projectId: 'linear-project',
				callbackBaseUrl: 'https://cascade.example.com',
			});

			expect(result.linear).not.toBeNull();
			expect(result.linear?.url).toBe('https://cascade.example.com/linear/webhook');
			expect(result.linear?.webhookSecretSet).toBe(false);
			expect(result.linear?.note).toContain('Linear');
		});

		it('list returns linear webhook info with webhookSecretSet true when LINEAR_WEBHOOK_SECRET is set', async () => {
			setupLinearProjectContext({ webhookSecret: true });

			mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
			mockListWebhooks.mockResolvedValue({ data: [] });

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.list({
				projectId: 'linear-project',
				callbackBaseUrl: 'https://cascade.example.com',
			});

			expect(result.linear?.webhookSecretSet).toBe(true);
		});

		it('list returns null linear when project uses Linear PM but no linearApiKey', async () => {
			setupLinearProjectContext({ noLinearApiKey: true });

			mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
			mockListWebhooks.mockResolvedValue({ data: [] });

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.list({
				projectId: 'linear-project',
				callbackBaseUrl: 'https://cascade.example.com',
			});

			expect(result.linear).toBeNull();
		});

		it('list returns null linear when no callbackBaseUrl is provided', async () => {
			setupLinearProjectContext();

			mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
			mockListWebhooks.mockResolvedValue({ data: [] });

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.list({
				projectId: 'linear-project',
			});

			expect(result.linear).toBeNull();
		});

		it('list errors object includes linear: null', async () => {
			setupLinearProjectContext();

			mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
			mockListWebhooks.mockResolvedValue({ data: [] });

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.list({
				projectId: 'linear-project',
				callbackBaseUrl: 'https://cascade.example.com',
			});

			expect(result.errors.linear).toBeNull();
		});

		it('create returns linear webhook info for Linear PM projects', async () => {
			setupLinearProjectContext();

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
				projectId: 'linear-project',
				callbackBaseUrl: 'https://cascade.example.com',
			});

			expect(result.linear).not.toBeUndefined();
			expect(result.linear?.url).toBe('https://cascade.example.com/linear/webhook');
			expect(result.linear?.webhookSecretSet).toBe(false);
			expect(result.linear?.note).toContain('Linear');
		});

		it('create returns linear webhook info with webhookSecretSet true when LINEAR_WEBHOOK_SECRET is set', async () => {
			setupLinearProjectContext({ webhookSecret: true });

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
				projectId: 'linear-project',
				callbackBaseUrl: 'https://cascade.example.com',
			});

			expect(result.linear?.webhookSecretSet).toBe(true);
		});

		it('create does not return linear info for non-Linear PM projects', async () => {
			setupProjectContext();

			mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
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
				callbackBaseUrl: 'https://cascade.example.com',
			});

			expect(result.linear).toBeUndefined();
		});
	});
});
