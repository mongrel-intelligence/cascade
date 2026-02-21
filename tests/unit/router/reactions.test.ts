import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock config provider
vi.mock('../../../src/config/provider.js', () => ({
	getIntegrationCredential: vi.fn(),
	findProjectByRepo: vi.fn(),
	findProjectById: vi.fn(),
}));

// Mock getProjectGitHubToken
vi.mock('../../../src/config/projects.js', () => ({
	getProjectGitHubToken: vi.fn(),
}));

// Mock config cache (imported transitively)
vi.mock('../../../src/config/configCache.js', () => ({
	configCache: {
		getSecrets: vi.fn().mockReturnValue(null),
		getConfig: vi.fn().mockReturnValue(null),
		getProjectByBoardId: vi.fn().mockReturnValue(null),
		getProjectByRepo: vi.fn().mockReturnValue(null),
		setConfig: vi.fn(),
		setProjectByBoardId: vi.fn(),
		setProjectByRepo: vi.fn(),
		setSecrets: vi.fn(),
		invalidate: vi.fn(),
	},
}));

// Mock trello client
vi.mock('../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn(async (_creds: unknown, fn: () => Promise<unknown>) => fn()),
	trelloClient: {
		addActionReaction: vi.fn(),
	},
}));

import { getProjectGitHubToken } from '../../../src/config/projects.js';
import {
	findProjectById,
	findProjectByRepo,
	getIntegrationCredential,
} from '../../../src/config/provider.js';
import type { PersonaIdentities } from '../../../src/github/personas.js';
import { _resetJiraCloudIdCache, sendAcknowledgeReaction } from '../../../src/router/reactions.js';
import { trelloClient, withTrelloCredentials } from '../../../src/trello/client.js';
import type { ProjectConfig } from '../../../src/types/index.js';

const mockGetIntegrationCredential = vi.mocked(getIntegrationCredential);
const mockGetProjectGitHubToken = vi.mocked(getProjectGitHubToken);
const mockFindProjectByRepo = vi.mocked(findProjectByRepo);
const mockFindProjectById = vi.mocked(findProjectById);
const mockAddActionReaction = vi.mocked(trelloClient.addActionReaction);
const mockWithTrelloCredentials = vi.mocked(withTrelloCredentials);

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const PROJECT_ID = 'test-project';
const REPO_FULL_NAME = 'owner/repo';

const MOCK_CREDENTIALS: Record<string, string> = {
	'pm/api_key': 'test-trello-key',
	'pm/token': 'test-trello-token',
	'pm/email': 'bot@example.com',
	'pm/api_token': 'test-jira-token',
};

const PERSONA_IDENTITIES: PersonaIdentities = {
	implementer: 'implementer-bot',
	reviewer: 'reviewer-bot',
};

const MOCK_PROJECT = {
	id: PROJECT_ID,
	name: 'Test',
	repo: REPO_FULL_NAME,
	baseBranch: 'main',
	branchPrefix: 'feature/',
	trello: { boardId: 'b1', lists: {}, labels: {} },
} as ProjectConfig;

const TRELLO_COMMENT_PAYLOAD = {
	model: { id: 'board123', name: 'Test Board' },
	action: {
		id: 'action123',
		type: 'commentCard',
		data: { card: { id: 'card123', name: 'Test Card', idShort: 1, shortLink: 'abc' } },
	},
};

const GITHUB_ISSUE_COMMENT_PAYLOAD = {
	action: 'created',
	issue: { number: 42, title: 'Test Issue', html_url: 'https://github.com/owner/repo/issues/42' },
	comment: {
		id: 99,
		body: '@implementer-bot please help',
		html_url: 'https://github.com/owner/repo/issues/42#issuecomment-99',
		user: { login: 'user' },
	},
	repository: { full_name: REPO_FULL_NAME, html_url: 'https://github.com/owner/repo' },
	sender: { login: 'user' },
};

