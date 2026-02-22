import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the GitHub client
vi.mock('../../../src/github/client.js', () => ({
	githubClient: {
		getPR: vi.fn(),
	},
}));

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
vi.mock('../../../src/config/provider.js', () => ({
	getIntegrationCredential: vi.fn(),
	loadProjectConfigByBoardId: vi.fn(),
	loadProjectConfigByJiraProjectKey: vi.fn(),
	findProjectById: vi.fn(),
}));
vi.mock('../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn(),
	trelloClient: { getCard: vi.fn() },
}));
vi.mock('../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn(),
	jiraClient: {},
}));
vi.mock('../../../src/router/acknowledgments.js', () => ({
	postTrelloAck: vi.fn(),
	deleteTrelloAck: vi.fn(),
	resolveTrelloBotMemberId: vi.fn(),
	postJiraAck: vi.fn(),
	deleteJiraAck: vi.fn(),
	resolveJiraBotAccountId: vi.fn(),
}));
vi.mock('../../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: vi.fn(),
}));

// Register PM integrations in the registry
import '../../../src/pm/index.js';

import { PRMergedTrigger } from '../../../src/triggers/github/pr-merged.js';
import type { TriggerContext } from '../../../src/triggers/types.js';

import { githubClient } from '../../../src/github/client.js';

describe('PRMergedTrigger', () => {
	const trigger = new PRMergedTrigger();

	const mockProject = {
		id: 'test',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: {
			boardId: 'board123',
			lists: {
				briefing: 'briefing-list-id',
				planning: 'planning-list-id',
				todo: 'todo-list-id',
				merged: 'merged-list-id',
			},
			labels: {},
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('resolveAgentType', () => {
		it('returns null (no agent)', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {},
			};
			expect(trigger.resolveAgentType(ctx)).toBeNull();
		});
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
		it('moves card to merged list when PR is merged', async () => {
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

		it('skips move and comment when card is already in MERGED list', async () => {
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
				status: 'merged-list-id',
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

			expect(mockProvider.getWorkItem).toHaveBeenCalledWith('abc123');
			expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
			expect(mockProvider.addComment).not.toHaveBeenCalled();
			expect(result).toEqual({
				agentType: null,
				agentInput: {},
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
						briefing: 'briefing-list-id',
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
	});
});
