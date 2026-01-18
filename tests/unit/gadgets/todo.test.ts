import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TodoUpdateStatus } from '../../../src/gadgets/todo/TodoUpdateStatus.js';
import { TodoUpsert } from '../../../src/gadgets/todo/TodoUpsert.js';

// Mock the storage module
vi.mock('../../../src/gadgets/todo/storage.js', () => {
	let todos: Array<{
		id: string;
		content: string;
		status: string;
		createdAt: string;
		updatedAt: string;
	}> = [];

	return {
		loadTodos: vi.fn(() => todos),
		saveTodos: vi.fn((newTodos) => {
			todos = newTodos;
		}),
		getNextId: vi.fn((existingTodos) => {
			const maxId = existingTodos.reduce(
				(max: number, t: { id: string }) => Math.max(max, Number.parseInt(t.id) || 0),
				0,
			);
			return String(maxId + 1);
		}),
		formatTodoList: vi.fn((existingTodos) => {
			if (existingTodos.length === 0) return '📋 Todo list is empty.';
			const lines = existingTodos.map(
				(t: { id: string; status: string; content: string }) =>
					`#${t.id} [${t.status}]: ${t.content}`,
			);
			return `📋 Todo List\n${lines.join('\n')}`;
		}),
		// Helper to reset todos between tests
		_resetTodos: () => {
			todos = [];
		},
		_setTodos: (
			newTodos: Array<{
				id: string;
				content: string;
				status: string;
				createdAt: string;
				updatedAt: string;
			}>,
		) => {
			todos = newTodos;
		},
	};
});

// Import the mocked functions to access helpers
import * as storage from '../../../src/gadgets/todo/storage.js';

