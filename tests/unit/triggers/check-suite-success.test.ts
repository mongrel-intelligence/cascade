import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckSuiteSuccessTrigger } from '../../../src/triggers/github/check-suite-success.js';
import type { TriggerContext } from '../../../src/triggers/types.js';

vi.mock('../../../src/github/client.js', () => ({
	githubClient: {
		getPR: vi.fn(),
		getPRReviews: vi.fn(),
		getCheckSuiteStatus: vi.fn(),
	},
	getAuthenticatedUser: vi.fn(),
}));

import { getAuthenticatedUser, githubClient } from '../../../src/github/client.js';

describe('CheckSuiteSuccessTrigger', () => {
	const trigger = new CheckSuiteSuccessTrigger();

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
			},
			labels: {},
		},
	};

	const makeCheckSuitePayload = (overrides: Record<string, unknown> = {}) => ({
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
		...overrides,
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('matches', () => {
		it('matches completed check suite with success conclusion and PRs', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
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

		it('does not match non-completed action', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload({
					action: 'requested',
				}),
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match failure conclusion', () => {
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

		it('does not match when no PRs associated', () => {
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
	});

	describe('handle', () => {
		it('returns review result when PR has Trello URL and all checks pass', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'closed',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
			});
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([]);
			vi.mocked(getAuthenticatedUser).mockResolvedValue('cascade-bot');
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: true,
				totalCount: 2,
				checkRuns: [
					{ name: 'lint', status: 'completed', conclusion: 'success' },
					{ name: 'test', status: 'completed', conclusion: 'success' },
				],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
			};

			const result = await trigger.handle(ctx);

			expect(githubClient.getPR).toHaveBeenCalledWith('owner', 'repo', 42);
			expect(githubClient.getCheckSuiteStatus).toHaveBeenCalledWith('owner', 'repo', 'sha123');
			expect(result).toEqual({
				agentType: 'review',
				agentInput: {
					prNumber: 42,
					prBranch: 'feature/test',
					repoFullName: 'owner/repo',
					headSha: 'sha123',
					triggerType: 'ci-success',
					cardId: 'abc123',
				},
				prNumber: 42,
				cardId: 'abc123',
			});
		});

		it('returns null when PR has no Trello URL', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'No Trello link here',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
			expect(githubClient.getCheckSuiteStatus).not.toHaveBeenCalled();
		});

		it('returns null when not all checks are passing', async () => {
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
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([]);
			vi.mocked(getAuthenticatedUser).mockResolvedValue('cascade-bot');
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
				payload: makeCheckSuitePayload(),
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('returns null when PR was already reviewed by us', async () => {
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
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([
				{ id: 1, user: { login: 'cascade-bot' }, state: 'approved', body: 'LGTM', submittedAt: '' },
			]);
			vi.mocked(getAuthenticatedUser).mockResolvedValue('cascade-bot');

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
			expect(githubClient.getCheckSuiteStatus).not.toHaveBeenCalled();
		});

		it('proceeds when PR has reviews from other users only', async () => {
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
			vi.mocked(githubClient.getPRReviews).mockResolvedValue([
				{
					id: 1,
					user: { login: 'human-reviewer' },
					state: 'commented',
					body: 'Nice work',
					submittedAt: '',
				},
			]);
			vi.mocked(getAuthenticatedUser).mockResolvedValue('cascade-bot');
			vi.mocked(githubClient.getCheckSuiteStatus).mockResolvedValue({
				allPassing: true,
				totalCount: 1,
				checkRuns: [{ name: 'test', status: 'completed', conclusion: 'success' }],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeCheckSuitePayload(),
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('review');
		});
	});
});
