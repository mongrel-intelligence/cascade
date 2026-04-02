import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	mockAcknowledgmentsModule,
	mockConfigProvider,
	mockConfigResolverModule,
	mockGitHubClientModule,
	mockJiraClientModule,
	mockReactionsModule,
	mockTrelloClientModule,
	mockTriggerCheckModule,
} from '../../helpers/sharedMocks.js';

vi.mock('../../../src/triggers/config-resolver.js', () => mockConfigResolverModule);

vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

vi.mock('../../../src/triggers/shared/lifecycle-check.js', () => ({
	isLifecycleTriggerEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../src/triggers/shared/backlog-check.js', () => ({
	isPipelineAtCapacity: vi.fn().mockResolvedValue({ atCapacity: false, reason: 'below-capacity' }),
}));

// Mock the GitHub client
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

// Mock the snapshot manager so we can verify invalidation calls
const mockInvalidateSnapshot = vi.fn();
vi.mock('../../../src/router/snapshot-manager.js', () => ({
	invalidateSnapshot: (...args: unknown[]) => mockInvalidateSnapshot(...args),
}));

// Register PM integrations in the registry
import '../../../src/pm/index.js';

import { lookupWorkItemForPR } from '../../../src/db/repositories/prWorkItemsRepository.js';
import { githubClient } from '../../../src/github/client.js';
import { PRMergedTrigger } from '../../../src/triggers/github/pr-merged.js';
import { isPipelineAtCapacity } from '../../../src/triggers/shared/backlog-check.js';
import { isLifecycleTriggerEnabled } from '../../../src/triggers/shared/lifecycle-check.js';
import { checkTriggerEnabled } from '../../../src/triggers/shared/trigger-check.js';
import type { TriggerContext } from '../../../src/triggers/types.js';
import { createMockProject } from '../../helpers/factories.js';

