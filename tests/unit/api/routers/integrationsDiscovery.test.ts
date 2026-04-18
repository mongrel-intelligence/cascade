import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockUser } from '../../../helpers/factories.js';
import { createCallerFor, expectTRPCError } from '../../../helpers/trpcTestHarness.js';

const {
	mockTrelloGetMe,
	mockTrelloGetBoards,
	mockTrelloGetBoardLists,
	mockTrelloGetBoardLabels,
	mockTrelloGetBoardCustomFields,
	mockTrelloCreateBoardCustomField,
	mockJiraGetMyself,
	mockJiraSearchProjects,
	mockJiraGetProjectStatuses,
	mockJiraGetIssueTypesForProject,
	mockJiraGetFields,
	mockJiraCreateCustomField,
	mockLinearGetMe,
	mockLinearGetTeams,
	mockLinearGetTeamWorkflowStates,
	mockLinearGetTeamLabels,
	mockLinearGetTeamProjects,
	mockGetAuthenticated,
	mockVerifyProjectOrgAccess,
	mockGetIntegrationCredentialOrNull,
	mockGetIntegrationByProjectAndCategory,
	mockFetch,
} = vi.hoisted(() => ({
	mockTrelloGetMe: vi.fn(),
	mockTrelloGetBoards: vi.fn(),
	mockTrelloGetBoardLists: vi.fn(),
	mockTrelloGetBoardLabels: vi.fn(),
	mockTrelloGetBoardCustomFields: vi.fn(),
	mockTrelloCreateBoardCustomField: vi.fn(),
	mockJiraGetMyself: vi.fn(),
	mockJiraSearchProjects: vi.fn(),
	mockJiraGetProjectStatuses: vi.fn(),
	mockJiraGetIssueTypesForProject: vi.fn(),
	mockJiraGetFields: vi.fn(),
	mockJiraCreateCustomField: vi.fn(),
	mockLinearGetMe: vi.fn(),
	mockLinearGetTeams: vi.fn(),
	mockLinearGetTeamWorkflowStates: vi.fn(),
	mockLinearGetTeamLabels: vi.fn(),
	mockLinearGetTeamProjects: vi.fn(),
	mockGetAuthenticated: vi.fn(),
	mockVerifyProjectOrgAccess: vi.fn(),
	mockGetIntegrationCredentialOrNull: vi.fn(),
	mockGetIntegrationByProjectAndCategory: vi.fn(),
	mockFetch: vi.fn(),
}));

vi.mock('../../../../src/trello/client.js', () => ({
	withTrelloCredentials: (...args: unknown[]) => {
		const cb = args[1] as () => unknown;
		return cb();
	},
	trelloClient: {
		getMe: mockTrelloGetMe,
		getBoards: mockTrelloGetBoards,
		getBoardLists: mockTrelloGetBoardLists,
		getBoardLabels: mockTrelloGetBoardLabels,
		getBoardCustomFields: mockTrelloGetBoardCustomFields,
		createBoardCustomField: mockTrelloCreateBoardCustomField,
	},
}));

vi.mock('../../../../src/jira/client.js', () => ({
	withJiraCredentials: (...args: unknown[]) => {
		const cb = args[1] as () => unknown;
		return cb();
	},
	jiraClient: {
		getMyself: mockJiraGetMyself,
		searchProjects: mockJiraSearchProjects,
		getProjectStatuses: mockJiraGetProjectStatuses,
		getIssueTypesForProject: mockJiraGetIssueTypesForProject,
		getFields: mockJiraGetFields,
		createCustomField: mockJiraCreateCustomField,
	},
}));

vi.mock('../../../../src/linear/client.js', () => ({
	withLinearCredentials: (...args: unknown[]) => {
		const cb = args[1] as () => unknown;
		return cb();
	},
	linearClient: {
		getMe: mockLinearGetMe,
		getTeams: mockLinearGetTeams,
		getTeamWorkflowStates: mockLinearGetTeamWorkflowStates,
		getTeamLabels: mockLinearGetTeamLabels,
		getTeamProjects: mockLinearGetTeamProjects,
	},
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@octokit/rest', () => ({
	Octokit: vi.fn().mockImplementation(() => ({
		users: { getAuthenticated: mockGetAuthenticated },
	})),
}));

vi.mock('../../../../src/api/routers/_shared/projectAccess.js', () => ({
	verifyProjectOrgAccess: mockVerifyProjectOrgAccess,
}));

vi.mock('../../../../src/config/provider.js', () => ({
	getIntegrationCredentialOrNull: mockGetIntegrationCredentialOrNull,
}));

