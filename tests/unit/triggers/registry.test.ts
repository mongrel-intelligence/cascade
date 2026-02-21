import { describe, expect, it, vi } from 'vitest';
import { createTriggerRegistry } from '../../../src/triggers/registry.js';
import type { TriggerContext, TriggerHandler } from '../../../src/triggers/types.js';

describe('TriggerRegistry', () => {
	const mockProject = {
		id: 'test',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: {
			boardId: 'board123',
			lists: { todo: 'list1' },
			labels: { processing: 'label1' },
		},
	};

	it('registers and dispatches handlers', async () => {
		const registry = createTriggerRegistry();

		const handler: TriggerHandler = {
			name: 'test-handler',
			description: 'Test handler',
			matches: (ctx) => ctx.source === 'trello',
			resolveAgentType: () => 'briefing',
			handle: vi.fn().mockResolvedValue({
				agentType: 'briefing',
				agentInput: { cardId: 'card123' },
			}),
		};

		registry.register(handler);

		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: {},
		};

		const result = await registry.dispatch(ctx);

		expect(result).not.toBeNull();
		expect(result?.agentType).toBe('briefing');
		expect(handler.handle).toHaveBeenCalledWith(ctx);
	});

	it('returns null when no handler matches', async () => {
		const registry = createTriggerRegistry();

		const handler: TriggerHandler = {
			name: 'trello-only',
			description: 'Only matches trello',
			matches: (ctx) => ctx.source === 'trello',
			resolveAgentType: () => 'briefing',
			handle: vi.fn(),
		};

		registry.register(handler);

		const ctx: TriggerContext = {
			project: mockProject,
			source: 'github',
			payload: {},
		};

		const result = await registry.dispatch(ctx);

		expect(result).toBeNull();
		expect(handler.handle).not.toHaveBeenCalled();
	});

	it('unregisters handlers', () => {
		const registry = createTriggerRegistry();

		const handler: TriggerHandler = {
			name: 'to-remove',
			description: 'Will be removed',
			matches: () => true,
			resolveAgentType: () => 'briefing',
			handle: vi.fn(),
		};

		registry.register(handler);
		expect(registry.getHandlers()).toHaveLength(1);

		const removed = registry.unregister('to-remove');
		expect(removed).toBe(true);
		expect(registry.getHandlers()).toHaveLength(0);
	});
});

describe('TriggerRegistry.matchTrigger', () => {
	const mockProject = {
		id: 'test',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: {
			boardId: 'board123',
			lists: { todo: 'list1' },
			labels: {},
		},
	};

	it('returns name and agentType for the first matching handler', () => {
		const registry = createTriggerRegistry();

		const handler: TriggerHandler = {
			name: 'card-moved-to-todo',
			description: 'Card moved to TODO',
			matches: (ctx) => ctx.source === 'trello',
			resolveAgentType: () => 'implementation',
			handle: vi.fn(),
		};

		registry.register(handler);

		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: {},
		};

		const result = registry.matchTrigger(ctx);

		expect(result).toEqual({ name: 'card-moved-to-todo', agentType: 'implementation' });
	});

	it('returns null when no handler matches', () => {
		const registry = createTriggerRegistry();

		const handler: TriggerHandler = {
			name: 'trello-only',
			description: 'Only matches trello',
			matches: (ctx) => ctx.source === 'trello',
			resolveAgentType: () => 'briefing',
			handle: vi.fn(),
		};

		registry.register(handler);

		const ctx: TriggerContext = {
			project: mockProject,
			source: 'github',
			payload: {},
		};

		expect(registry.matchTrigger(ctx)).toBeNull();
	});

	it('skips handlers that match but return null from resolveAgentType', () => {
		const registry = createTriggerRegistry();

		const nullHandler: TriggerHandler = {
			name: 'label-added',
			description: 'Label added (cannot resolve)',
			matches: () => true,
			resolveAgentType: () => null,
			handle: vi.fn(),
		};

		const validHandler: TriggerHandler = {
			name: 'card-moved',
			description: 'Card moved',
			matches: () => true,
			resolveAgentType: () => 'planning',
			handle: vi.fn(),
		};

		registry.register(nullHandler);
		registry.register(validHandler);

		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: {},
		};

		const result = registry.matchTrigger(ctx);

		expect(result).toEqual({ name: 'card-moved', agentType: 'planning' });
	});

	it('returns null when all matching handlers return null from resolveAgentType', () => {
		const registry = createTriggerRegistry();

		const handler: TriggerHandler = {
			name: 'label-added',
			description: 'Label added (cannot resolve)',
			matches: () => true,
			resolveAgentType: () => null,
			handle: vi.fn(),
		};

		registry.register(handler);

		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: {},
		};

		expect(registry.matchTrigger(ctx)).toBeNull();
	});

	it('does not call handle() — pure matching only', () => {
		const registry = createTriggerRegistry();

		const handleMock = vi.fn();
		const handler: TriggerHandler = {
			name: 'test',
			description: 'Test',
			matches: () => true,
			resolveAgentType: () => 'review',
			handle: handleMock,
		};

		registry.register(handler);

		const ctx: TriggerContext = {
			project: mockProject,
			source: 'github',
			payload: {},
		};

		registry.matchTrigger(ctx);

		expect(handleMock).not.toHaveBeenCalled();
	});

	it('returns first match when multiple handlers match', () => {
		const registry = createTriggerRegistry();

		const handler1: TriggerHandler = {
			name: 'first',
			description: 'First',
			matches: () => true,
			resolveAgentType: () => 'briefing',
			handle: vi.fn(),
		};

		const handler2: TriggerHandler = {
			name: 'second',
			description: 'Second',
			matches: () => true,
			resolveAgentType: () => 'planning',
			handle: vi.fn(),
		};

		registry.register(handler1);
		registry.register(handler2);

		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: {},
		};

		const result = registry.matchTrigger(ctx);

		expect(result).toEqual({ name: 'first', agentType: 'briefing' });
	});
});
