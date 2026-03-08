import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/gadgets/todo/storage.js', () => ({
	loadTodos: vi.fn(),
	saveTodos: vi.fn(),
	formatTodoList: vi.fn(),
}));

import { TodoDelete } from '../../../../src/gadgets/todo/TodoDelete.js';
import { formatTodoList, loadTodos, saveTodos } from '../../../../src/gadgets/todo/storage.js';

const mockLoadTodos = vi.mocked(loadTodos);
const mockSaveTodos = vi.mocked(saveTodos);
const mockFormatTodoList = vi.mocked(formatTodoList);

describe('TodoDelete', () => {
	let gadget: InstanceType<typeof TodoDelete>;

	beforeEach(() => {
		gadget = new TodoDelete();
		mockFormatTodoList.mockReturnValue('📋 Todo list is empty.');
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	describe('single deletion (id)', () => {
		it('deletes a single todo by id', () => {
			const todos = [
				{ id: '1', content: 'First', status: 'pending' as const, createdAt: '', updatedAt: '' },
				{ id: '2', content: 'Second', status: 'pending' as const, createdAt: '', updatedAt: '' },
			];
			mockLoadTodos.mockReturnValue([...todos]);

			const result = gadget.execute({ id: '1' });

			expect(result).toContain('Deleted todo #1');
			expect(result).toContain('"First"');
			expect(mockSaveTodos).toHaveBeenCalledWith([todos[1]]);
		});

		it('returns error when id not found', () => {
			mockLoadTodos.mockReturnValue([]);

			const result = gadget.execute({ id: '99' });

			expect(result).toContain('Error');
			expect(result).toContain('#99 not found');
			expect(mockSaveTodos).not.toHaveBeenCalled();
		});
	});

	describe('batch deletion (ids)', () => {
		it('deletes multiple todos at once', () => {
			const todos = [
				{ id: '1', content: 'First', status: 'pending' as const, createdAt: '', updatedAt: '' },
				{ id: '2', content: 'Second', status: 'pending' as const, createdAt: '', updatedAt: '' },
				{ id: '3', content: 'Third', status: 'pending' as const, createdAt: '', updatedAt: '' },
			];
			mockLoadTodos.mockReturnValue([...todos]);

			const result = gadget.execute({ ids: ['1', '3'] });

			expect(result).toContain('Batch delete: 2 deleted');
			expect(result).toContain('#1: "First"');
			expect(result).toContain('#3: "Third"');
			expect(mockSaveTodos).toHaveBeenCalledWith([todos[1]]);
		});

		it('handles partial batch — some IDs not found', () => {
			const todos = [
				{ id: '1', content: 'First', status: 'pending' as const, createdAt: '', updatedAt: '' },
			];
			mockLoadTodos.mockReturnValue([...todos]);

			const result = gadget.execute({ ids: ['1', '99'] });

			expect(result).toContain('Batch delete: 1 deleted');
			expect(result).toContain('Not found: #99');
			expect(mockSaveTodos).toHaveBeenCalled();
		});

		it('reports all not found when no IDs match', () => {
			mockLoadTodos.mockReturnValue([]);

			const result = gadget.execute({ ids: ['5', '6'] });

			expect(result).toContain('Not found: #5, #6');
			expect(mockSaveTodos).not.toHaveBeenCalled();
		});

		it('handles duplicate IDs correctly', () => {
			const todos = [
				{ id: '1', content: 'First', status: 'pending' as const, createdAt: '', updatedAt: '' },
				{ id: '2', content: 'Second', status: 'pending' as const, createdAt: '', updatedAt: '' },
			];
			mockLoadTodos.mockReturnValue([...todos]);

			const result = gadget.execute({ ids: ['1', '1'] });

			// First '1' deletes it, second '1' is not found
			expect(result).toContain('Batch delete: 1 deleted');
			expect(result).toContain('Not found: #1');
			expect(mockSaveTodos).toHaveBeenCalledWith([todos[1]]);
		});
	});

	describe('mutual exclusion', () => {
		it('returns error when both id and ids provided', () => {
			const result = gadget.execute({ id: '1', ids: ['2', '3'] });

			expect(result).toContain('Error');
			expect(result).toContain('not both');
			expect(mockLoadTodos).not.toHaveBeenCalled();
		});

		it('returns error when neither id nor ids provided', () => {
			const result = gadget.execute({});

			expect(result).toContain('Error');
			expect(mockLoadTodos).not.toHaveBeenCalled();
		});
	});
});
