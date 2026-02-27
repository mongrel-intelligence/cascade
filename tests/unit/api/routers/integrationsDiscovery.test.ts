import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';
import { createMockUser } from '../../../helpers/factories.js';

const mockDecryptCredential = vi.fn((value: string) => value);

vi.mock('../../../../src/db/crypto.js', () => ({
	decryptCredential: (...args: unknown[]) => mockDecryptCredential(...args),
}));

const mockDbSelect = vi.fn();
const mockDbFrom = vi.fn();
const mockDbWhere = vi.fn();

vi.mock('../../../../src/db/client.js', () => ({
	getDb: () => ({
		select: mockDbSelect,
	}),
}));

vi.mock('../../../../src/db/schema/index.js', () => ({
	credentials: { id: 'id', orgId: 'org_id', value: 'value' },
}));

const { mockImapConnect, mockImapLogout, MockImapFlow, mockRefreshGmailAccessToken } = vi.hoisted(
	() => {
		const mockImapConnect = vi.fn();
		const mockImapLogout = vi.fn();
		const MockImapFlow = vi.fn().mockImplementation(() => ({
			connect: mockImapConnect,
			logout: mockImapLogout,
		}));
		const mockRefreshGmailAccessToken = vi.fn();
		return { mockImapConnect, mockImapLogout, MockImapFlow, mockRefreshGmailAccessToken };
	},
);

vi.mock('imapflow', () => ({
	ImapFlow: MockImapFlow,
}));

vi.mock('../../../../src/email/gmail/oauth.js', () => ({
	getGmailAuthUrl: vi.fn(),
	exchangeGmailCode: vi.fn(),
	getGmailUserInfo: vi.fn(),
	refreshGmailAccessToken: (...args: unknown[]) => mockRefreshGmailAccessToken(...args),
}));

const mockTrelloGetMe = vi.fn();
const mockTrelloGetBoards = vi.fn();
const mockTrelloGetBoardLists = vi.fn();
const mockTrelloGetBoardLabels = vi.fn();
const mockTrelloGetBoardCustomFields = vi.fn();

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
	},
}));

const mockJiraGetMyself = vi.fn();
const mockJiraSearchProjects = vi.fn();
const mockJiraGetProjectStatuses = vi.fn();
const mockJiraGetIssueTypesForProject = vi.fn();
const mockJiraGetFields = vi.fn();

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
	},
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { integrationsDiscoveryRouter } from '../../../../src/api/routers/integrationsDiscovery.js';

function createCaller(ctx: TRPCContext) {
	return integrationsDiscoveryRouter.createCaller(ctx);
}

const mockUser = createMockUser();

const trelloCredsInput = { apiKeyCredentialId: 1, tokenCredentialId: 2 };
const jiraCredsInput = {
	emailCredentialId: 3,
	apiTokenCredentialId: 4,
	baseUrl: 'https://myorg.atlassian.net',
};

/**
 * Helper: set up the DB mock chain so that resolveCredentialValue succeeds.
 * Each call to getDb().select().from().where() resolves with the given rows.
 * Because procedures resolve two credentials via Promise.all, we queue multiple
 * return values on mockDbWhere.
 */
function setupDbCredentials(rows: Array<{ orgId: string; value: string }>) {
	for (const row of rows) {
		mockDbWhere.mockResolvedValueOnce([row]);
	}
}

