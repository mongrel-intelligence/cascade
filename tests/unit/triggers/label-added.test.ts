import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TriggerContext } from '../../../src/triggers/types.js';

// Import the module first, then mock it
import * as trelloClientModule from '../../../src/trello/client.js';
import { ReadyToProcessLabelTrigger } from '../../../src/triggers/trello/label-added.js';

describe('ReadyToProcessLabelTrigger', () => {
	const trigger = new ReadyToProcessLabelTrigger();
	let mockGetCard: ReturnType<typeof vi.fn>;

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
			labels: {
				readyToProcess: 'ready-label-id',
			},
		},
	};

	beforeEach(() => {
		mockGetCard = vi.fn();
		vi.spyOn(trelloClientModule.trelloClient, 'getCard').mockImplementation(mockGetCard);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('matches', () => {
		it('matches when ready-to-process label is added', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {
					model: { id: 'board123', name: 'Board' },
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card1', name: 'Test Card', idShort: 1, shortLink: 'abc' },
							label: { id: 'ready-label-id', name: 'Ready', color: 'green' },
						},
					},
				},
			};

			expect(trigger.matches(ctx)).toBe(true);
		});

		it('does not match when different label is added', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {
					model: { id: 'board123', name: 'Board' },
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card1', name: 'Test Card', idShort: 1, shortLink: 'abc' },
							label: { id: 'other-label-id', name: 'Other', color: 'red' },
						},
					},
				},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match for non-addLabelToCard action', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {
					model: { id: 'board123', name: 'Board' },
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'updateCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card1', name: 'Test Card', idShort: 1, shortLink: 'abc' },
						},
					},
				},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match github source', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: {},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});
	});

	describe('handle', () => {
		it('returns briefing agent when card is in briefing list', async () => {
			mockGetCard.mockResolvedValue({
				id: 'card123',
				name: 'Test Card',
				desc: '',
				url: 'https://trello.com/c/abc',
				shortUrl: 'https://trello.com/c/abc',
				idList: 'briefing-list-id',
				labels: [],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {
					model: { id: 'board123', name: 'Board' },
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card123', name: 'Test Card', idShort: 1, shortLink: 'abc' },
							label: { id: 'ready-label-id', name: 'Ready', color: 'green' },
						},
					},
				},
			};

			const result = await trigger.handle(ctx);

			expect(result.agentType).toBe('briefing');
			expect(result.cardId).toBe('card123');
			expect(mockGetCard).toHaveBeenCalledWith('card123');
		});

		it('returns planning agent when card is in planning list', async () => {
			mockGetCard.mockResolvedValue({
				id: 'card456',
				name: 'Planning Card',
				desc: '',
				url: 'https://trello.com/c/def',
				shortUrl: 'https://trello.com/c/def',
				idList: 'planning-list-id',
				labels: [],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {
					model: { id: 'board123', name: 'Board' },
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card456', name: 'Planning Card', idShort: 2, shortLink: 'def' },
							label: { id: 'ready-label-id', name: 'Ready', color: 'green' },
						},
					},
				},
			};

			const result = await trigger.handle(ctx);

			expect(result.agentType).toBe('planning');
			expect(result.cardId).toBe('card456');
		});

		it('returns implementation agent when card is in todo list', async () => {
			mockGetCard.mockResolvedValue({
				id: 'card789',
				name: 'Todo Card',
				desc: '',
				url: 'https://trello.com/c/ghi',
				shortUrl: 'https://trello.com/c/ghi',
				idList: 'todo-list-id',
				labels: [],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {
					model: { id: 'board123', name: 'Board' },
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card789', name: 'Todo Card', idShort: 3, shortLink: 'ghi' },
							label: { id: 'ready-label-id', name: 'Ready', color: 'green' },
						},
					},
				},
			};

			const result = await trigger.handle(ctx);

			expect(result.agentType).toBe('implementation');
			expect(result.cardId).toBe('card789');
		});

		it('defaults to briefing agent when card is in unknown list', async () => {
			mockGetCard.mockResolvedValue({
				id: 'card999',
				name: 'Unknown List Card',
				desc: '',
				url: 'https://trello.com/c/xyz',
				shortUrl: 'https://trello.com/c/xyz',
				idList: 'unknown-list-id',
				labels: [],
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {
					model: { id: 'board123', name: 'Board' },
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card999', name: 'Unknown List Card', idShort: 4, shortLink: 'xyz' },
							label: { id: 'ready-label-id', name: 'Ready', color: 'green' },
						},
					},
				},
			};

			const result = await trigger.handle(ctx);

			expect(result.agentType).toBe('briefing');
		});

		it('throws when card ID is missing', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {
					model: { id: 'board123', name: 'Board' },
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							label: { id: 'ready-label-id', name: 'Ready', color: 'green' },
						},
					},
				},
			};

			await expect(trigger.handle(ctx)).rejects.toThrow('No card ID in payload');
		});
	});
});
