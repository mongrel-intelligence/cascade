import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/github/client.js', () => ({
	githubClient: {
		addIssueCommentReaction: vi.fn(),
		addReviewCommentReaction: vi.fn(),
	},
}));

vi.mock('../../../src/trello/client.js', () => ({
	trelloClient: {
		addActionReaction: vi.fn(),
	},
	getTrelloCredentials: vi.fn(() => ({ apiKey: 'key', token: 'tok' })),
}));

vi.mock('../../../src/jira/client.js', () => ({
	jiraClient: {
		addCommentReaction: vi.fn(),
		addComment: vi.fn(),
		getCloudId: vi.fn(),
	},
	getJiraCredentials: vi.fn(() => ({ email: 'e', apiToken: 't', baseUrl: 'https://jira' })),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
	},
}));

import { githubClient } from '../../../src/github/client.js';
import { jiraClient } from '../../../src/jira/client.js';
import { trelloClient } from '../../../src/trello/client.js';
import { acknowledgeWithReaction } from '../../../src/triggers/shared/acknowledge-reaction.js';

describe('acknowledgeWithReaction', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ── GitHub ──────────────────────────────────────────────

	describe('github', () => {
		it('adds eyes reaction to issue comment payload', async () => {
			const payload = {
				action: 'created',
				issue: { number: 1, title: 'PR', html_url: 'u', pull_request: { url: 'u' } },
				comment: { id: 42, body: '@cascade help', html_url: 'u', user: { login: 'alice' } },
				repository: { full_name: 'owner/repo', html_url: 'u' },
				sender: { login: 'alice' },
			};

			await acknowledgeWithReaction('github', payload);

			expect(githubClient.addIssueCommentReaction).toHaveBeenCalledWith(
				'owner',
				'repo',
				42,
				'eyes',
			);
			expect(githubClient.addReviewCommentReaction).not.toHaveBeenCalled();
		});

		it('adds eyes reaction to PR review comment payload', async () => {
			const payload = {
				action: 'created',
				comment: {
					id: 99,
					body: '@cascade fix this',
					path: 'src/index.ts',
					line: 10,
					user: { login: 'bob' },
					html_url: 'u',
				},
				pull_request: {
					number: 5,
					title: 'PR',
					html_url: 'u',
					head: { ref: 'feat', sha: 'abc' },
					base: { ref: 'main' },
				},
				repository: { full_name: 'owner/repo', html_url: 'u' },
				sender: { login: 'bob' },
			};

			await acknowledgeWithReaction('github', payload);

			expect(githubClient.addReviewCommentReaction).toHaveBeenCalledWith(
				'owner',
				'repo',
				99,
				'eyes',
			);
			expect(githubClient.addIssueCommentReaction).not.toHaveBeenCalled();
		});

		it('does nothing for non-comment GitHub payloads', async () => {
			const payload = {
				action: 'completed',
				check_suite: {
					id: 1,
					status: 'completed',
					conclusion: 'success',
					head_sha: 'abc',
					pull_requests: [],
				},
				repository: { full_name: 'owner/repo', html_url: 'u' },
				sender: { login: 'x' },
			};

			await acknowledgeWithReaction('github', payload);

			expect(githubClient.addIssueCommentReaction).not.toHaveBeenCalled();
			expect(githubClient.addReviewCommentReaction).not.toHaveBeenCalled();
		});

		it('does not throw when reaction API fails', async () => {
			vi.mocked(githubClient.addIssueCommentReaction).mockRejectedValue(new Error('403'));

			const payload = {
				action: 'created',
				issue: { number: 1, title: 'PR', html_url: 'u', pull_request: { url: 'u' } },
				comment: { id: 42, body: 'hi', html_url: 'u', user: { login: 'a' } },
				repository: { full_name: 'owner/repo', html_url: 'u' },
				sender: { login: 'a' },
			};

			await expect(acknowledgeWithReaction('github', payload)).resolves.toBeUndefined();
		});
	});

	// ── Trello ──────────────────────────────────────────────

	describe('trello', () => {
		it('adds eyes reaction to commentCard action', async () => {
			const payload = {
				model: { id: 'board-1', name: 'Board' },
				action: {
					id: 'action-1',
					idMemberCreator: 'm1',
					type: 'commentCard',
					date: '2024-01-01',
					data: { text: 'hello', card: { id: 'c1', name: 'Card', idShort: 1, shortLink: 'sl' } },
				},
			};

			await acknowledgeWithReaction('trello', payload);

			expect(trelloClient.addActionReaction).toHaveBeenCalledWith('action-1', {
				shortName: 'eyes',
				native: '👀',
				unified: '1f440',
			});
		});

		it('does nothing for non-comment Trello actions', async () => {
			const payload = {
				model: { id: 'board-1', name: 'Board' },
				action: {
					id: 'action-1',
					idMemberCreator: 'm1',
					type: 'updateCard',
					date: '2024-01-01',
					data: {},
				},
			};

			await acknowledgeWithReaction('trello', payload);

			expect(trelloClient.addActionReaction).not.toHaveBeenCalled();
		});

		it('does nothing for invalid Trello payload', async () => {
			await acknowledgeWithReaction('trello', { random: true });

			expect(trelloClient.addActionReaction).not.toHaveBeenCalled();
		});

		it('does not throw when Trello reaction API fails', async () => {
			vi.mocked(trelloClient.addActionReaction).mockRejectedValue(new Error('400'));

			const payload = {
				model: { id: 'board-1', name: 'Board' },
				action: {
					id: 'action-1',
					idMemberCreator: 'm1',
					type: 'commentCard',
					date: '2024-01-01',
					data: { text: 'hi' },
				},
			};

			await expect(acknowledgeWithReaction('trello', payload)).resolves.toBeUndefined();
		});
	});

	// ── JIRA ────────────────────────────────────────────────

	describe('jira', () => {
		it('adds reaction to JIRA comment when issue.id and comment.id present', async () => {
			vi.mocked(jiraClient.addCommentReaction).mockResolvedValue(undefined);

			const payload = {
				webhookEvent: 'comment_created',
				issue: { id: '10001', key: 'PROJ-1' },
				comment: { id: '20001', body: { type: 'doc' }, author: { displayName: 'Alice' } },
			};

			await acknowledgeWithReaction('jira', payload);

			expect(jiraClient.addCommentReaction).toHaveBeenCalledWith(
				'10001',
				'20001',
				'atlassian-eyes',
			);
			expect(jiraClient.addComment).not.toHaveBeenCalled();
		});

		it('does not fall back to comment when reaction API fails', async () => {
			vi.mocked(jiraClient.addCommentReaction).mockRejectedValue(new Error('404'));

			const payload = {
				webhookEvent: 'comment_created',
				issue: { id: '10001', key: 'PROJ-1' },
				comment: { id: '20001', body: { type: 'doc' } },
			};

			await acknowledgeWithReaction('jira', payload);

			expect(jiraClient.addCommentReaction).toHaveBeenCalled();
			expect(jiraClient.addComment).not.toHaveBeenCalled();
		});

		it('does nothing when comment.id is missing', async () => {
			const payload = {
				webhookEvent: 'comment_created',
				issue: { id: '10001', key: 'PROJ-1' },
				comment: { body: { type: 'doc' } },
			};

			await acknowledgeWithReaction('jira', payload);

			expect(jiraClient.addCommentReaction).not.toHaveBeenCalled();
			expect(jiraClient.addComment).not.toHaveBeenCalled();
		});

		it('does nothing when issue.id is missing', async () => {
			const payload = {
				webhookEvent: 'comment_created',
				issue: { key: 'PROJ-1' },
				comment: { id: '20001', body: { type: 'doc' } },
			};

			await acknowledgeWithReaction('jira', payload);

			expect(jiraClient.addCommentReaction).not.toHaveBeenCalled();
			expect(jiraClient.addComment).not.toHaveBeenCalled();
		});

		it('does not throw when reaction API fails', async () => {
			vi.mocked(jiraClient.addCommentReaction).mockRejectedValue(new Error('404'));

			const payload = {
				webhookEvent: 'comment_created',
				issue: { id: '10001', key: 'PROJ-1' },
				comment: { id: '20001', body: { type: 'doc' } },
			};

			await expect(acknowledgeWithReaction('jira', payload)).resolves.toBeUndefined();
		});
	});
});