describe('integrationsDiscoveryRouter', () => {
	beforeEach(() => {
		mockDbSelect.mockReturnValue({ from: mockDbFrom });
		mockDbFrom.mockReturnValue({ where: mockDbWhere });
		mockImapConnect.mockResolvedValue(undefined);
		mockImapLogout.mockResolvedValue(undefined);
		mockRefreshGmailAccessToken.mockResolvedValue({ accessToken: 'access-token-123' });
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

		it('verifyGmail throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(
				caller.verifyGmail({
					clientIdCredentialId: 10,
					clientSecretCredentialId: 11,
					refreshTokenCredentialId: 12,
					gmailEmailCredentialId: 13,
				}),
			).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});

		it('verifyImap throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(
				caller.verifyImap({
					hostCredentialId: 20,
					portCredentialId: 21,
					usernameCredentialId: 22,
					passwordCredentialId: 23,
				}),
			).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});
	});

	// ── Credential resolution ────────────────────────────────────────────

	describe('credential resolution', () => {
		it('throws NOT_FOUND when credential does not exist', async () => {
			mockDbWhere.mockResolvedValueOnce([]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.verifyTrello(trelloCredsInput)).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws NOT_FOUND when credential belongs to different org', async () => {
			mockDbWhere.mockResolvedValueOnce([{ orgId: 'different-org', value: 'some-key' }]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.verifyTrello(trelloCredsInput)).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('calls decryptCredential with value and orgId', async () => {
			setupDbCredentials([
				{ orgId: 'org-1', value: 'enc:v1:api-key' },
				{ orgId: 'org-1', value: 'enc:v1:token' },
			]);
			mockDecryptCredential.mockReturnValueOnce('decrypted-api-key');
			mockDecryptCredential.mockReturnValueOnce('decrypted-token');
			mockTrelloGetMe.mockResolvedValue({ id: '1', fullName: 'Me', username: 'me' });

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await caller.verifyTrello(trelloCredsInput);

			expect(mockDecryptCredential).toHaveBeenCalledWith('enc:v1:api-key', 'org-1');
			expect(mockDecryptCredential).toHaveBeenCalledWith('enc:v1:token', 'org-1');
		});
	});

	// ── verifyTrello ─────────────────────────────────────────────────────

	describe('verifyTrello', () => {
		it('returns username, fullName, and id on success', async () => {
			setupDbCredentials([
				{ orgId: 'org-1', value: 'api-key' },
				{ orgId: 'org-1', value: 'token' },
			]);
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
			setupDbCredentials([
				{ orgId: 'org-1', value: 'bad-key' },
				{ orgId: 'org-1', value: 'bad-token' },
			]);
			mockTrelloGetMe.mockRejectedValue(new Error('Invalid API key'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.verifyTrello(trelloCredsInput)).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});
	});

	// ── verifyJira ───────────────────────────────────────────────────────

	describe('verifyJira', () => {
		it('returns displayName, emailAddress, and accountId on success', async () => {
			setupDbCredentials([
				{ orgId: 'org-1', value: 'email@example.com' },
				{ orgId: 'org-1', value: 'api-token' },
			]);
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
			setupDbCredentials([
				{ orgId: 'org-1', value: 'email' },
				{ orgId: 'org-1', value: 'token' },
			]);
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
			setupDbCredentials([
				{ orgId: 'org-1', value: 'email' },
				{ orgId: 'org-1', value: 'bad-token' },
			]);
			mockJiraGetMyself.mockRejectedValue(new Error('Unauthorized'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.verifyJira(jiraCredsInput)).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});
	});

	// ── trelloBoards ─────────────────────────────────────────────────────

	describe('trelloBoards', () => {
		it('returns boards list on success', async () => {
			setupDbCredentials([
				{ orgId: 'org-1', value: 'api-key' },
				{ orgId: 'org-1', value: 'token' },
			]);
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
			setupDbCredentials([
				{ orgId: 'org-1', value: 'api-key' },
				{ orgId: 'org-1', value: 'token' },
			]);
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
			setupDbCredentials([
				{ orgId: 'org-1', value: 'api-key' },
				{ orgId: 'org-1', value: 'token' },
			]);
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
			setupDbCredentials([
				{ orgId: 'org-1', value: 'api-key' },
				{ orgId: 'org-1', value: 'token' },
			]);
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
			setupDbCredentials([
				{ orgId: 'org-1', value: 'email' },
				{ orgId: 'org-1', value: 'api-token' },
			]);
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
			setupDbCredentials([
				{ orgId: 'org-1', value: 'email' },
				{ orgId: 'org-1', value: 'api-token' },
			]);
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
			setupDbCredentials([
				{ orgId: 'org-1', value: 'email' },
				{ orgId: 'org-1', value: 'api-token' },
			]);
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
			setupDbCredentials([
				{ orgId: 'org-1', value: 'email' },
				{ orgId: 'org-1', value: 'api-token' },
			]);
			mockJiraGetProjectStatuses.mockRejectedValue(new Error('Project not found'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.jiraProjectDetails({ ...jiraCredsInput, projectKey: 'PROJ' }),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		});
	});

	// ── verifyGmail ───────────────────────────────────────────────────────

	const gmailInput = {
		clientIdCredentialId: 10,
		clientSecretCredentialId: 11,
		refreshTokenCredentialId: 12,
		gmailEmailCredentialId: 13,
	};

	describe('verifyGmail', () => {
		it('resolves all four credentials server-side and returns email', async () => {
			setupDbCredentials([
				{ orgId: 'org-1', value: 'client-id' },
				{ orgId: 'org-1', value: 'client-secret' },
				{ orgId: 'org-1', value: 'refresh-token' },
				{ orgId: 'org-1', value: 'user@gmail.com' },
			]);
			mockRefreshGmailAccessToken.mockResolvedValue({ accessToken: 'access-token-123' });

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.verifyGmail(gmailInput);

			expect(result).toEqual({ success: true, email: 'user@gmail.com' });
			expect(mockRefreshGmailAccessToken).toHaveBeenCalledWith(
				'client-id',
				'client-secret',
				'refresh-token',
			);
		});

		it('passes resolved email as IMAP user (not a credential ID or masked value)', async () => {
			setupDbCredentials([
				{ orgId: 'org-1', value: 'client-id' },
				{ orgId: 'org-1', value: 'client-secret' },
				{ orgId: 'org-1', value: 'refresh-token' },
				{ orgId: 'org-1', value: 'user@gmail.com' },
			]);
			mockRefreshGmailAccessToken.mockResolvedValue({ accessToken: 'tok' });

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await caller.verifyGmail(gmailInput);

			const imapArgs = MockImapFlow.mock.calls[0][0] as { auth: { user: string } };
			expect(imapArgs.auth.user).toBe('user@gmail.com');
		});

		it('wraps token refresh failure in BAD_REQUEST', async () => {
			setupDbCredentials([
				{ orgId: 'org-1', value: 'client-id' },
				{ orgId: 'org-1', value: 'client-secret' },
				{ orgId: 'org-1', value: 'bad-refresh-token' },
				{ orgId: 'org-1', value: 'user@gmail.com' },
			]);
			mockRefreshGmailAccessToken.mockRejectedValue(new Error('invalid_grant'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.verifyGmail(gmailInput)).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});

		it('wraps IMAP connection failure in BAD_REQUEST', async () => {
			setupDbCredentials([
				{ orgId: 'org-1', value: 'client-id' },
				{ orgId: 'org-1', value: 'client-secret' },
				{ orgId: 'org-1', value: 'refresh-token' },
				{ orgId: 'org-1', value: 'user@gmail.com' },
			]);
			mockRefreshGmailAccessToken.mockResolvedValue({ accessToken: 'tok' });
			mockImapConnect.mockRejectedValue(new Error('Connection refused'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.verifyGmail(gmailInput)).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});

		it('rejects input containing a plain email string (schema change guard)', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				// biome-ignore lint/suspicious/noExplicitAny: testing schema rejection of old API shape
				caller.verifyGmail({ ...gmailInput, email: 'user@gmail.com' } as any),
			).rejects.toThrow();
		});
	});

	// ── verifyImap ────────────────────────────────────────────────────────

	const imapInput = {
		hostCredentialId: 20,
		portCredentialId: 21,
		usernameCredentialId: 22,
		passwordCredentialId: 23,
	};

	describe('verifyImap', () => {
		it('resolves all four credentials server-side and returns email', async () => {
			setupDbCredentials([
				{ orgId: 'org-1', value: 'imap.example.com' },
				{ orgId: 'org-1', value: '993' },
				{ orgId: 'org-1', value: 'user@example.com' },
				{ orgId: 'org-1', value: 'secret' },
			]);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.verifyImap(imapInput);

			expect(result).toEqual({ success: true, email: 'user@example.com' });
		});

		it('rejects non-numeric port with BAD_REQUEST', async () => {
			setupDbCredentials([
				{ orgId: 'org-1', value: 'imap.example.com' },
				{ orgId: 'org-1', value: 'not-a-port' },
				{ orgId: 'org-1', value: 'user@example.com' },
				{ orgId: 'org-1', value: 'secret' },
			]);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.verifyImap(imapInput)).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});

		it('wraps IMAP connection failure in BAD_REQUEST', async () => {
			setupDbCredentials([
				{ orgId: 'org-1', value: 'imap.example.com' },
				{ orgId: 'org-1', value: '993' },
				{ orgId: 'org-1', value: 'user@example.com' },
				{ orgId: 'org-1', value: 'wrong-password' },
			]);
			mockImapConnect.mockRejectedValue(new Error('Authentication failed'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.verifyImap(imapInput)).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});
	});
});
