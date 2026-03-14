import { describe, expect, it, vi } from 'vitest';
import { mockLogger, mockTriggerCheckModule } from '../../helpers/sharedMocks.js';

vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));

vi.mock('../../../src/triggers/config-resolver.js', () => ({
	isTriggerEnabled: vi.fn().mockResolvedValue(true),
	getTriggerParameters: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

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

import { checkTriggerEnabled } from '../../../src/triggers/shared/trigger-check.js';
import {
	TrelloStatusChangedPlanningTrigger,
	TrelloStatusChangedSplittingTrigger,
	TrelloStatusChangedTodoTrigger,
} from '../../../src/triggers/trello/status-changed.js';
import type { TriggerContext } from '../../../src/triggers/types.js';
import { createMockProject } from '../../helpers/factories.js';

describe('TrelloStatusChangedSplittingTrigger', () => {
	const trigger = TrelloStatusChangedSplittingTrigger;

	const mockProject = createMockProject();

	it('matches when card moved to splitting list', () => {
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
						listAfter: { id: 'splitting-list-id', name: 'Splitting' },
					},
				},
			},
		};

		expect(trigger.matches(ctx)).toBe(true);
	});

	it('does not match when card moved from splitting to splitting', () => {
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
						listBefore: { id: 'splitting-list-id', name: 'Splitting' },
						listAfter: { id: 'splitting-list-id', name: 'Splitting' },
					},
				},
			},
		};

		expect(trigger.matches(ctx)).toBe(false);
	});

	it('matches when card created directly in splitting list', () => {
		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: {
				model: { id: 'board123', name: 'Board' },
				action: {
					id: 'action1',
					idMemberCreator: 'member1',
					type: 'createCard',
					date: '2024-01-01',
					data: {
						card: { id: 'card1', name: 'Test Card', idShort: 1, shortLink: 'abc' },
						list: { id: 'splitting-list-id', name: 'Splitting' },
					},
				},
			},
		};

		expect(trigger.matches(ctx)).toBe(true);
	});

	it('does not match when card created in a different list', () => {
		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: {
				model: { id: 'board123', name: 'Board' },
				action: {
					id: 'action1',
					idMemberCreator: 'member1',
					type: 'createCard',
					date: '2024-01-01',
					data: {
						card: { id: 'card1', name: 'Test Card', idShort: 1, shortLink: 'abc' },
						list: { id: 'other-list', name: 'Other' },
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

	it('should return null when trigger is disabled', async () => {
		vi.mocked(checkTriggerEnabled).mockResolvedValueOnce(false);

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
						listAfter: { id: 'splitting-list-id', name: 'Splitting' },
					},
				},
			},
		};

		const result = await trigger.handle(ctx);
		expect(result).toBeNull();
		expect(checkTriggerEnabled).toHaveBeenCalledWith(
			'test',
			'splitting',
			'pm:status-changed',
			'trello-status-changed-splitting',
		);
	});

	it('handles and returns splitting agent', async () => {
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
						listAfter: { id: 'splitting-list-id', name: 'Splitting' },
					},
				},
			},
		};

		const result = await trigger.handle(ctx);

		expect(result?.agentType).toBe('splitting');
		expect(result?.workItemId).toBe('card123');
		expect(result?.agentInput.workItemId).toBe('card123');
		expect(result?.agentInput.triggerEvent).toBe('pm:status-changed');
	});

	it('populates workItemUrl and workItemTitle from payload card data', async () => {
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
						card: { id: 'card123', name: 'My Feature Card', idShort: 1, shortLink: 'xyz123' },
						listBefore: { id: 'other-list', name: 'Other' },
						listAfter: { id: 'splitting-list-id', name: 'Splitting' },
					},
				},
			},
		};

		const result = await trigger.handle(ctx);

		expect(result?.workItemUrl).toBe('https://trello.com/c/xyz123');
		expect(result?.workItemTitle).toBe('My Feature Card');
		expect(result?.agentInput.workItemUrl).toBe('https://trello.com/c/xyz123');
		expect(result?.agentInput.workItemTitle).toBe('My Feature Card');
	});
});

describe('TrelloStatusChangedTodoTrigger', () => {
	const trigger = TrelloStatusChangedTodoTrigger;

	const mockProject = createMockProject();

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

		expect(result?.agentType).toBe('implementation');
		expect(result?.workItemId).toBe('card456');
	});

	it('returns null when card ID is missing from payload', async () => {
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
						// No card field
						listBefore: { id: 'planning-list-id', name: 'Planning' },
						listAfter: { id: 'todo-list-id', name: 'TODO' },
					},
				},
			},
		};

		const result = await trigger.handle(ctx);
		expect(result).toBeNull();
	});
});