describe('TodoUpsert', () => {
	let gadget: TodoUpsert;

	beforeEach(() => {
		gadget = new TodoUpsert();
		// Reset todos before each test
		(storage as unknown as { _resetTodos: () => void })._resetTodos();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('gadget metadata', () => {
		it('has correct name', () => {
			expect(gadget.name).toBe('TodoUpsert');
		});

		it('has description mentioning create or update', () => {
			expect(gadget.description).toContain('Create or update');
		});

		it('description mentions TodoUpdateStatus for status changes', () => {
			expect(gadget.description).toContain('TodoUpdateStatus');
		});
	});

	describe('mixed mode validation', () => {
		it('throws error when combining id with items array', () => {
			expect(() =>
				gadget.execute({
					id: '1',
					items: [{ content: 'New task' }],
				}),
			).toThrow("Cannot combine top-level id/content with 'items' array");
		});

		it('throws error when combining content with items array', () => {
			expect(() =>
				gadget.execute({
					content: 'Some content',
					items: [{ content: 'New task' }],
				}),
			).toThrow("Cannot combine top-level id/content with 'items' array");
		});

		it('error message suggests making two separate calls', () => {
			try {
				gadget.execute({
					id: '1',
					items: [{ content: 'New task' }],
				});
				expect.fail('Should have thrown');
			} catch (error) {
				expect((error as Error).message).toContain('make two separate calls');
			}
		});

		it('allows empty items array with id (single-item mode)', () => {
			// Set up an existing todo
			(storage as unknown as { _setTodos: (todos: unknown[]) => void })._setTodos([
				{ id: '1', content: 'Existing task', status: 'pending', createdAt: '', updatedAt: '' },
			]);

			// Empty items array should be ignored, single-item mode takes over
			const result = gadget.execute({
				id: '1',
				content: 'Updated task',
				items: [],
			});

			expect(result).toContain('Updated todo #1');
		});
	});

	describe('single-item mode', () => {
		it('creates a new todo with content', () => {
			const result = gadget.execute({
				content: 'New task',
			});

			expect(result).toContain('Created todo #1');
			expect(storage.saveTodos).toHaveBeenCalled();
		});

		it('new todos default to pending status', () => {
			gadget.execute({
				content: 'New task',
			});

			const savedTodos = (storage.saveTodos as ReturnType<typeof vi.fn>).mock.calls[0][0];
			expect(savedTodos[0].status).toBe('pending');
		});

		it('updates existing todo content', () => {
			(storage as unknown as { _setTodos: (todos: unknown[]) => void })._setTodos([
				{ id: '1', content: 'Existing task', status: 'pending', createdAt: '', updatedAt: '' },
			]);

			const result = gadget.execute({
				id: '1',
				content: 'Updated task',
			});

			expect(result).toContain('Updated todo #1');
		});

		it('throws error when creating without content', () => {
			expect(() => gadget.execute({})).toThrow("'content' is required when creating a new todo.");
		});

		it('throws error when creating with id but no content', () => {
			expect(() => gadget.execute({ id: '99' })).toThrow(
				"'content' is required when creating a new todo.",
			);
		});
	});

	describe('batch mode', () => {
		it('creates multiple todos at once', () => {
			const result = gadget.execute({
				items: [{ content: 'Task 1' }, { content: 'Task 2' }, { content: 'Task 3' }],
			});

			expect(result).toContain('Created 3 todos');
			expect(storage.saveTodos).toHaveBeenCalled();
		});

		it('batch created todos default to pending status', () => {
			gadget.execute({
				items: [{ content: 'Task 1' }, { content: 'Task 2' }],
			});

			const savedTodos = (storage.saveTodos as ReturnType<typeof vi.fn>).mock.calls[0][0];
			expect(savedTodos[0].status).toBe('pending');
			expect(savedTodos[1].status).toBe('pending');
		});
	});
});

describe('TodoUpdateStatus', () => {
	let gadget: TodoUpdateStatus;

	beforeEach(() => {
		gadget = new TodoUpdateStatus();
		// Reset todos before each test
		(storage as unknown as { _resetTodos: () => void })._resetTodos();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('gadget metadata', () => {
		it('has correct name', () => {
			expect(gadget.name).toBe('TodoUpdateStatus');
		});

		it('has description mentioning status update', () => {
			expect(gadget.description).toContain('status');
		});
	});

	describe('status updates', () => {
		it('updates status of existing todo to in_progress', () => {
			(storage as unknown as { _setTodos: (todos: unknown[]) => void })._setTodos([
				{ id: '1', content: 'Existing task', status: 'pending', createdAt: '', updatedAt: '' },
			]);

			const result = gadget.execute({
				id: '1',
				status: 'in_progress',
			});

			expect(result).toContain('Updated todo #1');
			expect(result).toContain('in_progress');
			expect(storage.saveTodos).toHaveBeenCalled();
		});

		it('updates status of existing todo to done', () => {
			(storage as unknown as { _setTodos: (todos: unknown[]) => void })._setTodos([
				{ id: '1', content: 'Existing task', status: 'in_progress', createdAt: '', updatedAt: '' },
			]);

			const result = gadget.execute({
				id: '1',
				status: 'done',
			});

			expect(result).toContain('Updated todo #1');
			expect(result).toContain('done');
		});

		it('updates updatedAt timestamp', () => {
			(storage as unknown as { _setTodos: (todos: unknown[]) => void })._setTodos([
				{ id: '1', content: 'Existing task', status: 'pending', createdAt: '', updatedAt: '' },
			]);

			gadget.execute({
				id: '1',
				status: 'done',
			});

			const savedTodos = (storage.saveTodos as ReturnType<typeof vi.fn>).mock.calls[0][0];
			expect(savedTodos[0].updatedAt).not.toBe('');
		});
	});

	describe('error handling', () => {
		it('throws error for non-existent todo', () => {
			expect(() =>
				gadget.execute({
					id: '99',
					status: 'done',
				}),
			).toThrow('Todo #99 not found. Use TodoUpsert to create todos first.');
		});

		it('throws error when todo list is empty', () => {
			expect(() =>
				gadget.execute({
					id: '1',
					status: 'in_progress',
				}),
			).toThrow('Todo #1 not found');
		});
	});
});
