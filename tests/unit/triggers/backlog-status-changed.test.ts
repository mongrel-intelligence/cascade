import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../src/triggers/config-resolver.js', () => ({
	isTriggerEnabled: vi.fn().mockResolvedValue(true),
	getTriggerParameters: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../../src/triggers/shared/trigger-check.js', () => ({
	checkTriggerEnabled: vi.fn().mockResolvedValue(true),
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

import { TrelloStatusChangedBacklogTrigger } from '../../../src/triggers/trello/status-changed.js';
import type { TriggerContext } from '../../../src/triggers/types.js';
import { createMockProject } from '../../helpers/factories.js';

describe('TrelloStatusChangedBacklogTrigger', () => {
	const trigger = TrelloStatusChangedBacklogTrigger;

	const mockProject = createMockProject({
		trello: {
			boardId: 'board123',
			lists: {
				splitting: 'splitting-list-id',
				planning: 'planning-list-id',
				todo: 'todo-list-id',
				backlog: 'backlog-list-id',
			},
			labels: {},
		},
	});

	it('matches when card moved to backlog list', () => {
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
						listAfter: { id: 'backlog-list-id', name: 'Backlog' },
					},
				},
			},
		};

		expect(trigger.matches(ctx)).toBe(true);
	});

	it('does not match when card moved from backlog to backlog', () => {
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
						listBefore: { id: 'backlog-list-id', name: 'Backlog' },
						listAfter: { id: 'backlog-list-id', name: 'Backlog' },
					},
				},
			},
		};

		expect(trigger.matches(ctx)).toBe(false);
	});

	it('matches when card created directly in backlog list', () => {
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
						list: { id: 'backlog-list-id', name: 'Backlog' },
					},
				},
			},
		};

		expect(trigger.matches(ctx)).toBe(true);
	});

	it('does not match when card moved to a different list', () => {
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
						listAfter: { id: 'todo-list-id', name: 'TODO' },
					},
				},
			},
		};

		expect(trigger.matches(ctx)).toBe(false);
	});

	it('does not match when backlog list is not configured', () => {
		const projectWithoutBacklog = createMockProject();
		const ctx: TriggerContext = {
			project: projectWithoutBacklog,
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
						listAfter: { id: 'backlog-list-id', name: 'Backlog' },
					},
				},
			},
		};

		// backlog list not configured, so targetListId is undefined — won't match
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

	it('handles and returns backlog-manager agent', async () => {
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
						card: { id: 'card789', name: 'Test Card', idShort: 1, shortLink: 'abc' },
						listBefore: { id: 'other-list', name: 'Other' },
						listAfter: { id: 'backlog-list-id', name: 'Backlog' },
					},
				},
			},
		};

		const result = await trigger.handle(ctx);

		expect(result?.agentType).toBe('backlog-manager');
		expect(result?.workItemId).toBe('card789');
		expect(result?.agentInput.cardId).toBe('card789');
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
						listBefore: { id: 'other-list', name: 'Other' },
						listAfter: { id: 'backlog-list-id', name: 'Backlog' },
					},
				},
			},
		};

		const result = await trigger.handle(ctx);
		expect(result).toBeNull();
	});
});