vi.mock('../../../../src/db/repositories/integrationsRepository.js', () => ({
	getIntegrationByProjectAndCategory: mockGetIntegrationByProjectAndCategory,
}));

import { Octokit } from '@octokit/rest';

import { integrationsDiscoveryRouter } from '../../../../src/api/routers/integrationsDiscovery.js';

const createCaller = createCallerFor(integrationsDiscoveryRouter);

const mockUser = createMockUser();

// Raw credential inputs — no longer credential IDs
const trelloCredsInput = { apiKey: 'my-api-key', token: 'my-token' };
const jiraCredsInput = {
	email: 'user@example.com',
	apiToken: 'my-jira-token',
	baseUrl: 'https://myorg.atlassian.net',
};

// Assign global fetch mock
vi.stubGlobal('fetch', mockFetch);

describe('integrationsDiscoveryRouter', () => {
	beforeEach(() => {
		// Default: org access check passes
		mockVerifyProjectOrgAccess.mockResolvedValue(undefined);
		mockFetch.mockReset();
		// Reset the credential mock so leftover mockResolvedValueOnce values from
		// earlier tests don't leak into the next test's code path.
		mockGetIntegrationCredentialOrNull.mockReset();
		// Default: *ByProject endpoints find a PM integration row for the project.
		// Individual tests override to simulate missing-integration or wrong-provider cases.
		mockGetIntegrationByProjectAndCategory.mockReset();
		mockGetIntegrationByProjectAndCategory.mockResolvedValue({
			id: 1,
			projectId: 'proj-1',
			category: 'pm',
			provider: 'trello',
			config: { baseUrl: 'https://myorg.atlassian.net' },
			triggers: {},
			createdAt: new Date(),
			updatedAt: new Date(),
		});
	});

	// ── Auth ─────────────────────────────────────────────────────────────

	describe('auth', () => {
		// verifyTrello / verifyJira removed by spec 009/5 — wizard
		// verification now goes through pm.discover (see
		// web/src/components/projects/pm-wizard-hooks.ts).

		it('trelloBoards throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.trelloBoards(trelloCredsInput), 'UNAUTHORIZED');
		});

		it('trelloBoardDetails throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(
				caller.trelloBoardDetails({ ...trelloCredsInput, boardId: 'abc123' }),
				'UNAUTHORIZED',
			);
		});

		it('jiraProjects throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.jiraProjects(jiraCredsInput), 'UNAUTHORIZED');
		});

		it('jiraProjectDetails throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(
				caller.jiraProjectDetails({ ...jiraCredsInput, projectKey: 'PROJ' }),
				'UNAUTHORIZED',
			);
		});

		it('trelloBoardsByProject throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.trelloBoardsByProject({ projectId: 'proj-1' }), 'UNAUTHORIZED');
		});

		it('trelloBoardDetailsByProject throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(
				caller.trelloBoardDetailsByProject({ projectId: 'proj-1', boardId: 'abc123' }),
				'UNAUTHORIZED',
			);
		});

		it('jiraProjectsByProject throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.jiraProjectsByProject({ projectId: 'proj-1' }), 'UNAUTHORIZED');
		});

		it('jiraProjectDetailsByProject throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(
				caller.jiraProjectDetailsByProject({ projectId: 'proj-1', projectKey: 'PROJ' }),
				'UNAUTHORIZED',
			);
		});

		// verifyLinear removed by spec 009/5 — wizard verification goes
		// through pm.discover({ providerId: 'linear', capability: 'teams', ... }).

		it('linearTeams throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.linearTeams({ apiKey: 'lin_api_test' }), 'UNAUTHORIZED');
		});

		it('linearTeamsByProject throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.linearTeamsByProject({ projectId: 'proj-1' }), 'UNAUTHORIZED');
		});

		it('linearTeamDetails throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(
				caller.linearTeamDetails({ apiKey: 'lin_api_test', teamId: 'team-1' }),
				'UNAUTHORIZED',
			);
		});

		it('linearTeamDetailsByProject throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(
				caller.linearTeamDetailsByProject({ projectId: 'proj-1', teamId: 'team-1' }),
				'UNAUTHORIZED',
			);
		});
	});

	// verifyTrello procedure removed by spec 009/5.
	// Coverage moved to tests/unit/api/pm-discovery.test.ts (pm.discover
	// with capability='boards') + the wizard hook migration in
	// web/src/components/projects/pm-wizard-hooks.ts.

	// verifyJira procedure removed by spec 009/5. Coverage moved to
	// pm.discover (capability='projects') + wizard hook migration.

	// ── trelloBoards ─────────────────────────────────────────────────────

	describe('trelloBoards', () => {
		it('returns boards list on success', async () => {
			const boards = [
				{ id: 'board-1', name: 'Board One', url: 'https://trello.com/b/1' },
				{ id: 'board-2', name: 'Board Two', url: 'https://trello.com/b/2' },
			];
			mockTrelloGetBoards.mockResolvedValue(boards);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.trelloBoards(trelloCredsInput);

			expect(result).toEqual(boards);
		});

		it('wraps API failure in BAD_REQUEST', async () => {
			mockTrelloGetBoards.mockRejectedValue(new Error('Network error'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.trelloBoards(trelloCredsInput)).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});
	});

	// ── trelloBoardDetails ───────────────────────────────────────────────

	describe('trelloBoardDetails', () => {
		it('returns lists, labels, and customFields on success', async () => {
			const lists = [{ id: 'list-1', name: 'Backlog' }];
			const labels = [{ id: 'label-1', name: 'Bug', color: 'red' }];
			const customFields = [{ id: 'cf-1', name: 'Priority', type: 'list' }];
			mockTrelloGetBoardLists.mockResolvedValue(lists);
			mockTrelloGetBoardLabels.mockResolvedValue(labels);
			mockTrelloGetBoardCustomFields.mockResolvedValue(customFields);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.trelloBoardDetails({
				...trelloCredsInput,
				boardId: 'abc123',
			});

			expect(result).toEqual({ lists, labels, customFields });
			expect(mockTrelloGetBoardLists).toHaveBeenCalledWith('abc123');
			expect(mockTrelloGetBoardLabels).toHaveBeenCalledWith('abc123');
			expect(mockTrelloGetBoardCustomFields).toHaveBeenCalledWith('abc123');
		});

		it('rejects boardId with hyphens', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.trelloBoardDetails({ ...trelloCredsInput, boardId: 'abc-def' }),
			).rejects.toThrow();
		});

		it('rejects boardId longer than 32 characters', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.trelloBoardDetails({
					...trelloCredsInput,
					boardId: 'a'.repeat(33),
				}),
			).rejects.toThrow();
		});

		it('wraps API failure in BAD_REQUEST', async () => {
			mockTrelloGetBoardLists.mockRejectedValue(new Error('Board not found'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.trelloBoardDetails({ ...trelloCredsInput, boardId: 'abc123' }),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		});
	});

	// ── jiraProjects ─────────────────────────────────────────────────────

	describe('jiraProjects', () => {
		it('returns project list on success', async () => {
			const projects = [
				{ key: 'PROJ', name: 'Project One' },
				{ key: 'TEST', name: 'Test Project' },
			];
			mockJiraSearchProjects.mockResolvedValue(projects);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.jiraProjects(jiraCredsInput);

			expect(result).toEqual(projects);
		});

		it('wraps API failure in BAD_REQUEST', async () => {
			mockJiraSearchProjects.mockRejectedValue(new Error('Connection refused'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.jiraProjects(jiraCredsInput)).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});
	});

	// ── jiraProjectDetails ───────────────────────────────────────────────

	describe('jiraProjectDetails', () => {
		it('returns statuses, issueTypes, and only custom fields', async () => {
			const statuses = [
				{ name: 'To Do', id: 'status-1' },
				{ name: 'Done', id: 'status-2' },
			];
			const issueTypes = [
				{ name: 'Story', subtask: false },
				{ name: 'Bug', subtask: false },
			];
			const fields = [
				{ id: 'summary', name: 'Summary', custom: false },
				{ id: 'customfield_10001', name: 'Story Points', custom: true },
				{ id: 'description', name: 'Description', custom: false },
				{ id: 'customfield_10002', name: 'Sprint', custom: true },
			];
			mockJiraGetProjectStatuses.mockResolvedValue(statuses);
			mockJiraGetIssueTypesForProject.mockResolvedValue(issueTypes);
			mockJiraGetFields.mockResolvedValue(fields);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.jiraProjectDetails({
				...jiraCredsInput,
				projectKey: 'PROJ',
			});

			expect(result.statuses).toEqual(statuses);
			expect(result.issueTypes).toEqual(issueTypes);
			expect(result.fields).toEqual([
				{ id: 'customfield_10001', name: 'Story Points', custom: true },
				{ id: 'customfield_10002', name: 'Sprint', custom: true },
			]);
			expect(mockJiraGetProjectStatuses).toHaveBeenCalledWith('PROJ');
			expect(mockJiraGetIssueTypesForProject).toHaveBeenCalledWith('PROJ');
		});

		it('rejects lowercase projectKey', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.jiraProjectDetails({ ...jiraCredsInput, projectKey: 'proj' }),
			).rejects.toThrow();
		});

		it('rejects projectKey starting with number', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.jiraProjectDetails({ ...jiraCredsInput, projectKey: '1TEST' }),
			).rejects.toThrow();
		});

		it('rejects projectKey longer than 10 characters', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.jiraProjectDetails({
					...jiraCredsInput,
					projectKey: 'ABCDEFGHIJK',
				}),
			).rejects.toThrow();
		});

		it('wraps API failure in BAD_REQUEST', async () => {
			mockJiraGetProjectStatuses.mockRejectedValue(new Error('Project not found'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.jiraProjectDetails({ ...jiraCredsInput, projectKey: 'PROJ' }),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		});
	});

	// ── trelloBoardsByProject ────────────────────────────────────────────

	describe('trelloBoardsByProject', () => {
		it('returns boards using stored project credentials', async () => {
			mockGetIntegrationCredentialOrNull
				.mockResolvedValueOnce('stored-api-key')
				.mockResolvedValueOnce('stored-token');
			const boards = [{ id: 'board-1', name: 'Board One', url: 'https://trello.com/b/1' }];
			mockTrelloGetBoards.mockResolvedValue(boards);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.trelloBoardsByProject({ projectId: 'proj-1' });

			expect(mockVerifyProjectOrgAccess).toHaveBeenCalledWith('proj-1', mockUser.orgId);
			expect(result).toEqual(boards);
		});

		it('throws NOT_FOUND when apiKey credential is missing', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValue(null);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.trelloBoardsByProject({ projectId: 'proj-1' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws NOT_FOUND when token credential is missing', async () => {
			mockGetIntegrationCredentialOrNull
				.mockResolvedValueOnce('stored-api-key')
				.mockResolvedValueOnce(null);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.trelloBoardsByProject({ projectId: 'proj-1' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('propagates org access denial', async () => {
			const { TRPCError } = await import('@trpc/server');
			mockVerifyProjectOrgAccess.mockRejectedValue(
				new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' }),
			);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.trelloBoardsByProject({ projectId: 'other-org-proj' }),
			).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
		});

		it('wraps Trello API failure in BAD_REQUEST', async () => {
			mockGetIntegrationCredentialOrNull
				.mockResolvedValueOnce('stored-api-key')
				.mockResolvedValueOnce('stored-token');
			mockTrelloGetBoards.mockRejectedValue(new Error('API error'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.trelloBoardsByProject({ projectId: 'proj-1' })).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});
	});

	// ── trelloBoardDetailsByProject ──────────────────────────────────────

	describe('trelloBoardDetailsByProject', () => {
		it('returns board details using stored project credentials', async () => {
			mockGetIntegrationCredentialOrNull
				.mockResolvedValueOnce('stored-api-key')
				.mockResolvedValueOnce('stored-token');
			const lists = [{ id: 'list-1', name: 'Backlog' }];
			const labels = [{ id: 'label-1', name: 'Bug', color: 'red' }];
			const customFields = [{ id: 'cf-1', name: 'Priority', type: 'list' }];
			mockTrelloGetBoardLists.mockResolvedValue(lists);
			mockTrelloGetBoardLabels.mockResolvedValue(labels);
			mockTrelloGetBoardCustomFields.mockResolvedValue(customFields);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.trelloBoardDetailsByProject({
				projectId: 'proj-1',
				boardId: 'abc123',
			});

			expect(mockVerifyProjectOrgAccess).toHaveBeenCalledWith('proj-1', mockUser.orgId);
			expect(result).toEqual({ lists, labels, customFields });
		});

		it('throws NOT_FOUND when credentials are missing', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValue(null);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.trelloBoardDetailsByProject({ projectId: 'proj-1', boardId: 'abc123' }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});

		it('propagates org access denial', async () => {
			const { TRPCError } = await import('@trpc/server');
			mockVerifyProjectOrgAccess.mockRejectedValue(
				new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' }),
			);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.trelloBoardDetailsByProject({ projectId: 'other-org-proj', boardId: 'abc123' }),
			).rejects.toMatchObject({ code: 'FORBIDDEN' });
		});

		it('rejects boardId with hyphens', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.trelloBoardDetailsByProject({ projectId: 'proj-1', boardId: 'abc-def' }),
			).rejects.toThrow();
		});
	});

	// ── jiraProjectsByProject ────────────────────────────────────────────

	describe('jiraProjectsByProject', () => {
		it('returns projects using stored credentials and config baseUrl', async () => {
			mockGetIntegrationCredentialOrNull
				.mockResolvedValueOnce('stored@example.com')
				.mockResolvedValueOnce('stored-token');
			mockGetIntegrationByProjectAndCategory.mockResolvedValue({
				provider: 'jira',
				config: { baseUrl: 'https://myorg.atlassian.net' },
			});
			const projects = [{ key: 'PROJ', name: 'My Project' }];
			mockJiraSearchProjects.mockResolvedValue(projects);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.jiraProjectsByProject({ projectId: 'proj-1' });

			expect(mockVerifyProjectOrgAccess).toHaveBeenCalledWith('proj-1', mockUser.orgId);
			expect(result).toEqual(projects);
		});

		it('throws NOT_FOUND when email credential is missing', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValue(null);
			mockGetIntegrationByProjectAndCategory.mockResolvedValue({
				provider: 'jira',
				config: { baseUrl: 'https://myorg.atlassian.net' },
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.jiraProjectsByProject({ projectId: 'proj-1' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws NOT_FOUND when integration has no baseUrl', async () => {
			mockGetIntegrationCredentialOrNull
				.mockResolvedValueOnce('stored@example.com')
				.mockResolvedValueOnce('stored-token');
			mockGetIntegrationByProjectAndCategory.mockResolvedValue({ provider: 'jira', config: {} });

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.jiraProjectsByProject({ projectId: 'proj-1' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws NOT_FOUND when integration is null', async () => {
			mockGetIntegrationCredentialOrNull
				.mockResolvedValueOnce('stored@example.com')
				.mockResolvedValueOnce('stored-token');
			mockGetIntegrationByProjectAndCategory.mockResolvedValue(null);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.jiraProjectsByProject({ projectId: 'proj-1' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('propagates org access denial', async () => {
			const { TRPCError } = await import('@trpc/server');
			mockVerifyProjectOrgAccess.mockRejectedValue(
				new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' }),
			);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.jiraProjectsByProject({ projectId: 'other-org-proj' }),
			).rejects.toMatchObject({ code: 'FORBIDDEN' });
		});

		it('wraps JIRA API failure in BAD_REQUEST', async () => {
			mockGetIntegrationCredentialOrNull
				.mockResolvedValueOnce('stored@example.com')
				.mockResolvedValueOnce('stored-token');
			mockGetIntegrationByProjectAndCategory.mockResolvedValue({
				provider: 'jira',
				config: { baseUrl: 'https://myorg.atlassian.net' },
			});
			mockJiraSearchProjects.mockRejectedValue(new Error('Connection refused'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.jiraProjectsByProject({ projectId: 'proj-1' })).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});
	});

	// ── jiraProjectDetailsByProject ──────────────────────────────────────

	describe('jiraProjectDetailsByProject', () => {
		it('returns project details using stored credentials', async () => {
			mockGetIntegrationCredentialOrNull
				.mockResolvedValueOnce('stored@example.com')
				.mockResolvedValueOnce('stored-token');
			mockGetIntegrationByProjectAndCategory.mockResolvedValue({
				provider: 'jira',
				config: { baseUrl: 'https://myorg.atlassian.net' },
			});
			const statuses = [{ name: 'To Do', id: 'status-1' }];
			const issueTypes = [{ name: 'Story', subtask: false }];
			const fields = [
				{ id: 'summary', name: 'Summary', custom: false },
				{ id: 'customfield_10001', name: 'Story Points', custom: true },
			];
			mockJiraGetProjectStatuses.mockResolvedValue(statuses);
			mockJiraGetIssueTypesForProject.mockResolvedValue(issueTypes);
			mockJiraGetFields.mockResolvedValue(fields);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.jiraProjectDetailsByProject({
				projectId: 'proj-1',
				projectKey: 'PROJ',
			});

			expect(mockVerifyProjectOrgAccess).toHaveBeenCalledWith('proj-1', mockUser.orgId);
			expect(result.statuses).toEqual(statuses);
			expect(result.issueTypes).toEqual(issueTypes);
			// Only custom fields returned
			expect(result.fields).toEqual([
				{ id: 'customfield_10001', name: 'Story Points', custom: true },
			]);
		});

		it('throws NOT_FOUND when credentials are missing', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValue(null);
			mockGetIntegrationByProjectAndCategory.mockResolvedValue({
				provider: 'jira',
				config: { baseUrl: 'https://myorg.atlassian.net' },
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.jiraProjectDetailsByProject({ projectId: 'proj-1', projectKey: 'PROJ' }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});

		it('propagates org access denial', async () => {
			const { TRPCError } = await import('@trpc/server');
			mockVerifyProjectOrgAccess.mockRejectedValue(
				new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' }),
			);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.jiraProjectDetailsByProject({ projectId: 'other-org', projectKey: 'PROJ' }),
			).rejects.toMatchObject({ code: 'FORBIDDEN' });
		});

		it('rejects lowercase projectKey', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.jiraProjectDetailsByProject({ projectId: 'proj-1', projectKey: 'proj' }),
			).rejects.toThrow();
		});

		it('rejects projectKey longer than 10 characters', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.jiraProjectDetailsByProject({ projectId: 'proj-1', projectKey: 'ABCDEFGHIJK' }),
			).rejects.toThrow();
		});

		it('wraps JIRA API failure in BAD_REQUEST', async () => {
			mockGetIntegrationCredentialOrNull
				.mockResolvedValueOnce('stored@example.com')
				.mockResolvedValueOnce('stored-token');
			mockGetIntegrationByProjectAndCategory.mockResolvedValue({
				provider: 'jira',
				config: { baseUrl: 'https://myorg.atlassian.net' },
			});
			mockJiraGetProjectStatuses.mockRejectedValue(new Error('Project not found'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.jiraProjectDetailsByProject({ projectId: 'proj-1', projectKey: 'PROJ' }),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		});
	});

	// ── verifyGithubToken ────────────────────────────────────────────────

	describe('verifyGithubToken', () => {
		it('calls GitHub API with the provided token and returns login/avatarUrl', async () => {
			mockGetAuthenticated.mockResolvedValue({
				data: { login: 'cascade-bot', avatar_url: 'https://example.com/avatar.png' },
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.verifyGithubToken({ token: 'ghp_test_token' });

			expect(Octokit).toHaveBeenCalledWith({ auth: 'ghp_test_token' });
			expect(result).toEqual({
				login: 'cascade-bot',
				avatarUrl: 'https://example.com/avatar.png',
			});
		});

		it('throws BAD_REQUEST when GitHub API fails', async () => {
			mockGetAuthenticated.mockRejectedValue(new Error('Bad credentials'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.verifyGithubToken({ token: 'bad-token' })).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.verifyGithubToken({ token: 'ghp_test' }), 'UNAUTHORIZED');
		});

		it('rejects empty token', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.verifyGithubToken({ token: '' })).rejects.toThrow();
		});
	});

	// verifyLinear procedure removed by spec 009/5. Coverage moved to
	// pm.discover (capability='teams') + wizard hook migration.

	// ── linearTeams ───────────────────────────────────────────────────────

	describe('linearTeams', () => {
		const linearCredsInput = { apiKey: 'lin_api_test' };

		it('returns teams list on success', async () => {
			const teams = [
				{ id: 'team-1', name: 'Engineering', key: 'ENG', description: null },
				{ id: 'team-2', name: 'Design', key: 'DES', description: 'Design team' },
			];
			mockLinearGetTeams.mockResolvedValue(teams);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.linearTeams(linearCredsInput);

			expect(result).toEqual(teams);
		});

		it('wraps API failure in BAD_REQUEST', async () => {
			mockLinearGetTeams.mockRejectedValue(new Error('Network error'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.linearTeams(linearCredsInput)).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});
	});

	// ── linearTeamsByProject ──────────────────────────────────────────────

	describe('linearTeamsByProject', () => {
		beforeEach(() => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValue({
				id: 1,
				projectId: 'proj-1',
				category: 'pm',
				provider: 'linear',
				config: { teamId: 'team-1' },
				triggers: {},
				createdAt: new Date(),
				updatedAt: new Date(),
			});
		});

		it('returns teams using stored project credentials', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce('stored-api-key');
			const teams = [{ id: 'team-1', name: 'Engineering', key: 'ENG', description: null }];
			mockLinearGetTeams.mockResolvedValue(teams);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.linearTeamsByProject({ projectId: 'proj-1' });

			expect(mockVerifyProjectOrgAccess).toHaveBeenCalledWith('proj-1', mockUser.orgId);
			expect(result).toEqual(teams);
		});

		it('throws NOT_FOUND when apiKey credential is missing', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValue(null);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.linearTeamsByProject({ projectId: 'proj-1' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('propagates org access denial', async () => {
			const { TRPCError } = await import('@trpc/server');
			mockVerifyProjectOrgAccess.mockRejectedValue(
				new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' }),
			);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.linearTeamsByProject({ projectId: 'other-org-proj' }),
			).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
		});

		it('wraps Linear API failure in BAD_REQUEST', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce('stored-api-key');
			mockLinearGetTeams.mockRejectedValue(new Error('API error'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.linearTeamsByProject({ projectId: 'proj-1' })).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});
	});

	// ── linearTeamDetails ─────────────────────────────────────────────────

	describe('linearTeamDetails', () => {
		const linearCredsInput = { apiKey: 'lin_api_test' };

		it('returns states and labels on success', async () => {
			const states = [
				{ id: 'state-1', name: 'Todo', type: 'unstarted', color: '#aaa' },
				{ id: 'state-2', name: 'In Progress', type: 'started', color: '#bbb' },
			];
			const labels = [
				{ id: 'label-1', name: 'Bug', color: '#f00', description: null },
				{ id: 'label-2', name: 'Feature', color: '#0f0', description: 'New feature' },
			];
			mockLinearGetTeamWorkflowStates.mockResolvedValue(states);
			mockLinearGetTeamLabels.mockResolvedValue(labels);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.linearTeamDetails({ ...linearCredsInput, teamId: 'team-1' });

			expect(result).toEqual({ states, labels });
			expect(mockLinearGetTeamWorkflowStates).toHaveBeenCalledWith('team-1');
			expect(mockLinearGetTeamLabels).toHaveBeenCalledWith('team-1');
		});

		it('wraps API failure in BAD_REQUEST', async () => {
			mockLinearGetTeamWorkflowStates.mockRejectedValue(new Error('Team not found'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.linearTeamDetails({ ...linearCredsInput, teamId: 'team-1' }),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		});

		it('rejects empty teamId', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.linearTeamDetails({ ...linearCredsInput, teamId: '' })).rejects.toThrow();
		});
	});

	// ── linearTeamDetailsByProject ────────────────────────────────────────

	describe('linearTeamDetailsByProject', () => {
		beforeEach(() => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValue({
				id: 1,
				projectId: 'proj-1',
				category: 'pm',
				provider: 'linear',
				config: { teamId: 'team-1' },
				triggers: {},
				createdAt: new Date(),
				updatedAt: new Date(),
			});
		});

		it('returns team details using stored project credentials', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce('stored-api-key');
			const states = [{ id: 'state-1', name: 'Todo', type: 'unstarted', color: '#aaa' }];
			const labels = [{ id: 'label-1', name: 'Bug', color: '#f00', description: null }];
			mockLinearGetTeamWorkflowStates.mockResolvedValue(states);
			mockLinearGetTeamLabels.mockResolvedValue(labels);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.linearTeamDetailsByProject({
				projectId: 'proj-1',
				teamId: 'team-1',
			});

			expect(mockVerifyProjectOrgAccess).toHaveBeenCalledWith('proj-1', mockUser.orgId);
			expect(result).toEqual({ states, labels });
			expect(mockLinearGetTeamWorkflowStates).toHaveBeenCalledWith('team-1');
			expect(mockLinearGetTeamLabels).toHaveBeenCalledWith('team-1');
		});

		it('throws NOT_FOUND when apiKey credential is missing', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValue(null);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.linearTeamDetailsByProject({ projectId: 'proj-1', teamId: 'team-1' }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});

		it('propagates org access denial', async () => {
			const { TRPCError } = await import('@trpc/server');
			mockVerifyProjectOrgAccess.mockRejectedValue(
				new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' }),
			);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.linearTeamDetailsByProject({ projectId: 'other-org-proj', teamId: 'team-1' }),
			).rejects.toMatchObject({ code: 'FORBIDDEN' });
		});

		it('rejects empty teamId', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.linearTeamDetailsByProject({ projectId: 'proj-1', teamId: '' }),
			).rejects.toThrow();
		});

		it('wraps Linear API failure in BAD_REQUEST', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce('stored-api-key');
			mockLinearGetTeamWorkflowStates.mockRejectedValue(new Error('Team not found'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.linearTeamDetailsByProject({ projectId: 'proj-1', teamId: 'team-1' }),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		});
	});

	// ── linearProjects ────────────────────────────────────────────────────

	describe('linearProjects', () => {
		const linearCredsInput = { apiKey: 'lin_api_test' };

		it('returns team projects on success', async () => {
			const projects = [
				{ id: 'P1', name: 'Alpha', icon: 'rocket', color: '#ff0000' },
				{ id: 'P2', name: 'Beta', icon: null, color: null },
			];
			mockLinearGetTeamProjects.mockResolvedValue(projects);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.linearProjects({ ...linearCredsInput, teamId: 'T1' });

			expect(result).toEqual(projects);
			expect(mockLinearGetTeamProjects).toHaveBeenCalledWith('T1');
		});

		it('rejects empty teamId', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.linearProjects({ ...linearCredsInput, teamId: '' })).rejects.toThrow();
		});

		it('wraps API failure in BAD_REQUEST', async () => {
			mockLinearGetTeamProjects.mockRejectedValue(new Error('Network error'));
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.linearProjects({ ...linearCredsInput, teamId: 'T1' }),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		});
	});

	// ── linearProjectsByProject ───────────────────────────────────────────

	describe('linearProjectsByProject', () => {
		beforeEach(() => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValue({
				id: 1,
				projectId: 'proj-1',
				category: 'pm',
				provider: 'linear',
				config: { teamId: 'team-1' },
				triggers: {},
				createdAt: new Date(),
				updatedAt: new Date(),
			});
		});

		it('returns projects using stored project credentials', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce('stored-api-key');
			const projects = [{ id: 'P1', name: 'Alpha', icon: null, color: null }];
			mockLinearGetTeamProjects.mockResolvedValue(projects);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.linearProjectsByProject({
				projectId: 'proj-1',
				teamId: 'team-1',
			});

			expect(mockVerifyProjectOrgAccess).toHaveBeenCalledWith('proj-1', mockUser.orgId);
			expect(mockLinearGetTeamProjects).toHaveBeenCalledWith('team-1');
			expect(result).toEqual(projects);
		});

		it('throws NOT_FOUND when no PM integration exists', async () => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValueOnce(null);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.linearProjectsByProject({ projectId: 'proj-1', teamId: 'team-1' }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});

		it('throws NOT_FOUND when provider is not linear', async () => {
			mockGetIntegrationByProjectAndCategory.mockResolvedValueOnce({
				id: 2,
				projectId: 'proj-1',
				category: 'pm',
				provider: 'jira',
				config: {},
				triggers: {},
				createdAt: new Date(),
				updatedAt: new Date(),
			});
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.linearProjectsByProject({ projectId: 'proj-1', teamId: 'team-1' }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});

		it('throws NOT_FOUND when apiKey credential is missing', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValue(null);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.linearProjectsByProject({ projectId: 'proj-1', teamId: 'team-1' }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});

		it('wraps Linear API failure in BAD_REQUEST', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce('stored-api-key');
			mockLinearGetTeamProjects.mockRejectedValue(new Error('API error'));
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.linearProjectsByProject({ projectId: 'proj-1', teamId: 'team-1' }),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		});
	});

	// ── verifySentry ─────────────────────────────────────────────────────

	describe('verifySentry', () => {
		it('returns org id, name, and slug on success', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => ({ id: 'org-123', name: 'My Org', slug: 'my-org' }),
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.verifySentry({
				apiToken: 'sntrys_abc',
				organizationSlug: 'my-org',
			});

			expect(result).toEqual({ id: 'org-123', name: 'My Org', slug: 'my-org' });
			expect(mockFetch).toHaveBeenCalledWith(
				'https://sentry.io/api/0/organizations/my-org/',
				expect.objectContaining({
					headers: { Authorization: 'Bearer sntrys_abc' },
				}),
			);
		});

		it('returns empty strings when Sentry response fields are missing', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => ({}),
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.verifySentry({
				apiToken: 'sntrys_abc',
				organizationSlug: 'my-org',
			});

			expect(result).toEqual({ id: '', name: '', slug: '' });
		});

		it('wraps non-ok response in BAD_REQUEST', async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 401,
				statusText: 'Unauthorized',
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.verifySentry({ apiToken: 'bad-token', organizationSlug: 'my-org' }),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		});

		it('wraps network failure in BAD_REQUEST', async () => {
			mockFetch.mockRejectedValue(new Error('Network error'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.verifySentry({ apiToken: 'sntrys_abc', organizationSlug: 'my-org' }),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		});

		it('URL-encodes the organization slug', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => ({ id: '1', name: 'Org', slug: 'org-with-slash' }),
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await caller.verifySentry({ apiToken: 'tok', organizationSlug: 'org/with/slash' });

			expect(mockFetch).toHaveBeenCalledWith(
				'https://sentry.io/api/0/organizations/org%2Fwith%2Fslash/',
				expect.any(Object),
			);
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(
				caller.verifySentry({ apiToken: 'tok', organizationSlug: 'my-org' }),
				'UNAUTHORIZED',
			);
		});

		it('rejects empty apiToken', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.verifySentry({ apiToken: '', organizationSlug: 'my-org' }),
			).rejects.toThrow();
		});

		it('rejects empty organizationSlug', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.verifySentry({ apiToken: 'sntrys_abc', organizationSlug: '' }),
			).rejects.toThrow();
		});
	});
});
