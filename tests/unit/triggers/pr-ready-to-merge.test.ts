import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	mockAcknowledgmentsModule,
	mockConfigProvider,
	mockConfigResolverModule,
	mockGitHubClientModule,
	mockJiraClientModule,
	mockReactionsModule,
	mockTrelloClientModule,
} from '../../helpers/sharedMocks.js';

vi.mock('../../../src/triggers/config-resolver.js', () => mockConfigResolverModule);

vi.mock('../../../src/triggers/shared/lifecycle-check.js', () => ({
	isLifecycleTriggerEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../src/github/client.js', () => mockGitHubClientModule);

// Mock the PM provider context
const mockProvider = {
	getWorkItem: vi.fn(),
	moveWorkItem: vi.fn(),
	addComment: vi.fn(),
};
vi.mock('../../../src/pm/context.js', () => ({
	getPMProvider: () => mockProvider,
}));

// Mocks required for PM integration registration (pm/index.js side-effect)
vi.mock('../../../src/config/provider.js', () => mockConfigProvider);
vi.mock('../../../src/trello/client.js', () => mockTrelloClientModule);
vi.mock('../../../src/jira/client.js', () => mockJiraClientModule);
vi.mock('../../../src/router/acknowledgments.js', () => mockAcknowledgmentsModule);
vi.mock('../../../src/router/reactions.js', () => mockReactionsModule);
vi.mock('../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	lookupWorkItemForPR: vi.fn(),
}));

// Register PM integrations in the registry
import '../../../src/pm/index.js';

import { lookupWorkItemForPR } from '../../../src/db/repositories/prWorkItemsRepository.js';
import { githubClient } from '../../../src/github/client.js';
import { PRReadyToMergeTrigger } from '../../../src/triggers/github/pr-ready-to-merge.js';
import { isLifecycleTriggerEnabled } from '../../../src/triggers/shared/lifecycle-check.js';
import type { TriggerContext } from '../../../src/triggers/types.js';
import {
	createCheckSuitePayload,
	createMockProject,
	createReviewPayload,
} from '../../helpers/factories.js';

describe('PRReadyToMergeTrigger', () => {
	const trigger = new PRReadyToMergeTrigger();

	const mockProject = createMockProject({
		trello: {
			boardId: 'board123',
			lists: {
				splitting: 'splitting-list-id',
				planning: 'planning-list-id',
				todo: 'todo-list-id',
				done: 'done-list-id',
			},
			labels: {},
		},
	});

	beforeEach(() => {
		vi.mocked(lookupWorkItemForPR).mockResolvedValue('abc123');
	});

	describe('matches', () => {
		it('matches check_suite completed with success and PRs', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: createCheckSuitePayload(),
			};

			expect(trigger.matches(ctx)).toBe(true);
		});

		it('matches review submitted with approved state', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: createReviewPayload({
					review: {
						id: 100,
						state: 'approved',
						body: 'LGTM',
						html_url: 'https://github.com/...',
						user: { login: 'reviewer' },
					},
					sender: { login: 'reviewer' },
				}),
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
				payload: createCheckSuitePayload({
					check_suite: {
						id: 1,
						status: 'completed',
						conclusion: 'failure',
						head_sha: 'sha123',
						pull_requests: [{ number: 42, head: { ref: 'feat', sha: 'sha123' } }],
					},
				}),
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match check_suite with no PRs', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: createCheckSuitePayload({
					check_suite: {
						id: 1,
						status: 'completed',
						conclusion: 'success',
						head_sha: 'sha123',
						pull_requests: [],
					},
				}),
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match review with changes_requested', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: createReviewPayload({
					review: {
						id: 100,
						state: 'changes_requested',
						body: 'Fix this',
						html_url: 'https://github.com/...',
						user: { login: 'reviewer' },
					},
					sender: { login: 'reviewer' },
				}),
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
		it('should return null when trigger is disabled', async () => {
			vi.mocked(isLifecycleTriggerEnabled).mockResolvedValueOnce(false);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: createCheckSuitePayload(),
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
			expect(isLifecycleTriggerEnabled).toHaveBeenCalledWith(
				'test',
				'prReadyToMerge',
				'pr-ready-to-merge',
			);
		});

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
					commitId: 'sha123',
				},
			]);
			mockProvider.getWorkItem.mockResolvedValue({
				id: 'abc123',
				title: 'Card',
				description: '',
				url: '',
				status: 'todo-list-id',
				labels: [],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: createCheckSuitePayload(),
			};

			const result = await trigger.handle(ctx);

			expect(mockProvider.moveWorkItem).toHaveBeenCalledWith('abc123', 'done-list-id');
			expect(mockProvider.addComment).toHaveBeenCalledWith(
				'abc123',
				'PR #42 approved and all checks passing - moved to DONE',
			);
			expect(result).toEqual({
				agentType: null,
				agentInput: {},
				workItemId: 'abc123',
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
					commitId: 'sha123',
				},
			]);
			mockProvider.getWorkItem.mockResolvedValue({
				id: 'abc123',
				title: 'Card',
				description: '',
				url: '',
				status: 'todo-list-id',
				labels: [],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: createReviewPayload({
					review: {
						id: 100,
						state: 'approved',
						body: 'LGTM',
						html_url: 'https://github.com/...',
						user: { login: 'reviewer' },
					},
					sender: { login: 'reviewer' },
				}),
			};

			const result = await trigger.handle(ctx);

			expect(mockProvider.moveWorkItem).toHaveBeenCalledWith('abc123', 'done-list-id');
			expect(result?.workItemId).toBe('abc123');
		});

		it('returns null when PR has no Trello URL (check_suite path)', async () => {
			vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
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
				payload: createCheckSuitePayload(),
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
			expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
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
				payload: createCheckSuitePayload(),
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
			expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
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
					commitId: 'sha123',
				},
			]);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: createCheckSuitePayload(),
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
					commitId: 'sha123',
				},
				{
					id: 2,
					state: 'changes_requested',
					body: 'Fix this',
					user: { login: 'reviewer2' },
					submitted_at: '2024-01-02',
					commitId: 'sha123',
				},
			]);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: createCheckSuitePayload(),
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('skips move and comment when card is already in DONE list', async () => {
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
					commitId: 'sha123',
				},
			]);
			mockProvider.getWorkItem.mockResolvedValue({
				id: 'abc123',
				title: 'Card',
				description: '',
				url: '',
				status: 'done-list-id',
				labels: [],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: createCheckSuitePayload(),
			};

			const result = await trigger.handle(ctx);

			expect(mockProvider.getWorkItem).toHaveBeenCalledWith('abc123');
			expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
			expect(mockProvider.addComment).not.toHaveBeenCalled();
			expect(result).toEqual({
				agentType: null,
				agentInput: {},
				workItemId: 'abc123',
				prNumber: 42,
			});
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
					commitId: 'sha123',
				},
			]);

			const projectWithoutDone = {
				...mockProject,
				trello: {
					...mockProject.trello,
					lists: {
						splitting: 'splitting-list-id',
						planning: 'planning-list-id',
						todo: 'todo-list-id',
						// no done list
					},
				},
			};

			const ctx: TriggerContext = {
				project: projectWithoutDone,
				source: 'github',
				payload: createCheckSuitePayload(),
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
			expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
		});
	});

	describe('auto-merge', () => {
		const projectWithAutoLabel = createMockProject({
			trello: {
				boardId: 'board123',
				lists: {
					splitting: 'splitting-list-id',
					planning: 'planning-list-id',
					todo: 'todo-list-id',
					done: 'done-list-id',
					merged: 'merged-list-id',
				},
				labels: {
					auto: 'auto-label-id',
				},
			},
		});

		beforeEach(() => {
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
					commitId: 'sha123',
				},
			]);
		});

		it('auto-merges PR and moves to MERGED when card has auto label', async () => {
			mockProvider.getWorkItem.mockResolvedValue({
				id: 'abc123',
				title: 'Card',
				description: '',
				url: '',
				status: 'todo-list-id',
				labels: [{ id: 'auto-label-id', name: 'auto' }],
			});
			vi.mocked(githubClient.mergePR).mockResolvedValue(undefined);

			const ctx: TriggerContext = {
				project: projectWithAutoLabel,
				source: 'github',
				payload: createCheckSuitePayload(),
			};

			const result = await trigger.handle(ctx);

			expect(githubClient.mergePR).toHaveBeenCalledWith('owner', 'repo', 42);
			expect(mockProvider.moveWorkItem).toHaveBeenCalledWith('abc123', 'merged-list-id');
			expect(mockProvider.addComment).toHaveBeenCalledWith(
				'abc123',
				'PR #42 automatically merged and moved to MERGED',
			);
			expect(result).toEqual({
				agentType: null,
				agentInput: {},
				workItemId: 'abc123',
				prNumber: 42,
			});
		});

		it('falls back to DONE when auto-merge fails', async () => {
			mockProvider.getWorkItem.mockResolvedValue({
				id: 'abc123',
				title: 'Card',
				description: '',
				url: '',
				status: 'todo-list-id',
				labels: [{ id: 'auto-label-id', name: 'auto' }],
			});
			vi.mocked(githubClient.mergePR).mockRejectedValue(new Error('Merge conflict'));

			const ctx: TriggerContext = {
				project: projectWithAutoLabel,
				source: 'github',
				payload: createCheckSuitePayload(),
			};

			const result = await trigger.handle(ctx);

			expect(githubClient.mergePR).toHaveBeenCalledWith('owner', 'repo', 42);
			expect(mockProvider.moveWorkItem).toHaveBeenCalledWith('abc123', 'done-list-id');
			expect(mockProvider.addComment).toHaveBeenCalledWith(
				'abc123',
				expect.stringContaining('Auto-merge of PR #42 failed'),
			);
			expect(result).toEqual({
				agentType: null,
				agentInput: {},
				workItemId: 'abc123',
				prNumber: 42,
			});
		});

		it('skips auto-merge when card is already in MERGED status', async () => {
			mockProvider.getWorkItem.mockResolvedValue({
				id: 'abc123',
				title: 'Card',
				description: '',
				url: '',
				status: 'merged-list-id',
				labels: [{ id: 'auto-label-id', name: 'auto' }],
			});

			const ctx: TriggerContext = {
				project: projectWithAutoLabel,
				source: 'github',
				payload: createCheckSuitePayload(),
			};

			const result = await trigger.handle(ctx);

			expect(githubClient.mergePR).not.toHaveBeenCalled();
			expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
			expect(result).toEqual({
				agentType: null,
				agentInput: {},
				workItemId: 'abc123',
				prNumber: 42,
			});
		});

		it('returns null and adds comment when auto-merge fails and no DONE status configured', async () => {
			const projectWithoutDone = createMockProject({
				trello: {
					boardId: 'board123',
					lists: {
						todo: 'todo-list-id',
						merged: 'merged-list-id',
					},
					labels: {
						auto: 'auto-label-id',
					},
				},
			});

			mockProvider.getWorkItem.mockResolvedValue({
				id: 'abc123',
				title: 'Card',
				description: '',
				url: '',
				status: 'todo-list-id',
				labels: [{ id: 'auto-label-id', name: 'auto' }],
			});
			vi.mocked(githubClient.mergePR).mockRejectedValue(new Error('Merge conflict'));

			const ctx: TriggerContext = {
				project: projectWithoutDone,
				source: 'github',
				payload: createCheckSuitePayload(),
			};

			const result = await trigger.handle(ctx);

			expect(githubClient.mergePR).toHaveBeenCalledWith('owner', 'repo', 42);
			expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
			expect(mockProvider.addComment).toHaveBeenCalledWith(
				'abc123',
				expect.stringContaining('No DONE status configured'),
			);
			expect(result).toBeNull();
		});

		it('falls back to DONE when auto label present but no MERGED status configured', async () => {
			const projectWithoutMerged = createMockProject({
				trello: {
					boardId: 'board123',
					lists: {
						todo: 'todo-list-id',
						done: 'done-list-id',
					},
					labels: {
						auto: 'auto-label-id',
					},
				},
			});

			mockProvider.getWorkItem.mockResolvedValue({
				id: 'abc123',
				title: 'Card',
				description: '',
				url: '',
				status: 'todo-list-id',
				labels: [{ id: 'auto-label-id', name: 'auto' }],
			});

			const ctx: TriggerContext = {
				project: projectWithoutMerged,
				source: 'github',
				payload: createCheckSuitePayload(),
			};

			const result = await trigger.handle(ctx);

			expect(githubClient.mergePR).not.toHaveBeenCalled();
			expect(mockProvider.moveWorkItem).toHaveBeenCalledWith('abc123', 'done-list-id');
			expect(mockProvider.addComment).toHaveBeenCalledWith(
				'abc123',
				expect.stringContaining('no MERGED status configured'),
			);
			expect(result).toEqual({
				agentType: null,
				agentInput: {},
				workItemId: 'abc123',
				prNumber: 42,
			});
		});

		it('returns null and adds comment when auto label present but neither MERGED nor DONE configured', async () => {
			const projectWithoutMergedOrDone = createMockProject({
				trello: {
					boardId: 'board123',
					lists: {
						todo: 'todo-list-id',
					},
					labels: {
						auto: 'auto-label-id',
					},
				},
			});

			mockProvider.getWorkItem.mockResolvedValue({
				id: 'abc123',
				title: 'Card',
				description: '',
				url: '',
				status: 'todo-list-id',
				labels: [{ id: 'auto-label-id', name: 'auto' }],
			});

			const ctx: TriggerContext = {
				project: projectWithoutMergedOrDone,
				source: 'github',
				payload: createCheckSuitePayload(),
			};

			const result = await trigger.handle(ctx);

			expect(githubClient.mergePR).not.toHaveBeenCalled();
			expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
			expect(mockProvider.addComment).toHaveBeenCalledWith(
				'abc123',
				expect.stringContaining('no MERGED or DONE status configured'),
			);
			expect(result).toBeNull();
		});
	});
});
