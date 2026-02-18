import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRMergedTrigger } from '../../../src/triggers/github/pr-merged.js';
import type { TriggerContext } from '../../../src/triggers/types.js';

// Mock the GitHub client
vi.mock('../../../src/github/client.js', () => ({
	githubClient: {
		getPR: vi.fn(),
	},
}));

// Mock the Trello client
vi.mock('../../../src/trello/client.js', () => ({
	trelloClient: {
		getCard: vi.fn(),
		moveCardToList: vi.fn(),
		addComment: vi.fn(),
	},
}));

import { githubClient } from '../../../src/github/client.js';
import { trelloClient } from '../../../src/trello/client.js';

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
			vi.mocked(trelloClient.getCard).mockResolvedValue({
				id: 'abc123',
				name: 'Card',
				desc: '',
				url: '',
				shortUrl: '',
				idList: 'todo-list-id',
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
			expect(trelloClient.moveCardToList).toHaveBeenCalledWith('abc123', 'merged-list-id');
			expect(trelloClient.addComment).toHaveBeenCalledWith(
				'abc123',
				'PR #123 has been merged to main',
			);
			expect(result).toEqual({
				agentType: '',
				agentInput: {},
				cardId: 'abc123',
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
			expect(trelloClient.moveCardToList).not.toHaveBeenCalled();
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
			expect(trelloClient.moveCardToList).not.toHaveBeenCalled();
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
			vi.mocked(trelloClient.getCard).mockResolvedValue({
				id: 'abc123',
				name: 'Card',
				desc: '',
				url: '',
				shortUrl: '',
				idList: 'merged-list-id',
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

			expect(trelloClient.getCard).toHaveBeenCalledWith('abc123');
			expect(trelloClient.moveCardToList).not.toHaveBeenCalled();
			expect(trelloClient.addComment).not.toHaveBeenCalled();
			expect(result).toEqual({
				agentType: '',
				agentInput: {},
				cardId: 'abc123',
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
			expect(trelloClient.moveCardToList).not.toHaveBeenCalled();
		});
	});
});
