import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	mockAcknowledgmentsModule,
	mockConfigProvider,
	mockConfigResolverModule,
	mockJiraClientModule,
	mockLogger,
	mockReactionsModule,
	mockTrelloClientModule,
	mockTriggerCheckModule,
} from '../../helpers/sharedMocks.js';

vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));

vi.mock('../../../src/triggers/config-resolver.js', () => mockConfigResolverModule);
vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

// Spec 017 / plan 2: the capacity gate is now fail-closed when no
// PM-provider AsyncLocalStorage scope is in effect (the case in these
// unit tests). Mock as passthrough so trigger-logic assertions still run.
vi.mock('../../../src/triggers/shared/pipeline-capacity-gate.js', () => ({
	shouldBlockForPipelineCapacity: vi.fn().mockResolvedValue(false),
}));

// Mocks required for PM integration registration (pm/index.js side-effect)
vi.mock('../../../src/config/provider.js', () => mockConfigProvider);
vi.mock('../../../src/trello/client.js', () => mockTrelloClientModule);
vi.mock('../../../src/jira/client.js', () => mockJiraClientModule);
vi.mock('../../../src/router/acknowledgments.js', () => mockAcknowledgmentsModule);
vi.mock('../../../src/router/reactions.js', () => mockReactionsModule);

// Register PM integrations in the registry
import '../../../src/pm/index.js';

import { checkTriggerEnabledWithParams } from '../../../src/triggers/shared/trigger-check.js';
import {
	TrelloStatusChangedSplittingTrigger,
	TrelloStatusChangedTodoTrigger,
} from '../../../src/triggers/trello/status-changed.js';
import type { TriggerContext } from '../../../src/triggers/types.js';
import { createMockProject, createTrelloActionPayload } from '../../helpers/factories.js';

/** Default mock: enabled, onCreate=true onMove=true (matches Trello's backfilled state). */
function mockTriggerConfig(
	enabled: boolean,
	parameters: Record<string, unknown> = { onCreate: true, onMove: true },
) {
	vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({ enabled, parameters });
}

describe('TrelloStatusChangedSplittingTrigger', () => {
	const trigger = TrelloStatusChangedSplittingTrigger;

	const mockProject = createMockProject();

	beforeEach(() => {
		// Default: trigger enabled with Trello's backfilled params (both toggles on)
		mockTriggerConfig(true);
	});

	it('matches when card moved to splitting list', () => {
		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createTrelloActionPayload(),
		};

		expect(trigger.matches(ctx)).toBe(true);
	});

	it('does not match when card moved from splitting to splitting', () => {
		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createTrelloActionPayload({
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
			}),
		};

		expect(trigger.matches(ctx)).toBe(false);
	});

	it('matches when card created directly in splitting list', () => {
		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createTrelloActionPayload({
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
			}),
		};

		expect(trigger.matches(ctx)).toBe(true);
	});

	it('does not match when card created in a different list', () => {
		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createTrelloActionPayload({
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
			}),
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
		mockTriggerConfig(false);

		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createTrelloActionPayload({
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
			}),
		};

		const result = await trigger.handle(ctx);
		expect(result).toBeNull();
		expect(checkTriggerEnabledWithParams).toHaveBeenCalledWith(
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
			payload: createTrelloActionPayload({
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
			}),
		};

		const result = await trigger.handle(ctx);

		expect(result?.agentType).toBe('splitting');
		expect(result?.workItemId).toBe('card123');
		expect(result?.agentInput.workItemId).toBe('card123');
		expect(result?.agentInput.triggerEvent).toBe('pm:status-changed');
		expect(result?.coalesceKey).toBe('test:card123');
	});

	it('populates workItemUrl and workItemTitle from payload card data', async () => {
		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createTrelloActionPayload({
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
			}),
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

	beforeEach(() => {
		mockTriggerConfig(true);
	});

	it('matches when card moved to todo list', () => {
		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createTrelloActionPayload({
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
			}),
		};

		expect(trigger.matches(ctx)).toBe(true);
	});

	it('handles and returns implementation agent', async () => {
		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createTrelloActionPayload({
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
			}),
		};

		const result = await trigger.handle(ctx);

		expect(result?.agentType).toBe('implementation');
		expect(result?.workItemId).toBe('card456');
	});

	it('returns null when card ID is missing from payload', async () => {
		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createTrelloActionPayload({
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
			}),
		};

		const result = await trigger.handle(ctx);
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// onCreate / onMove matrix — exercises the factory's gating, not per-list
// ---------------------------------------------------------------------------

describe('Trello status-changed onCreate/onMove matrix (splitting trigger)', () => {
	const trigger = TrelloStatusChangedSplittingTrigger;
	const mockProject = createMockProject();

	function movePayload() {
		return createTrelloActionPayload({
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
		});
	}

	function createPayload() {
		return createTrelloActionPayload({
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
		});
	}

	it('fires on move when onMove=true and onCreate=true (backfilled default)', async () => {
		mockTriggerConfig(true, { onCreate: true, onMove: true });
		const ctx: TriggerContext = { project: mockProject, source: 'trello', payload: movePayload() };
		expect((await trigger.handle(ctx))?.agentType).toBe('splitting');
	});

	it('fires on create when onMove=true and onCreate=true (backfilled default)', async () => {
		mockTriggerConfig(true, { onCreate: true, onMove: true });
		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createPayload(),
		};
		expect((await trigger.handle(ctx))?.agentType).toBe('splitting');
	});

	it('does NOT fire on create when onCreate=false', async () => {
		mockTriggerConfig(true, { onCreate: false, onMove: true });
		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createPayload(),
		};
		expect(await trigger.handle(ctx)).toBeNull();
	});

	it('does NOT fire on move when onMove=false', async () => {
		mockTriggerConfig(true, { onCreate: true, onMove: false });
		const ctx: TriggerContext = { project: mockProject, source: 'trello', payload: movePayload() };
		expect(await trigger.handle(ctx)).toBeNull();
	});

	it('fires only on create when onCreate=true and onMove=false', async () => {
		mockTriggerConfig(true, { onCreate: true, onMove: false });

		const createCtx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createPayload(),
		};
		expect((await trigger.handle(createCtx))?.agentType).toBe('splitting');

		mockTriggerConfig(true, { onCreate: true, onMove: false });
		const moveCtx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: movePayload(),
		};
		expect(await trigger.handle(moveCtx)).toBeNull();
	});

	it('fires only on move when onCreate=false and onMove=true (YAML default for new projects)', async () => {
		mockTriggerConfig(true, { onCreate: false, onMove: true });

		const moveCtx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: movePayload(),
		};
		expect((await trigger.handle(moveCtx))?.agentType).toBe('splitting');

		mockTriggerConfig(true, { onCreate: false, onMove: true });
		const createCtx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createPayload(),
		};
		expect(await trigger.handle(createCtx)).toBeNull();
	});
});
