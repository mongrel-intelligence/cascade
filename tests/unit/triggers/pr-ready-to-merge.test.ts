import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRReadyToMergeTrigger } from '../../../src/triggers/github/pr-ready-to-merge.js';
import type { TriggerContext } from '../../../src/triggers/types.js';

vi.mock('../../../src/github/client.js', () => ({
	githubClient: {
		getPR: vi.fn(),
		getCheckSuiteStatus: vi.fn(),
		getPRReviews: vi.fn(),
	},
}));

vi.mock('../../../src/trello/client.js', () => ({
	trelloClient: {
		moveCardToList: vi.fn(),
		addComment: vi.fn(),
	},
}));

import { githubClient } from '../../../src/github/client.js';
import { trelloClient } from '../../../src/trello/client.js';

describe('PRReadyToMergeTrigger', () => {
	const trigger = new PRReadyToMergeTrigger();

	const mockProject = {
		id: 'test',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		githubTokenEnv: 'GITHUB_TOKEN',
		trello: {
			boardId: 'board123',
			lists: {
				briefing: 'briefing-list-id',
				planning: 'planning-list-id',
				todo: 'todo-list-id',
				done: 'done-list-id',
			},
			labels: {},
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('matches', () => {
		it('matches check_suite completed with success and PRs', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'completed',
					check_suite: {
						id: 1,
						status: 'completed',
						conclusion: 'success',
						head_sha: 'sha123',
						pull_requests: [{ number: 42, head: { ref: 'feat', sha: 'sha123' } }],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
			};

			expect(trigger.matches(ctx)).toBe(true);
		});

		it('matches review submitted with approved state', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'submitted',
					review: {
						id: 100,
						state: 'approved',
						body: 'LGTM',
						html_url: 'https://github.com/...',
						user: { login: 'reviewer' },
					},
					pull_request: {
						number: 42,
						title: 'PR',
						body: 'desc',
						html_url: 'https://github.com/...',
						head: { ref: 'feat', sha: 'abc' },
						base: { ref: 'main' },
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'reviewer' },
				},
			};

			expect(trigger.matches(ctx)).toBe(true);
		});

		it('does not match trello source', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match check_suite with failure', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'completed',
					check_suite: {
						id: 1,
						status: 'completed',
						conclusion: 'failure',
						head_sha: 'sha123',
						pull_requests: [{ number: 42, head: { ref: 'feat', sha: 'sha123' } }],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match check_suite with no PRs', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'completed',
					check_suite: {
						id: 1,
						status: 'completed',
						conclusion: 'success',
						head_sha: 'sha123',
						pull_requests: [],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match review with changes_requested', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'submitted',
					review: {
						id: 100,
						state: 'changes_requested',
						body: 'Fix this',
						html_url: 'https://github.com/...',
						user: { login: 'reviewer' },
					},
					pull_request: {
						number: 42,
						title: 'PR',
						body: 'desc',
						html_url: 'https://github.com/...',
						head: { ref: 'feat', sha: 'abc' },
						base: { ref: 'main' },
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'reviewer' },
				},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match unrelated github events', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'opened',
					number: 42,
					pull_request: {
						number: 42,
						title: 'PR',
						body: 'desc',
						html_url: 'https://github.com/...',
						state: 'open',
						draft: false,
						head: { ref: 'feat', sha: 'abc' },
						base: { ref: 'main' },
						user: { login: 'author' },
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'author' },
				},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});
	});

	describe('handle', () => {
		it('moves card to DONE when check_suite triggers and all conditions met', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
			});
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: true,
				totalCount: 2,
				checkRuns: [
					{ name: 'lint', status: 'completed', conclusion: 'success' },
					{ name: 'test', status: 'completed', conclusion: 'success' },
				],
			});
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([
				{
					id: 1,
					state: 'approved',
					body: 'LGTM',
					user: { login: 'reviewer' },
					submitted_at: '2024-01-01',
				},
			]);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'completed',
					check_suite: {
						id: 1,
						status: 'completed',
						conclusion: 'success',
						head_sha: 'sha123',
						pull_requests: [{ number: 42, head: { ref: 'feature/test', sha: 'sha123' } }],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
			};

			const result = await trigger.handle(ctx);

			expect(trelloClient.moveCardToList).toHaveBeenCalledWith('abc123', 'done-list-id');
			expect(trelloClient.addComment).toHaveBeenCalledWith(
				'abc123',
				'PR #42 approved and all checks passing - moved to DONE',
			);
			expect(result).toEqual({
				agentType: '',
				agentInput: {},
				cardId: 'abc123',
				prNumber: 42,
			});
		});

		it('moves card to DONE when review approved triggers and all conditions met', async () => {
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: true,
				totalCount: 2,
				checkRuns: [
					{ name: 'lint', status: 'completed', conclusion: 'success' },
					{ name: 'test', status: 'completed', conclusion: 'success' },
				],
			});
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([
				{
					id: 1,
					state: 'approved',
					body: 'LGTM',
					user: { login: 'reviewer' },
					submitted_at: '2024-01-01',
				},
			]);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'submitted',
					review: {
						id: 100,
						state: 'approved',
						body: 'LGTM',
						html_url: 'https://github.com/...',
						user: { login: 'reviewer' },
					},
					pull_request: {
						number: 42,
						title: 'Test PR',
						body: 'https://trello.com/c/abc123/card-name',
						html_url: 'https://github.com/...',
						head: { ref: 'feature/test', sha: 'sha123' },
						base: { ref: 'main' },
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'reviewer' },
				},
			};

			const result = await trigger.handle(ctx);

			expect(trelloClient.moveCardToList).toHaveBeenCalledWith('abc123', 'done-list-id');
			expect(result?.cardId).toBe('abc123');
		});

		it('returns null when PR has no Trello URL (check_suite path)', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'No Trello link',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'completed',
					check_suite: {
						id: 1,
						status: 'completed',
						conclusion: 'success',
						head_sha: 'sha123',
						pull_requests: [{ number: 42, head: { ref: 'feat', sha: 'sha123' } }],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
			expect(trelloClient.moveCardToList).not.toHaveBeenCalled();
		});

		it('returns null when checks are not all passing', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
			});
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: false,
				totalCount: 2,
				checkRuns: [
					{ name: 'lint', status: 'completed', conclusion: 'success' },
					{ name: 'test', status: 'completed', conclusion: 'failure' },
				],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'completed',
					check_suite: {
						id: 1,
						status: 'completed',
						conclusion: 'success',
						head_sha: 'sha123',
						pull_requests: [{ number: 42, head: { ref: 'feat', sha: 'sha123' } }],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
			expect(trelloClient.moveCardToList).not.toHaveBeenCalled();
		});

		it('returns null when no approval exists', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
			});
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: true,
				totalCount: 1,
				checkRuns: [{ name: 'test', status: 'completed', conclusion: 'success' }],
			});
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([
				{
					id: 1,
					state: 'commented',
					body: 'Looks ok',
					user: { login: 'reviewer' },
					submitted_at: '2024-01-01',
				},
			]);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'completed',
					check_suite: {
						id: 1,
						status: 'completed',
						conclusion: 'success',
						head_sha: 'sha123',
						pull_requests: [{ number: 42, head: { ref: 'feat', sha: 'sha123' } }],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('returns null when there are outstanding change requests', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
			});
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: true,
				totalCount: 1,
				checkRuns: [{ name: 'test', status: 'completed', conclusion: 'success' }],
			});
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([
				{
					id: 1,
					state: 'approved',
					body: 'LGTM',
					user: { login: 'reviewer1' },
					submitted_at: '2024-01-01',
				},
				{
					id: 2,
					state: 'changes_requested',
					body: 'Fix this',
					user: { login: 'reviewer2' },
					submitted_at: '2024-01-02',
				},
			]);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'completed',
					check_suite: {
						id: 1,
						status: 'completed',
						conclusion: 'success',
						head_sha: 'sha123',
						pull_requests: [{ number: 42, head: { ref: 'feat', sha: 'sha123' } }],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('returns null when done list is not configured', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
			});
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: true,
				totalCount: 1,
				checkRuns: [{ name: 'test', status: 'completed', conclusion: 'success' }],
			});
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([
				{
					id: 1,
					state: 'approved',
					body: 'LGTM',
					user: { login: 'reviewer' },
					submitted_at: '2024-01-01',
				},
			]);

			const projectWithoutDone = {
				...mockProject,
				trello: {
					...mockProject.trello,
					lists: {
						briefing: 'briefing-list-id',
						planning: 'planning-list-id',
						todo: 'todo-list-id',
						// no done list
					},
				},
			};

			const ctx: TriggerContext = {
				project: projectWithoutDone,
				source: 'github',
				payload: {
					action: 'completed',
					check_suite: {
						id: 1,
						status: 'completed',
						conclusion: 'success',
						head_sha: 'sha123',
						pull_requests: [{ number: 42, head: { ref: 'feat', sha: 'sha123' } }],
					},
					repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
					sender: { login: 'github-actions' },
				},
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
			expect(trelloClient.moveCardToList).not.toHaveBeenCalled();
		});
	});
});