const GITHUB_PR_REVIEW_COMMENT_PAYLOAD = {
	action: 'created',
	pull_request: {
		number: 7,
		title: 'My PR',
		html_url: 'https://github.com/owner/repo/pull/7',
		head: { ref: 'feature/x', sha: 'abc' },
		base: { ref: 'main' },
	},
	comment: {
		id: 55,
		body: '@implementer-bot review this',
		path: 'src/file.ts',
		line: 10,
		user: { login: 'external-user' },
		html_url: 'https://github.com/owner/repo/pull/7#issuecomment-55',
	},
	repository: { full_name: REPO_FULL_NAME, html_url: 'https://github.com/owner/repo' },
	sender: { login: 'external-user' },
};

const JIRA_COMMENT_PAYLOAD = {
	webhookEvent: 'comment_created',
	issue: { id: 'issue-id-123', key: 'PROJ-42' },
	comment: { id: 'comment-id-456' },
};

describe('sendAcknowledgeReaction', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		mockAddActionReaction.mockReset();
		mockWithTrelloCredentials.mockReset();
		mockWithTrelloCredentials.mockImplementation(async (_creds, fn) => fn());
		_resetJiraCloudIdCache();
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});

		// Default credential mocks
		mockGetIntegrationCredential.mockImplementation(async (_projectId, category, role) => {
			const value = MOCK_CREDENTIALS[`${category}/${role}`];
			if (value) return value;
			throw new Error(`Credential '${category}/${role}' not found`);
		});

		mockFindProjectById.mockResolvedValue({
			id: PROJECT_ID,
			name: 'Test',
			repo: REPO_FULL_NAME,
			baseBranch: 'main',
			branchPrefix: 'feature/',
			trello: { boardId: 'b1', lists: {}, labels: {} },
			jira: { baseUrl: 'https://test.atlassian.net', projectKey: 'PROJ', statuses: {}, labels: {} },
		});

		mockGetProjectGitHubToken.mockResolvedValue('test-github-token');

		mockFindProjectByRepo.mockResolvedValue({
			id: PROJECT_ID,
			name: 'Test',
			repo: REPO_FULL_NAME,
			baseBranch: 'main',
			branchPrefix: 'feature/',
			trello: { boardId: 'b1', lists: {}, labels: {} },
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// -------------------------------------------------------------------------
	// Trello
	// -------------------------------------------------------------------------

	describe('Trello reactions', () => {
		it('sends 👀 reaction for commentCard action', async () => {
			mockAddActionReaction.mockResolvedValueOnce(undefined);

			await sendAcknowledgeReaction('trello', PROJECT_ID, TRELLO_COMMENT_PAYLOAD);

			expect(mockAddActionReaction).toHaveBeenCalledOnce();
			expect(mockAddActionReaction).toHaveBeenCalledWith('action123', {
				shortName: 'eyes',
				native: '👀',
				unified: '1f440',
			});
		});

		it('skips reaction for non-commentCard Trello action', async () => {
			const payload = {
				model: { id: 'board123', name: 'Test Board' },
				action: { id: 'action456', type: 'updateCard', data: {} },
			};

			await sendAcknowledgeReaction('trello', PROJECT_ID, payload);

			expect(mockAddActionReaction).not.toHaveBeenCalled();
		});

		it('skips reaction when Trello credentials are missing', async () => {
			mockGetIntegrationCredential.mockRejectedValue(new Error('Credential not found'));

			await sendAcknowledgeReaction('trello', PROJECT_ID, TRELLO_COMMENT_PAYLOAD);

			expect(mockAddActionReaction).not.toHaveBeenCalled();
			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining('Missing Trello credentials'),
			);
		});

		it('logs warning on Trello API error but does not throw', async () => {
			mockAddActionReaction.mockRejectedValueOnce(
				new Error('Failed to add reaction to action: 401'),
			);

			await expect(
				sendAcknowledgeReaction('trello', PROJECT_ID, TRELLO_COMMENT_PAYLOAD),
			).resolves.toBeUndefined();

			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining('Trello reaction failed'),
				expect.stringContaining('401'),
			);
		});

		it('skips non-comment actions without fetching credentials', async () => {
			const payload = {
				model: { id: 'board123', name: 'Test Board' },
				action: { id: 'a1', type: 'addLabelToCard', data: {} },
			};

			await sendAcknowledgeReaction('trello', PROJECT_ID, payload);

			expect(mockAddActionReaction).not.toHaveBeenCalled();
			expect(mockGetIntegrationCredential).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------------
	// GitHub
	// -------------------------------------------------------------------------

	describe('GitHub reactions', () => {
		it('sends 👀 reaction on issue_comment payload with @mention', async () => {
			mockFetch.mockResolvedValueOnce({ ok: true });

			await sendAcknowledgeReaction(
				'github',
				REPO_FULL_NAME,
				GITHUB_ISSUE_COMMENT_PAYLOAD,
				PERSONA_IDENTITIES,
				MOCK_PROJECT,
			);

			expect(mockFetch).toHaveBeenCalledOnce();
			const [url, options] = mockFetch.mock.calls[0];
			expect(url).toBe('https://api.github.com/repos/owner/repo/issues/comments/99/reactions');
			expect(options.method).toBe('POST');
			expect(options.headers.Authorization).toBe('Bearer test-github-token');
			expect(JSON.parse(options.body)).toEqual({ content: 'eyes' });
		});

		it('sends 👀 reaction on pull_request_review_comment payload with @mention', async () => {
			mockFetch.mockResolvedValueOnce({ ok: true });

			await sendAcknowledgeReaction(
				'github',
				REPO_FULL_NAME,
				GITHUB_PR_REVIEW_COMMENT_PAYLOAD,
				PERSONA_IDENTITIES,
				MOCK_PROJECT,
			);

			expect(mockFetch).toHaveBeenCalledOnce();
			const [url, options] = mockFetch.mock.calls[0];
			expect(url).toBe('https://api.github.com/repos/owner/repo/pulls/comments/55/reactions');
			expect(options.method).toBe('POST');
			expect(JSON.parse(options.body)).toEqual({ content: 'eyes' });
		});

		it('skips reaction when no personaIdentities provided', async () => {
			await sendAcknowledgeReaction('github', REPO_FULL_NAME, GITHUB_ISSUE_COMMENT_PAYLOAD);

			expect(mockFetch).not.toHaveBeenCalled();
			expect(console.log).toHaveBeenCalledWith(
				expect.stringContaining('No persona identities provided'),
			);
		});

		it('skips reaction when comment has no @implementer mention', async () => {
			const payloadNoMention = {
				...GITHUB_ISSUE_COMMENT_PAYLOAD,
				comment: {
					...GITHUB_ISSUE_COMMENT_PAYLOAD.comment,
					body: 'Just a random comment without any mention',
				},
			};

			await sendAcknowledgeReaction(
				'github',
				REPO_FULL_NAME,
				payloadNoMention,
				PERSONA_IDENTITIES,
				MOCK_PROJECT,
			);

			expect(mockFetch).not.toHaveBeenCalled();
			expect(console.log).toHaveBeenCalledWith(expect.stringContaining('no @implementer mention'));
		});

		it('skips reaction when comment author is a CASCADE bot (bot self-comment)', async () => {
			const botCommentPayload = {
				...GITHUB_ISSUE_COMMENT_PAYLOAD,
				comment: {
					...GITHUB_ISSUE_COMMENT_PAYLOAD.comment,
					body: '@implementer-bot please help',
					user: { login: 'implementer-bot' }, // bot is the commenter
				},
			};

			await sendAcknowledgeReaction(
				'github',
				REPO_FULL_NAME,
				botCommentPayload,
				PERSONA_IDENTITIES,
				MOCK_PROJECT,
			);

			expect(mockFetch).not.toHaveBeenCalled();
			expect(console.log).toHaveBeenCalledWith(
				expect.stringContaining('comment is from a CASCADE bot'),
				expect.objectContaining({ commenter: 'implementer-bot' }),
			);
		});

		it('skips reaction when reviewer bot is the commenter', async () => {
			const reviewerCommentPayload = {
				...GITHUB_ISSUE_COMMENT_PAYLOAD,
				comment: {
					...GITHUB_ISSUE_COMMENT_PAYLOAD.comment,
					body: '@implementer-bot please fix this',
					user: { login: 'reviewer-bot' },
				},
			};

			await sendAcknowledgeReaction(
				'github',
				REPO_FULL_NAME,
				reviewerCommentPayload,
				PERSONA_IDENTITIES,
				MOCK_PROJECT,
			);

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('skips reaction for non-comment GitHub events (e.g. check_suite)', async () => {
			const payload = {
				action: 'completed',
				check_suite: { id: 1, status: 'completed', conclusion: 'success', pull_requests: [] },
				repository: { full_name: REPO_FULL_NAME },
			};

			await sendAcknowledgeReaction(
				'github',
				REPO_FULL_NAME,
				payload,
				PERSONA_IDENTITIES,
				MOCK_PROJECT,
			);

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('skips reaction for pull_request event (no comment)', async () => {
			const payload = {
				action: 'opened',
				number: 10,
				pull_request: {
					number: 10,
					title: 'PR',
					head: { ref: 'f', sha: 'x' },
					base: { ref: 'main' },
				},
				repository: { full_name: REPO_FULL_NAME },
			};

			await sendAcknowledgeReaction(
				'github',
				REPO_FULL_NAME,
				payload,
				PERSONA_IDENTITIES,
				MOCK_PROJECT,
			);

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('skips reaction when no project provided', async () => {
			await sendAcknowledgeReaction(
				'github',
				REPO_FULL_NAME,
				GITHUB_ISSUE_COMMENT_PAYLOAD,
				PERSONA_IDENTITIES,
				// no project passed
			);

			expect(mockFetch).not.toHaveBeenCalled();
			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining('No project provided'),
				expect.objectContaining({ repoFullName: REPO_FULL_NAME }),
			);
		});

		it('skips reaction when GitHub token is missing', async () => {
			mockGetProjectGitHubToken.mockRejectedValueOnce(new Error('Missing GITHUB_TOKEN'));

			await sendAcknowledgeReaction(
				'github',
				REPO_FULL_NAME,
				GITHUB_ISSUE_COMMENT_PAYLOAD,
				PERSONA_IDENTITIES,
				MOCK_PROJECT,
			);

			expect(mockFetch).not.toHaveBeenCalled();
			expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Missing GitHub token'));
		});

		it('logs warning on GitHub API error but does not throw', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 403,
				text: async () => 'Forbidden',
			});

			await expect(
				sendAcknowledgeReaction(
					'github',
					REPO_FULL_NAME,
					GITHUB_ISSUE_COMMENT_PAYLOAD,
					PERSONA_IDENTITIES,
					MOCK_PROJECT,
				),
			).resolves.toBeUndefined();

			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining('GitHub reaction failed'),
				403,
				'Forbidden',
			);
		});

		it('reacts to @mention with case-insensitive match', async () => {
			mockFetch.mockResolvedValueOnce({ ok: true });

			const caseInsensitivePayload = {
				...GITHUB_ISSUE_COMMENT_PAYLOAD,
				comment: {
					...GITHUB_ISSUE_COMMENT_PAYLOAD.comment,
					body: '@IMPLEMENTER-BOT can you look at this?',
				},
			};

			await sendAcknowledgeReaction(
				'github',
				REPO_FULL_NAME,
				caseInsensitivePayload,
				PERSONA_IDENTITIES,
				MOCK_PROJECT,
			);

			expect(mockFetch).toHaveBeenCalledOnce();
		});
	});

	// -------------------------------------------------------------------------
	// JIRA
	// -------------------------------------------------------------------------

	describe('JIRA reactions', () => {
		it('sends 💭 reaction via reactions API when cloudId is available', async () => {
			// First fetch: tenant_info → cloudId
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ cloudId: 'cloud-abc' }),
			});
			// Second fetch: PUT reaction
			mockFetch.mockResolvedValueOnce({ ok: true });

			await sendAcknowledgeReaction('jira', PROJECT_ID, JIRA_COMMENT_PAYLOAD);

			expect(mockFetch).toHaveBeenCalledTimes(2);

			const [tenantUrl] = mockFetch.mock.calls[0];
			expect(tenantUrl).toBe('https://test.atlassian.net/_edge/tenant_info');

			const [reactionUrl, reactionOptions] = mockFetch.mock.calls[1];
			expect(reactionUrl).toContain('/rest/reactions/1.0/reactions/');
			expect(reactionUrl).toContain('cloud-abc');
			expect(reactionUrl).toContain('issue-id-123');
			expect(reactionUrl).toContain('comment-id-456');
			expect(reactionUrl).toContain('atlassian-thought_balloon');
			expect(reactionOptions.method).toBe('PUT');
			expect(reactionOptions.headers.Authorization).toMatch(/^Basic /);
		});

		it('caches cloudId between calls', async () => {
			// First call: tenant_info + reaction
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ cloudId: 'cloud-xyz' }),
			});
			mockFetch.mockResolvedValueOnce({ ok: true });

			await sendAcknowledgeReaction('jira', PROJECT_ID, JIRA_COMMENT_PAYLOAD);

			// Second call: only reaction (cloudId cached)
			mockFetch.mockResolvedValueOnce({ ok: true });
			await sendAcknowledgeReaction('jira', PROJECT_ID, JIRA_COMMENT_PAYLOAD);

			// tenant_info called only once across both reaction calls
			const tenantCalls = mockFetch.mock.calls.filter(([url]) =>
				(url as string).includes('tenant_info'),
			);
			expect(tenantCalls).toHaveLength(1);
		});

		it('skips gracefully when reactions API fails (no fallback comment)', async () => {
			// tenant_info
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ cloudId: 'cloud-abc' }),
			});
			// reactions API fails
			mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

			await sendAcknowledgeReaction('jira', PROJECT_ID, JIRA_COMMENT_PAYLOAD);

			// Only 2 calls: tenant_info + reactions API. No fallback comment.
			expect(mockFetch).toHaveBeenCalledTimes(2);
			const fallbackCall = mockFetch.mock.calls.find(([url]) =>
				(url as string).includes('/rest/api/2/issue/'),
			);
			expect(fallbackCall).toBeUndefined();
		});

		it('skips gracefully when cloudId fetch fails (no fallback comment)', async () => {
			// tenant_info fetch fails (network error)
			mockFetch.mockRejectedValueOnce(new Error('Network error'));

			await sendAcknowledgeReaction('jira', PROJECT_ID, JIRA_COMMENT_PAYLOAD);

			// Only 1 call: tenant_info. No fallback comment posted.
			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it('skips reaction when issue.id or comment.id are missing', async () => {
			const payload = { webhookEvent: 'jira:issue_updated', issue: { id: 'x' } }; // no comment

			await sendAcknowledgeReaction('jira', PROJECT_ID, payload);

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('skips reaction when JIRA credentials are missing', async () => {
			mockGetIntegrationCredential.mockRejectedValue(new Error('Credential not found'));

			await sendAcknowledgeReaction('jira', PROJECT_ID, JIRA_COMMENT_PAYLOAD);

			expect(mockFetch).not.toHaveBeenCalled();
			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining('Missing JIRA credentials'),
			);
		});

		it('does not throw when credentials are missing', async () => {
			mockGetIntegrationCredential.mockRejectedValue(new Error('Credential not found'));

			await expect(
				sendAcknowledgeReaction('jira', PROJECT_ID, JIRA_COMMENT_PAYLOAD),
			).resolves.toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// Error handling (top-level)
	// -------------------------------------------------------------------------

	describe('error handling', () => {
		it('catches unexpected errors without throwing', async () => {
			mockGetIntegrationCredential.mockImplementation(() => {
				throw new Error('Unexpected sync error');
			});

			await expect(
				sendAcknowledgeReaction('trello', PROJECT_ID, TRELLO_COMMENT_PAYLOAD),
			).resolves.toBeUndefined();
		});
	});
});
