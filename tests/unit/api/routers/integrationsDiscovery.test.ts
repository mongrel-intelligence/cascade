import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';
import { createMockUser } from '../../../helpers/factories.js';

const mockTrelloGetMe = vi.fn();
const mockTrelloGetBoards = vi.fn();
const mockTrelloGetBoardLists = vi.fn();
const mockTrelloGetBoardLabels = vi.fn();
const mockTrelloGetBoardCustomFields = vi.fn();
const mockTrelloCreateBoardCustomField = vi.fn();

vi.mock('../../../../src/trello/client.js', () => ({
	withTrelloCredentials: (...args: unknown[]) => {
		const cb = args[1] as () => unknown;
		return cb();
	},
	trelloClient: {
		getMe: (...args: unknown[]) => mockTrelloGetMe(...args),
		getBoards: (...args: unknown[]) => mockTrelloGetBoards(...args),
		getBoardLists: (...args: unknown[]) => mockTrelloGetBoardLists(...args),
		getBoardLabels: (...args: unknown[]) => mockTrelloGetBoardLabels(...args),
		getBoardCustomFields: (...args: unknown[]) => mockTrelloGetBoardCustomFields(...args),
		createBoardCustomField: (...args: unknown[]) => mockTrelloCreateBoardCustomField(...args),
	},
}));

const mockJiraGetMyself = vi.fn();
const mockJiraSearchProjects = vi.fn();
const mockJiraGetProjectStatuses = vi.fn();
const mockJiraGetIssueTypesForProject = vi.fn();
const mockJiraGetFields = vi.fn();
const mockJiraCreateCustomField = vi.fn();

vi.mock('../../../../src/jira/client.js', () => ({
	withJiraCredentials: (...args: unknown[]) => {
		const cb = args[1] as () => unknown;
		return cb();
	},
	jiraClient: {
		getMyself: (...args: unknown[]) => mockJiraGetMyself(...args),
		searchProjects: (...args: unknown[]) => mockJiraSearchProjects(...args),
		getProjectStatuses: (...args: unknown[]) => mockJiraGetProjectStatuses(...args),
		getIssueTypesForProject: (...args: unknown[]) => mockJiraGetIssueTypesForProject(...args),
		getFields: (...args: unknown[]) => mockJiraGetFields(...args),
		createCustomField: (...args: unknown[]) => mockJiraCreateCustomField(...args),
	},
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockGetAuthenticated = vi.fn();

vi.mock('@octokit/rest', () => ({
	Octokit: vi.fn().mockImplementation(() => ({
		users: { getAuthenticated: mockGetAuthenticated },
	})),
}));

const mockVerifyProjectOrgAccess = vi.fn();

vi.mock('../../../../src/api/routers/_shared/projectAccess.js', () => ({
	verifyProjectOrgAccess: (...args: unknown[]) => mockVerifyProjectOrgAccess(...args),
}));

const mockGetIntegrationCredentialOrNull = vi.fn();

vi.mock('../../../../src/config/provider.js', () => ({
	getIntegrationCredentialOrNull: (...args: unknown[]) =>
		mockGetIntegrationCredentialOrNull(...args),
}));

const mockGetIntegrationByProjectAndCategory = vi.fn();

vi.mock('../../../../src/db/repositories/integrationsRepository.js', () => ({
	getIntegrationByProjectAndCategory: (...args: unknown[]) =>
		mockGetIntegrationByProjectAndCategory(...args),
}));

import { Octokit } from '@octokit/rest';

import { integrationsDiscoveryRouter } from '../../../../src/api/routers/integrationsDiscovery.js';

function createCaller(ctx: TRPCContext) {
	return integrationsDiscoveryRouter.createCaller(ctx);
}

const mockUser = createMockUser();

// Raw credential inputs — no longer credential IDs
const trelloCredsInput = { apiKey: 'my-api-key', token: 'my-token' };
const jiraCredsInput = {
	email: 'user@example.com',
	apiToken: 'my-jira-token',
	baseUrl: 'https://myorg.atlassian.net',
};

describe('integrationsDiscoveryRouter', () => {
	beforeEach(() => {
		// Default: org access check passes
		mockVerifyProjectOrgAccess.mockResolvedValue(undefined);
	});

	// ── Auth ─────────────────────────────────────────────────────────────

	describe('auth', () => {
		it('verifyTrello throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.verifyTrello(trelloCredsInput)).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});

		it('verifyJira throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.verifyJira(jiraCredsInput)).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});

		it('trelloBoards throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.trelloBoards(trelloCredsInput)).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});

		it('trelloBoardDetails throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(
				caller.trelloBoardDetails({ ...trelloCredsInput, boardId: 'abc123' }),
			).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});

		it('jiraProjects throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.jiraProjects(jiraCredsInput)).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});

		it('jiraProjectDetails throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(
				caller.jiraProjectDetails({ ...jiraCredsInput, projectKey: 'PROJ' }),
			).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});

		it('trelloBoardsByProject throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.trelloBoardsByProject({ projectId: 'proj-1' })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});

		it('trelloBoardDetailsByProject throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(
				caller.trelloBoardDetailsByProject({ projectId: 'proj-1', boardId: 'abc123' }),
			).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});

		it('jiraProjectsByProject throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.jiraProjectsByProject({ projectId: 'proj-1' })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});

		it('jiraProjectDetailsByProject throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(
				caller.jiraProjectDetailsByProject({ projectId: 'proj-1', projectKey: 'PROJ' }),
			).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
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
			await expect(
				caller.createTrelloCustomField({
					...trelloCredsInput,
					boardId: 'boardabc',
					name: 'Cost',
					type: 'number',
				}),
			).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
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
			await expect(
				caller.createJiraCustomField({
					...jiraCredsInput,
					name: 'Cost',
				}),
			).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
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
			await expect(caller.verifyGithubToken({ token: 'ghp_test' })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});

		it('rejects empty token', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.verifyGithubToken({ token: '' })).rejects.toThrow();
		});
	});
});
