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
			handle: vi.fn().mockResolvedValue({
				agentType: 'splitting',
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
		expect(result?.agentType).toBe('splitting');
		expect(handler.handle).toHaveBeenCalledWith(ctx);
	});

	it('returns null when no handler matches', async () => {
		const registry = createTriggerRegistry();

		const handler: TriggerHandler = {
			name: 'trello-only',
			description: 'Only matches trello',
			matches: (ctx) => ctx.source === 'trello',
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
			handle: vi.fn(),
		};

		registry.register(handler);
		expect(registry.getHandlers()).toHaveLength(1);

		const removed = registry.unregister('to-remove');
		expect(removed).toBe(true);
		expect(registry.getHandlers()).toHaveLength(0);
	});

	it('calls first matching handler and returns its result', async () => {
		const registry = createTriggerRegistry();

		const handler1: TriggerHandler = {
			name: 'first',
			description: 'First',
			matches: () => true,
			handle: vi.fn().mockResolvedValue({
				agentType: 'splitting',
				agentInput: {},
			}),
		};

		const handler2: TriggerHandler = {
			name: 'second',
			description: 'Second',
			matches: () => true,
			handle: vi.fn(),
		};

		registry.register(handler1);
		registry.register(handler2);

		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: {},
		};

		const result = await registry.dispatch(ctx);

		expect(result?.agentType).toBe('splitting');
		expect(handler1.handle).toHaveBeenCalledWith(ctx);
		expect(handler2.handle).not.toHaveBeenCalled();
	});

	it('skips handler when handle() returns null and tries next', async () => {
		const registry = createTriggerRegistry();

		const handler1: TriggerHandler = {
			name: 'no-match',
			description: 'Returns null from handle',
			matches: () => true,
			handle: vi.fn().mockResolvedValue(null),
		};

		const handler2: TriggerHandler = {
			name: 'real-match',
			description: 'Returns a result',
			matches: () => true,
			handle: vi.fn().mockResolvedValue({
				agentType: 'planning',
				agentInput: {},
			}),
		};

		registry.register(handler1);
		registry.register(handler2);

		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: {},
		};

		const result = await registry.dispatch(ctx);

		expect(result?.agentType).toBe('planning');
		expect(handler1.handle).toHaveBeenCalled();
		expect(handler2.handle).toHaveBeenCalled();
	});
});
