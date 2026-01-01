import { describe, expect, it } from 'vitest';
import {
	CardMovedToBriefingTrigger,
	CardMovedToPlanningTrigger,
	CardMovedToTodoTrigger,
} from '../../../src/triggers/trello/card-moved.js';
import type { TriggerContext } from '../../../src/triggers/types.js';

describe('CardMovedToBriefingTrigger', () => {
	const trigger = CardMovedToBriefingTrigger;

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

	it('matches when card moved to briefing list', () => {
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
						listBefore: { id: 'other-list', name: 'Other' },
						listAfter: { id: 'briefing-list-id', name: 'Briefing' },
					},
				},
			},
		};

		expect(trigger.matches(ctx)).toBe(true);
	});

	it('does not match when card moved from briefing to briefing', () => {
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
						listBefore: { id: 'briefing-list-id', name: 'Briefing' },
						listAfter: { id: 'briefing-list-id', name: 'Briefing' },
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

	it('handles and returns briefing agent', async () => {
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
						card: { id: 'card123', name: 'Test Card', idShort: 1, shortLink: 'abc' },
						listBefore: { id: 'other-list', name: 'Other' },
						listAfter: { id: 'briefing-list-id', name: 'Briefing' },
					},
				},
			},
		};

		const result = await trigger.handle(ctx);

		expect(result.agentType).toBe('briefing');
		expect(result.cardId).toBe('card123');
		expect(result.agentInput.cardId).toBe('card123');
	});
});

describe('CardMovedToTodoTrigger', () => {
	const trigger = CardMovedToTodoTrigger;

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

	it('matches when card moved to todo list', () => {
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
						listBefore: { id: 'planning-list-id', name: 'Planning' },
						listAfter: { id: 'todo-list-id', name: 'TODO' },
					},
				},
			},
		};

		expect(trigger.matches(ctx)).toBe(true);
	});

	it('handles and returns implementation agent', async () => {
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
						card: { id: 'card456', name: 'Test Card', idShort: 1, shortLink: 'abc' },
						listBefore: { id: 'planning-list-id', name: 'Planning' },
						listAfter: { id: 'todo-list-id', name: 'TODO' },
					},
				},
			},
		};

		const result = await trigger.handle(ctx);

		expect(result.agentType).toBe('implementation');
		expect(result.cardId).toBe('card456');
	});
});
