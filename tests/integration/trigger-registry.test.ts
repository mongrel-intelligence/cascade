/**
 * Integration tests: Trigger Registry
 *
 * Tests trigger matching, config toggles, and dispatch with real DB-backed
 * project configurations (loaded via configRepository).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
	findProjectByBoardIdFromDb,
	findProjectByRepoFromDb,
} from '../../src/db/repositories/configRepository.js';
import { createTriggerRegistry } from '../../src/triggers/registry.js';
import {
	CardMovedToPlanningTrigger,
	CardMovedToSplittingTrigger,
	CardMovedToTodoTrigger,
} from '../../src/triggers/trello/card-moved.js';
import { ReadyToProcessLabelTrigger } from '../../src/triggers/trello/label-added.js';
import type { TriggerContext } from '../../src/types/index.js';
import { assertFound } from './helpers/assert.js';
import { truncateAll } from './helpers/db.js';
import { seedIntegration, seedOrg, seedProject } from './helpers/seed.js';

// ============================================================================
// Helpers
// ============================================================================

function makeTrelloCardMovedPayload(overrides: {
	cardId?: string;
	cardName?: string;
	listAfterId?: string;
	listBeforeId?: string;
	actionType?: string;
}) {
	return {
		model: { id: 'board-123', name: 'Test Board' },
		action: {
			id: 'action-1',
			idMemberCreator: 'member-1',
			type: overrides.actionType ?? 'updateCard',
			date: new Date().toISOString(),
			data: {
				card: {
					id: overrides.cardId ?? 'card-abc',
					name: overrides.cardName ?? 'Test Card',
					idShort: 1,
					shortLink: 'abc',
				},
				listAfter: overrides.listAfterId ? { id: overrides.listAfterId, name: 'After' } : undefined,
				listBefore: overrides.listBeforeId
					? { id: overrides.listBeforeId, name: 'Before' }
					: undefined,
			},
			memberCreator: {
				id: 'member-1',
				fullName: 'Test Member',
				username: 'testmember',
			},
		},
	};
}

function makeTrelloLabelPayload(cardId: string, labelId: string, labelName = 'Ready to Process') {
	return {
		model: { id: 'board-123', name: 'Test Board' },
		action: {
			id: 'action-2',
			idMemberCreator: 'member-1',
			type: 'addLabelToCard',
			date: new Date().toISOString(),
			data: {
				card: { id: cardId, name: 'Test Card', idShort: 1, shortLink: 'abc' },
				label: { id: labelId, name: labelName, color: 'green' },
			},
		},
	};
}

// ============================================================================
// Tests
// ============================================================================

describe('Trigger Registry (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// Basic Registry Operations
	// =========================================================================

	describe('TriggerRegistry core', () => {
		it('registers and dispatches to matching trigger', async () => {
			const registry = createTriggerRegistry();
			let handled = false;

			registry.register({
				name: 'test-trigger',
				description: 'Test trigger',
				matches: () => true,
				handle: async () => {
					handled = true;
					return {
						agentType: 'implementation',
						agentInput: { cardId: 'card-1' },
					};
				},
			});

			const project = await findProjectByRepoFromDb('owner/repo');
			expect(project).toBeDefined();

			const result = await registry.dispatch({
				project: assertFound(project),
				source: 'trello',
				payload: {},
			});

			expect(handled).toBe(true);
			expect(result?.agentType).toBe('implementation');
		});

		it('returns null when no trigger matches', async () => {
			const registry = createTriggerRegistry();
			registry.register({
				name: 'never-matches',
				description: 'Never matches',
				matches: () => false,
				handle: async () => ({ agentType: 'implementation', agentInput: {} }),
			});

			const project = await findProjectByRepoFromDb('owner/repo');

			expect(project).toBeDefined();
			const result = await registry.dispatch({
				project: assertFound(project),
				source: 'trello',
				payload: {},
			});

			expect(result).toBeNull();
		});

		it('stops after first matching trigger returns a result', async () => {
			const registry = createTriggerRegistry();
			const calls: string[] = [];

			registry.register({
				name: 'first',
				description: 'First trigger',
				matches: () => true,
				handle: async () => {
					calls.push('first');
					return { agentType: 'implementation', agentInput: {} };
				},
			});
			registry.register({
				name: 'second',
				description: 'Second trigger',
				matches: () => true,
				handle: async () => {
					calls.push('second');
					return { agentType: 'review', agentInput: {} };
				},
			});

			const project = await findProjectByRepoFromDb('owner/repo');

			expect(project).toBeDefined();
			await registry.dispatch({ project: assertFound(project), source: 'trello', payload: {} });

			expect(calls).toEqual(['first']);
		});

		it('unregisters a trigger by name', () => {
			const registry = createTriggerRegistry();
			registry.register({
				name: 'to-remove',
				description: 'Will be removed',
				matches: () => true,
				handle: async () => ({ agentType: 'implementation', agentInput: {} }),
			});
			expect(registry.getHandlers()).toHaveLength(1);

			const removed = registry.unregister('to-remove');
			expect(removed).toBe(true);
			expect(registry.getHandlers()).toHaveLength(0);
		});

		it('returns false when unregistering non-existent trigger', () => {
			const registry = createTriggerRegistry();
			const removed = registry.unregister('nonexistent');
			expect(removed).toBe(false);
		});
	});

	// =========================================================================
	// Trello Card-Moved Triggers with Real DB Config
	// =========================================================================

	describe('CardMovedToTodoTrigger with real project config', () => {
		it('matches when card is moved into the todo list', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: {
					boardId: 'board-123',
					lists: { todo: 'list-todo-123', planning: 'list-plan-456', splitting: 'list-split-789' },
					labels: {},
				},
			});

			const project = await findProjectByBoardIdFromDb('board-123');
			expect(project).toBeDefined();

			const ctx: TriggerContext = {
				project: assertFound(project),
				source: 'trello',
				payload: makeTrelloCardMovedPayload({
					listAfterId: 'list-todo-123',
					listBeforeId: 'list-plan-456',
				}),
			};

			expect(CardMovedToTodoTrigger.matches(ctx)).toBe(true);
		});

		it('does not match when card moved to a different list', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: {
					boardId: 'board-123',
					lists: { todo: 'list-todo-123', planning: 'list-plan-456', splitting: 'list-split-789' },
					labels: {},
				},
			});

			const project = await findProjectByBoardIdFromDb('board-123');

			expect(project).toBeDefined();
			const ctx: TriggerContext = {
				project: assertFound(project),
				source: 'trello',
				payload: makeTrelloCardMovedPayload({
					listAfterId: 'list-other-999',
					listBeforeId: 'list-plan-456',
				}),
			};

			expect(CardMovedToTodoTrigger.matches(ctx)).toBe(false);
		});

		it('does not match when source is not trello', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: {
					boardId: 'board-123',
					lists: { todo: 'list-todo-123' },
					labels: {},
				},
			});

			const project = await findProjectByBoardIdFromDb('board-123');

			expect(project).toBeDefined();
			const ctx: TriggerContext = {
				project: assertFound(project),
				source: 'github',
				payload: makeTrelloCardMovedPayload({ listAfterId: 'list-todo-123' }),
			};

			expect(CardMovedToTodoTrigger.matches(ctx)).toBe(false);
		});

		it('returns correct agent type from handle', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: {
					boardId: 'board-123',
					lists: { todo: 'list-todo-123' },
					labels: {},
				},
			});

			const project = await findProjectByBoardIdFromDb('board-123');

			expect(project).toBeDefined();
			const ctx: TriggerContext = {
				project: assertFound(project),
				source: 'trello',
				payload: makeTrelloCardMovedPayload({
					cardId: 'card-xyz',
					listAfterId: 'list-todo-123',
					listBeforeId: 'list-plan-456',
				}),
			};

			const result = await CardMovedToTodoTrigger.handle(ctx);
			expect(result?.agentType).toBe('implementation');
			expect(result?.agentInput.cardId).toBe('card-xyz');
			expect(result?.workItemId).toBe('card-xyz');
		});
	});

	describe('CardMovedToSplittingTrigger', () => {
		it('matches when card moves to splitting list', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: {
					boardId: 'board-123',
					lists: { splitting: 'list-split-789' },
					labels: {},
				},
			});

			const project = await findProjectByBoardIdFromDb('board-123');

			expect(project).toBeDefined();
			const ctx: TriggerContext = {
				project: assertFound(project),
				source: 'trello',
				payload: makeTrelloCardMovedPayload({
					listAfterId: 'list-split-789',
					listBeforeId: 'list-inbox',
				}),
			};

			expect(CardMovedToSplittingTrigger.matches(ctx)).toBe(true);
			const result = await CardMovedToSplittingTrigger.handle(ctx);
			expect(result?.agentType).toBe('splitting');
		});
	});

	describe('CardMovedToPlanningTrigger', () => {
		it('matches when card moves to planning list', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: {
					boardId: 'board-123',
					lists: { planning: 'list-plan-456' },
					labels: {},
				},
			});

			const project = await findProjectByBoardIdFromDb('board-123');

			expect(project).toBeDefined();
			const ctx: TriggerContext = {
				project: assertFound(project),
				source: 'trello',
				payload: makeTrelloCardMovedPayload({
					listAfterId: 'list-plan-456',
					listBeforeId: 'list-inbox',
				}),
			};

			expect(CardMovedToPlanningTrigger.matches(ctx)).toBe(true);
			const result = await CardMovedToPlanningTrigger.handle(ctx);
			expect(result?.agentType).toBe('planning');
		});
	});

	// =========================================================================
	// Config Toggle Tests
	// =========================================================================

	describe('config toggles', () => {
		it('does not fire card-moved-to-todo when cardMovedToTodo is disabled', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: {
					boardId: 'board-123',
					lists: { todo: 'list-todo-123' },
					labels: {},
				},
				triggers: { cardMovedToTodo: false },
			});

			const project = await findProjectByBoardIdFromDb('board-123');

			expect(project).toBeDefined();
			const ctx: TriggerContext = {
				project: assertFound(project),
				source: 'trello',
				payload: makeTrelloCardMovedPayload({
					listAfterId: 'list-todo-123',
					listBeforeId: 'list-plan',
				}),
			};

			expect(CardMovedToTodoTrigger.matches(ctx)).toBe(false);
		});

		it('does not fire card-moved-to-splitting when cardMovedToSplitting is disabled', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: {
					boardId: 'board-123',
					lists: { splitting: 'list-split-789' },
					labels: {},
				},
				triggers: { cardMovedToSplitting: false },
			});

			const project = await findProjectByBoardIdFromDb('board-123');

			expect(project).toBeDefined();
			const ctx: TriggerContext = {
				project: assertFound(project),
				source: 'trello',
				payload: makeTrelloCardMovedPayload({
					listAfterId: 'list-split-789',
					listBeforeId: 'list-inbox',
				}),
			};

			expect(CardMovedToSplittingTrigger.matches(ctx)).toBe(false);
		});
	});

	// =========================================================================
	// ReadyToProcess Label Trigger
	// =========================================================================

	describe('ReadyToProcessLabelTrigger', () => {
		// The label config stores the label ID (not name) — trigger matches label.id === readyLabelId
		const READY_LABEL_ID = 'label-ready-to-process-id';
		const OTHER_LABEL_ID = 'label-other-id';

		it('matches when ready-to-process label is added', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: {
					boardId: 'board-123',
					lists: {
						todo: 'list-todo-123',
						planning: 'list-plan-456',
						splitting: 'list-split-789',
					},
					// readyToProcess stores the label ID
					labels: { readyToProcess: READY_LABEL_ID },
				},
			});

			const project = await findProjectByBoardIdFromDb('board-123');

			expect(project).toBeDefined();
			const labelTrigger = new ReadyToProcessLabelTrigger();

			const ctx: TriggerContext = {
				project: assertFound(project),
				source: 'trello',
				payload: makeTrelloLabelPayload('card-abc', READY_LABEL_ID),
			};

			expect(labelTrigger.matches(ctx)).toBe(true);
		});

		it('does not match when a non-ready-to-process label is added', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: {
					boardId: 'board-123',
					lists: {},
					labels: { readyToProcess: READY_LABEL_ID },
				},
			});

			const project = await findProjectByBoardIdFromDb('board-123');

			expect(project).toBeDefined();
			const labelTrigger = new ReadyToProcessLabelTrigger();

			const ctx: TriggerContext = {
				project: assertFound(project),
				source: 'trello',
				payload: makeTrelloLabelPayload('card-abc', OTHER_LABEL_ID, 'Some Other Label'),
			};

			expect(labelTrigger.matches(ctx)).toBe(false);
		});
	});

	// =========================================================================
	// Multi-trigger dispatch (builtins registered together)
	// =========================================================================

	describe('full builtin registry dispatch', () => {
		it('dispatches to correct trigger in a registry with multiple handlers', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: {
					boardId: 'board-123',
					lists: { todo: 'list-todo-123', planning: 'list-plan-456', splitting: 'list-split-789' },
					labels: { readyToProcess: 'Ready to Process' },
				},
			});

			const registry = createTriggerRegistry();
			registry.register(CardMovedToSplittingTrigger);
			registry.register(CardMovedToPlanningTrigger);
			registry.register(CardMovedToTodoTrigger);

			const project = await findProjectByBoardIdFromDb('board-123');

			expect(project).toBeDefined();
			// Move to todo — should trigger implementation
			const todoResult = await registry.dispatch({
				project: assertFound(project),
				source: 'trello',
				payload: makeTrelloCardMovedPayload({
					cardId: 'card-todo',
					listAfterId: 'list-todo-123',
					listBeforeId: 'list-plan-456',
				}),
			});
			expect(todoResult?.agentType).toBe('implementation');

			// Move to splitting — should trigger splitting
			const splitResult = await registry.dispatch({
				project: assertFound(project),
				source: 'trello',
				payload: makeTrelloCardMovedPayload({
					cardId: 'card-split',
					listAfterId: 'list-split-789',
					listBeforeId: 'list-inbox',
				}),
			});
			expect(splitResult?.agentType).toBe('splitting');
		});

		it('returns null for events with no matching trigger', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: {
					boardId: 'board-123',
					lists: { todo: 'list-todo-123' },
					labels: {},
				},
			});

			const registry = createTriggerRegistry();
			registry.register(CardMovedToTodoTrigger);

			const project = await findProjectByBoardIdFromDb('board-123');

			expect(project).toBeDefined();
			// Payload that doesn't match any trigger
			const result = await registry.dispatch({
				project: assertFound(project),
				source: 'trello',
				payload: { model: { id: 'board-123' }, action: { type: 'deleteCard', data: {} } },
			});

			expect(result).toBeNull();
		});
	});
});
