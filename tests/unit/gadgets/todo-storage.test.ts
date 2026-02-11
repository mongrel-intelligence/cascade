import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
	existsSync: vi.fn(),
	mkdirSync: vi.fn(),
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
}));

vi.mock('../../../src/utils/repo.js', () => ({
	getWorkspaceDir: vi.fn(() => '/workspace'),
}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
	type Todo,
	formatTodoList,
	getNextId,
	getSessionId,
	initTodoSession,
	loadTodos,
	saveTodos,
} from '../../../src/gadgets/todo/storage.js';

describe('todo storage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset session state by re-initializing
		vi.mocked(existsSync).mockReturnValue(true);
	});

	describe('initTodoSession', () => {
		it('sets session ID and ensures directory exists', () => {
			vi.mocked(existsSync).mockReturnValue(false);

			initTodoSession('test-session-123');

			expect(getSessionId()).toBe('test-session-123');
			expect(mkdirSync).toHaveBeenCalledWith(expect.stringContaining('todos'), { recursive: true });
		});
	});

	describe('getSessionId', () => {
		it('returns initialized session ID', () => {
			initTodoSession('my-session');
			expect(getSessionId()).toBe('my-session');
		});
	});

	describe('loadTodos', () => {
		it('returns empty array when session file does not exist', () => {
			initTodoSession('load-test');
			vi.mocked(existsSync)
				.mockReturnValueOnce(true) // todos dir exists
				.mockReturnValueOnce(false); // session file doesn't exist

			const todos = loadTodos();

			expect(todos).toEqual([]);
		});

		it('loads todos from session file', () => {
			initTodoSession('load-test-2');
			const mockTodos: Todo[] = [
				{
					id: '1',
					content: 'First task',
					status: 'pending',
					createdAt: '2024-01-01',
					updatedAt: '2024-01-01',
				},
			];
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockTodos));

			const todos = loadTodos();

			expect(todos).toEqual(mockTodos);
		});
	});

	describe('saveTodos', () => {
		it('writes todos to session file', () => {
			initTodoSession('save-test');
			const todos: Todo[] = [
				{
					id: '1',
					content: 'Task 1',
					status: 'done',
					createdAt: '2024-01-01',
					updatedAt: '2024-01-01',
				},
			];

			saveTodos(todos);

			expect(writeFileSync).toHaveBeenCalledWith(
				expect.stringContaining('save-test.json'),
				JSON.stringify(todos, null, 2),
			);
		});
	});

	describe('getNextId', () => {
		it('returns "1" for empty list', () => {
			expect(getNextId([])).toBe('1');
		});

		it('returns next sequential ID', () => {
			const todos: Todo[] = [
				{ id: '1', content: 'First', status: 'pending', createdAt: '', updatedAt: '' },
				{ id: '3', content: 'Third', status: 'pending', createdAt: '', updatedAt: '' },
			];

			expect(getNextId(todos)).toBe('4');
		});

		it('handles non-numeric IDs gracefully', () => {
			const todos: Todo[] = [
				{ id: 'abc', content: 'Non-numeric', status: 'pending', createdAt: '', updatedAt: '' },
			];

			expect(getNextId(todos)).toBe('1');
		});
	});

	describe('formatTodoList', () => {
		it('returns empty message for no todos', () => {
			expect(formatTodoList([])).toContain('empty');
		});

		it('formats todos with status icons', () => {
			const todos: Todo[] = [
				{ id: '1', content: 'Pending task', status: 'pending', createdAt: '', updatedAt: '' },
				{
					id: '2',
					content: 'In progress task',
					status: 'in_progress',
					createdAt: '',
					updatedAt: '',
				},
				{ id: '3', content: 'Done task', status: 'done', createdAt: '', updatedAt: '' },
			];

			const formatted = formatTodoList(todos);

			expect(formatted).toContain('#1');
			expect(formatted).toContain('Pending task');
			expect(formatted).toContain('#2');
			expect(formatted).toContain('In progress task');
			expect(formatted).toContain('#3');
			expect(formatted).toContain('Done task');
			expect(formatted).toContain('1/3 done');
			expect(formatted).toContain('1 in progress');
			expect(formatted).toContain('1 pending');
		});

		it('includes progress summary', () => {
			const todos: Todo[] = [
				{ id: '1', content: 'Task 1', status: 'done', createdAt: '', updatedAt: '' },
				{ id: '2', content: 'Task 2', status: 'done', createdAt: '', updatedAt: '' },
			];

			const formatted = formatTodoList(todos);

			expect(formatted).toContain('2/2 done');
		});
	});
});
