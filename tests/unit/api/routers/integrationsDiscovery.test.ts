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
	});

	// ── Auth ─────────────────────────────────────────────────────────────

	describe('auth', () => {
		it('verifyTrello throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.verifyTrello(trelloCredsInput), 'UNAUTHORIZED');
		});

		it('verifyJira throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.verifyJira(jiraCredsInput), 'UNAUTHORIZED');
		});

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
	});

	// ── verifyTrello ─────────────────────────────────────────────────────

	describe('verifyTrello', () => {
		it('returns username, fullName, and id on success', async () => {
			mockTrelloGetMe.mockResolvedValue({
				id: 'trello-123',
				fullName: 'Trello User',
				username: 'trellouser',
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.verifyTrello(trelloCredsInput);

			expect(result).toEqual({
				id: 'trello-123',
				fullName: 'Trello User',
				username: 'trellouser',
			});
		});

		it('wraps API failure in BAD_REQUEST', async () => {
			mockTrelloGetMe.mockRejectedValue(new Error('Invalid API key'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.verifyTrello(trelloCredsInput)).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});

		it('rejects empty apiKey', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.verifyTrello({ apiKey: '', token: 'my-token' })).rejects.toThrow();
		});

		it('rejects empty token', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.verifyTrello({ apiKey: 'my-api-key', token: '' })).rejects.toThrow();
		});
	});

	// ── verifyJira ───────────────────────────────────────────────────────

	describe('verifyJira', () => {
		it('returns displayName, emailAddress, and accountId on success', async () => {
			mockJiraGetMyself.mockResolvedValue({
				displayName: 'Jira User',
				emailAddress: 'jira@example.com',
				accountId: 'acct-456',
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.verifyJira(jiraCredsInput);

			expect(result).toEqual({
				displayName: 'Jira User',
				emailAddress: 'jira@example.com',
				accountId: 'acct-456',
			});
		});

		it('returns empty strings when JIRA response fields are missing', async () => {
			mockJiraGetMyself.mockResolvedValue({});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.verifyJira(jiraCredsInput);

			expect(result).toEqual({
				displayName: '',
				emailAddress: '',
				accountId: '',
			});
		});

		it('wraps API failure in BAD_REQUEST', async () => {
			mockJiraGetMyself.mockRejectedValue(new Error('Unauthorized'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.verifyJira(jiraCredsInput)).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});

		it('rejects invalid baseUrl', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.verifyJira({ email: 'a@b.com', apiToken: 'tok', baseUrl: 'not-a-url' }),
			).rejects.toThrow();
		});
	});

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
			mockGetIntegrationByProjectAndCategory.mockResolvedValue({ config: {} });

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
				config: { baseUrl: 'https://myorg.atlassian.net' },
			});
			mockJiraGetProjectStatuses.mockRejectedValue(new Error('Project not found'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.jiraProjectDetailsByProject({ projectId: 'proj-1', projectKey: 'PROJ' }),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		});
	});

	// ── createTrelloCustomField ──────────────────────────────────────────

	describe('createTrelloCustomField', () => {
		it('returns id, name, and type on success', async () => {
			mockTrelloCreateBoardCustomField.mockResolvedValue({
				id: 'cf-123',
				name: 'Cost',
				type: 'number',
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.createTrelloCustomField({
				...trelloCredsInput,
				boardId: 'boardabc',
				name: 'Cost',
				type: 'number',
			});

			expect(result).toEqual({
				id: 'cf-123',
				name: 'Cost',
				type: 'number',
			});
			expect(mockTrelloCreateBoardCustomField).toHaveBeenCalledWith('boardabc', 'Cost', 'number');
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(
				caller.createTrelloCustomField({
					...trelloCredsInput,
					boardId: 'boardabc',
					name: 'Cost',
					type: 'number',
				}),
				'UNAUTHORIZED',
			);
		});

		it('validates boardId with alphanumeric regex', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.createTrelloCustomField({
					...trelloCredsInput,
					boardId: 'board-with-hyphens',
					name: 'Cost',
					type: 'number',
				}),
			).rejects.toThrow();
		});

		it('validates boardId max length of 32', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.createTrelloCustomField({
					...trelloCredsInput,
					boardId: 'a'.repeat(33),
					name: 'Cost',
					type: 'number',
				}),
			).rejects.toThrow();
		});

		it('validates name min length of 1', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.createTrelloCustomField({
					...trelloCredsInput,
					boardId: 'boardabc',
					name: '',
					type: 'number',
				}),
			).rejects.toThrow();
		});

		it('validates name max length of 100', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.createTrelloCustomField({
					...trelloCredsInput,
					boardId: 'boardabc',
					name: 'a'.repeat(101),
					type: 'number',
				}),
			).rejects.toThrow();
		});

		it('validates type is one of the allowed enum values', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.createTrelloCustomField({
					...trelloCredsInput,
					boardId: 'boardabc',
					name: 'Cost',
					type: 'invalid-type',
				}),
			).rejects.toThrow();
		});

		it('wraps API failure in BAD_REQUEST', async () => {
			mockTrelloCreateBoardCustomField.mockRejectedValue(new Error('Board not found'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.createTrelloCustomField({
					...trelloCredsInput,
					boardId: 'boardabc',
					name: 'Cost',
					type: 'number',
				}),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		});
	});

	// ── createJiraCustomField ────────────────────────────────────────────

	describe('createJiraCustomField', () => {
		it('returns id and name on success', async () => {
			mockJiraCreateCustomField.mockResolvedValue({
				id: 'customfield_10001',
				name: 'Cost',
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.createJiraCustomField({
				...jiraCredsInput,
				name: 'Cost',
			});

			expect(result).toEqual({
				id: 'customfield_10001',
				name: 'Cost',
			});
			expect(mockJiraCreateCustomField).toHaveBeenCalledWith(
				'Cost',
				'com.atlassian.jira.plugin.system.customfieldtypes:float',
				'com.atlassian.jira.plugin.system.customfieldtypes:exactnumber',
			);
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(
				caller.createJiraCustomField({
					...jiraCredsInput,
					name: 'Cost',
				}),
				'UNAUTHORIZED',
			);
		});

		it('validates name min length of 1', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.createJiraCustomField({
					...jiraCredsInput,
					name: '',
				}),
			).rejects.toThrow();
		});

		it('validates name max length of 100', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.createJiraCustomField({
					...jiraCredsInput,
					name: 'a'.repeat(101),
				}),
			).rejects.toThrow();
		});

		it('wraps API failure in BAD_REQUEST', async () => {
			mockJiraCreateCustomField.mockRejectedValue(new Error('Admin permission required'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.createJiraCustomField({
					...jiraCredsInput,
					name: 'Cost',
				}),
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