describe('PRMergedTrigger', () => {
	const trigger = new PRMergedTrigger();

	const mockProject = createMockProject({
		trello: {
			boardId: 'board123',
			lists: {
				splitting: 'splitting-list-id',
				planning: 'planning-list-id',
				todo: 'todo-list-id',
				merged: 'merged-list-id',
			},
			labels: {},
		},
	});

	beforeEach(() => {
		vi.mocked(lookupWorkItemForPR).mockResolvedValue('abc123');
		vi.mocked(checkTriggerEnabled).mockResolvedValue(true);
		mockInvalidateSnapshot.mockClear();
	});

	describe('matches', () => {
		it('matches when PR is closed', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'closed',
					number: 123,
					pull_request: {
						number: 123,
						body: 'https://trello.com/c/abc123',
					},
					repository: {
						full_name: 'owner/repo',
					},
				},
			};

			expect(trigger.matches(ctx)).toBe(true);
		});

		it('does not match when action is not closed', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'opened',
					number: 123,
					pull_request: {
						number: 123,
						body: 'https://trello.com/c/abc123',
					},
					repository: {
						full_name: 'owner/repo',
					},
				},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match trello source', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {},
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
				payload: {
					action: 'closed',
					number: 123,
					pull_request: { number: 123, body: 'https://trello.com/c/abc123' },
					repository: { full_name: 'owner/repo' },
				},
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
			expect(isLifecycleTriggerEnabled).toHaveBeenCalledWith('test', 'prMerged', 'pr-merged');
		});

		it('moves card to merged list when PR is merged', async () => {
			// isLifecycleTriggerEnabled: prMerged = true; then checkTriggerEnabled: backlog-manager = false
			vi.mocked(isLifecycleTriggerEnabled).mockResolvedValueOnce(true);
			vi.mocked(checkTriggerEnabled).mockResolvedValueOnce(false);

			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 123,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'closed',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: true,
			});
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
				payload: {
					action: 'closed',
					number: 123,
					pull_request: {
						number: 123,
						body: 'https://trello.com/c/abc123/card-name',
					},
					repository: {
						full_name: 'owner/repo',
					},
				},
			};

			const result = await trigger.handle(ctx);

			expect(githubClient.getPR).toHaveBeenCalledWith('owner', 'repo', 123);
			expect(mockProvider.moveWorkItem).toHaveBeenCalledWith('abc123', 'merged-list-id');
			expect(mockProvider.addComment).toHaveBeenCalledWith(
				'abc123',
				'PR #123 has been merged to main',
			);
			expect(result).toEqual({
				agentType: null,
				agentInput: {},
				workItemId: 'abc123',
				prNumber: 123,
			});
		});

		it('returns null when PR is closed but not merged', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 123,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123',
				state: 'closed',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'closed',
					number: 123,
					pull_request: {
						number: 123,
						body: 'https://trello.com/c/abc123',
					},
					repository: {
						full_name: 'owner/repo',
					},
				},
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
			expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
		});

		it('returns null when PR has no Trello card URL', async () => {
			vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 123,
				title: 'Test PR',
				body: 'Some PR description without Trello link',
				state: 'closed',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: true,
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'closed',
					number: 123,
					pull_request: {
						number: 123,
						body: 'Some PR description without Trello link',
					},
					repository: {
						full_name: 'owner/repo',
					},
				},
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
			expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
		});

		it('skips move/comment but chains to backlog-manager when card already merged', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 123,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'closed',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: true,
			});
			mockProvider.getWorkItem.mockResolvedValue({
				id: 'abc123',
				title: 'Card',
				description: '',
				url: '',
				status: 'merged-list-id', // Already in merged status
				labels: [],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'closed',
					number: 123,
					pull_request: {
						number: 123,
						body: 'https://trello.com/c/abc123/card-name',
					},
					repository: {
						full_name: 'owner/repo',
					},
				},
			};

			const result = await trigger.handle(ctx);

			// Verify idempotency: no move or comment
			expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
			expect(mockProvider.addComment).not.toHaveBeenCalled();

			// Verify backlog-manager check was made
			expect(checkTriggerEnabled).toHaveBeenCalledWith(
				'test',
				'backlog-manager',
				'scm:pr-merged',
				'pr-merged',
			);

			// Should still chain to backlog-manager (with cardId for PM operations)
			expect(result).toEqual({
				agentType: 'backlog-manager',
				agentInput: {
					triggerEvent: 'scm:pr-merged',
					workItemId: 'abc123',
				},
				workItemId: 'abc123',
				prNumber: 123,
			});
		});

		it('skips move/comment and returns null when card already merged and backlog-manager disabled', async () => {
			// isLifecycleTriggerEnabled: prMerged = true; then checkTriggerEnabled: backlog-manager = false
			vi.mocked(isLifecycleTriggerEnabled).mockResolvedValueOnce(true);
			vi.mocked(checkTriggerEnabled).mockResolvedValueOnce(false); // backlog-manager disabled

			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 123,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'closed',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: true,
			});
			mockProvider.getWorkItem.mockResolvedValue({
				id: 'abc123',
				title: 'Card',
				description: '',
				url: '',
				status: 'merged-list-id', // Already in merged status
				labels: [],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'closed',
					number: 123,
					pull_request: {
						number: 123,
						body: 'https://trello.com/c/abc123/card-name',
					},
					repository: {
						full_name: 'owner/repo',
					},
				},
			};

			const result = await trigger.handle(ctx);

			expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
			expect(mockProvider.addComment).not.toHaveBeenCalled();
			expect(result).toEqual({
				agentType: null,
				agentInput: {},
				workItemId: 'abc123',
				prNumber: 123,
			});
		});

		it('chains to backlog-manager when backlog-manager trigger is enabled', async () => {
			// checkTriggerEnabled defaults to true from the mock, so backlog-manager will chain
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 123,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'closed',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: true,
			});
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
				payload: {
					action: 'closed',
					number: 123,
					pull_request: {
						number: 123,
						body: 'https://trello.com/c/abc123/card-name',
					},
					repository: {
						full_name: 'owner/repo',
					},
				},
			};

			const result = await trigger.handle(ctx);

			// backlog-manager receives cardId in agentInput for PM operations
			expect(result).toEqual({
				agentType: 'backlog-manager',
				agentInput: {
					triggerEvent: 'scm:pr-merged',
					workItemId: 'abc123',
				},
				workItemId: 'abc123',
				prNumber: 123,
			});
		});

		it('returns agentType null when backlog-manager trigger is disabled', async () => {
			// isLifecycleTriggerEnabled: prMerged = true; then checkTriggerEnabled: backlog-manager = false
			vi.mocked(isLifecycleTriggerEnabled).mockResolvedValueOnce(true);
			vi.mocked(checkTriggerEnabled).mockResolvedValueOnce(false);

			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 123,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'closed',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: true,
			});
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
				payload: {
					action: 'closed',
					number: 123,
					pull_request: {
						number: 123,
						body: 'https://trello.com/c/abc123/card-name',
					},
					repository: {
						full_name: 'owner/repo',
					},
				},
			};

			const result = await trigger.handle(ctx);

			expect(result).toEqual({
				agentType: null,
				agentInput: {},
				workItemId: 'abc123',
				prNumber: 123,
			});
		});

		it('skips backlog-manager and returns agentType null when pipeline is at capacity', async () => {
			// Both trigger checks return true, but pipeline is at capacity
			vi.mocked(isPipelineAtCapacity).mockResolvedValue({
				atCapacity: true,
				reason: 'backlog-empty',
			});

			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 123,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'closed',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: true,
			});
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
				payload: {
					action: 'closed',
					number: 123,
					pull_request: {
						number: 123,
						body: 'https://trello.com/c/abc123/card-name',
					},
					repository: {
						full_name: 'owner/repo',
					},
				},
			};

			const result = await trigger.handle(ctx);

			// Card should still move to merged status
			expect(mockProvider.moveWorkItem).toHaveBeenCalledWith('abc123', 'merged-list-id');

			// But backlog-manager should NOT be chained
			expect(result).toEqual({
				agentType: null,
				agentInput: {},
				workItemId: 'abc123',
				prNumber: 123,
			});
		});

		it('still chains to backlog-manager when pipeline is below capacity', async () => {
			vi.mocked(isPipelineAtCapacity).mockResolvedValue({
				atCapacity: false,
				reason: 'below-capacity',
			});

			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 123,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'closed',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: true,
			});
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
				payload: {
					action: 'closed',
					number: 123,
					pull_request: {
						number: 123,
						body: 'https://trello.com/c/abc123/card-name',
					},
					repository: {
						full_name: 'owner/repo',
					},
				},
			};

			const result = await trigger.handle(ctx);

			expect(result).toEqual({
				agentType: 'backlog-manager',
				agentInput: { triggerEvent: 'scm:pr-merged', workItemId: 'abc123' },
				workItemId: 'abc123',
				prNumber: 123,
			});
		});

		it('returns null when merged list is not configured', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 123,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123',
				state: 'closed',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: true,
			});

			const projectWithoutMergedList = {
				...mockProject,
				trello: {
					...mockProject.trello,
					lists: {
						splitting: 'splitting-list-id',
						planning: 'planning-list-id',
						todo: 'todo-list-id',
						// merged list not configured
					},
				},
			};

			const ctx: TriggerContext = {
				project: projectWithoutMergedList,
				source: 'github',
				payload: {
					action: 'closed',
					number: 123,
					pull_request: {
						number: 123,
						body: 'https://trello.com/c/abc123',
					},
					repository: {
						full_name: 'owner/repo',
					},
				},
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
			expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
		});

		it('invalidates snapshot for the work item when PR is merged', async () => {
			// isLifecycleTriggerEnabled: prMerged = true; then checkTriggerEnabled: backlog-manager = false
			vi.mocked(isLifecycleTriggerEnabled).mockResolvedValueOnce(true);
			vi.mocked(checkTriggerEnabled).mockResolvedValueOnce(false);

			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 123,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'closed',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: true,
			});
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
				payload: {
					action: 'closed',
					number: 123,
					pull_request: {
						number: 123,
						body: 'https://trello.com/c/abc123/card-name',
					},
					repository: {
						full_name: 'owner/repo',
					},
				},
			};

			await trigger.handle(ctx);

			// Snapshot should be invalidated for the project+workItem pair
			expect(mockInvalidateSnapshot).toHaveBeenCalledWith(mockProject.id, 'abc123');
		});

		it('does not invalidate snapshot when PR is not merged', async () => {
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 123,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123',
				state: 'closed',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'closed',
					number: 123,
					pull_request: {
						number: 123,
						body: 'https://trello.com/c/abc123',
					},
					repository: {
						full_name: 'owner/repo',
					},
				},
			};

			await trigger.handle(ctx);

			// No invalidation when PR is not merged
			expect(mockInvalidateSnapshot).not.toHaveBeenCalled();
		});

		it('does not invalidate snapshot when no work item is linked', async () => {
			vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 123,
				title: 'Test PR',
				body: 'No Trello link',
				state: 'closed',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: true,
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {
					action: 'closed',
					number: 123,
					pull_request: {
						number: 123,
						body: 'No Trello link',
					},
					repository: {
						full_name: 'owner/repo',
					},
				},
			};

			await trigger.handle(ctx);

			// No invalidation when there's no linked work item
			expect(mockInvalidateSnapshot).not.toHaveBeenCalled();
		});
	});
});
