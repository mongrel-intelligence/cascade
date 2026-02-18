import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPMProvider } from '../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
}));

vi.mock('../../../../src/gadgets/todo/storage.js', () => ({
	loadTodos: vi.fn(),
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
	clearSyncedTodos,
	syncCompletedTodosToChecklist,
} from '../../../../src/agents/utils/checklistSync.js';
import { loadTodos } from '../../../../src/gadgets/todo/storage.js';

const mockLoadTodos = vi.mocked(loadTodos);

beforeEach(() => {
	vi.clearAllMocks();
	clearSyncedTodos();
});

// Helper to create a todo
function makeTodo(
	id: string,
	content: string,
	status: 'done' | 'pending' | 'in_progress' = 'done',
) {
	return { id, content, status, createdAt: '2024-01-01', updatedAt: '2024-01-01' };
}

// Helper to create a checklist
function makeChecklist(
	workItemId: string,
	items: { id: string; name: string; complete: boolean }[],
) {
	return {
		id: `cl-${workItemId}`,
		name: 'Tasks',
		workItemId,
		items,
	};
}

describe('syncCompletedTodosToChecklist', () => {
	describe('when no done todos', () => {
		it('does not call getChecklists when no done todos', async () => {
			mockLoadTodos.mockReturnValue([
				makeTodo('t1', 'Pending task', 'pending'),
				makeTodo('t2', 'In progress', 'in_progress'),
			]);

			await syncCompletedTodosToChecklist('item1');

			expect(mockProvider.getChecklists).not.toHaveBeenCalled();
		});
	});

	describe('when done todos exist but no checklists', () => {
		it('does nothing when checklists are empty', async () => {
			mockLoadTodos.mockReturnValue([makeTodo('t1', 'Done task')]);
			mockProvider.getChecklists.mockResolvedValue([]);

			await syncCompletedTodosToChecklist('item1');

			expect(mockProvider.updateChecklistItem).not.toHaveBeenCalled();
		});
	});

	describe('string matching', () => {
		it('matches exact string', async () => {
			mockLoadTodos.mockReturnValue([makeTodo('t1', 'implement login')]);
			mockProvider.getChecklists.mockResolvedValue([
				makeChecklist('item1', [{ id: 'ci1', name: 'implement login', complete: false }]),
			]);
			mockProvider.updateChecklistItem.mockResolvedValue(undefined);

			await syncCompletedTodosToChecklist('item1');

			expect(mockProvider.updateChecklistItem).toHaveBeenCalledWith('item1', 'ci1', true);
		});

		it('matches case-insensitively', async () => {
			mockLoadTodos.mockReturnValue([makeTodo('t1', 'Implement Login')]);
			mockProvider.getChecklists.mockResolvedValue([
				makeChecklist('item1', [{ id: 'ci1', name: 'implement login', complete: false }]),
			]);
			mockProvider.updateChecklistItem.mockResolvedValue(undefined);

			await syncCompletedTodosToChecklist('item1');

			expect(mockProvider.updateChecklistItem).toHaveBeenCalledWith('item1', 'ci1', true);
		});

		it('matches when todo is substring of check item name', async () => {
			mockLoadTodos.mockReturnValue([makeTodo('t1', 'login')]);
			mockProvider.getChecklists.mockResolvedValue([
				makeChecklist('item1', [{ id: 'ci1', name: 'implement login feature', complete: false }]),
			]);
			mockProvider.updateChecklistItem.mockResolvedValue(undefined);

			await syncCompletedTodosToChecklist('item1');

			expect(mockProvider.updateChecklistItem).toHaveBeenCalledWith('item1', 'ci1', true);
		});

		it('matches when check item is substring of todo content', async () => {
			mockLoadTodos.mockReturnValue([makeTodo('t1', 'implement the login feature for users')]);
			mockProvider.getChecklists.mockResolvedValue([
				makeChecklist('item1', [{ id: 'ci1', name: 'login feature', complete: false }]),
			]);
			mockProvider.updateChecklistItem.mockResolvedValue(undefined);

			await syncCompletedTodosToChecklist('item1');

			expect(mockProvider.updateChecklistItem).toHaveBeenCalledWith('item1', 'ci1', true);
		});

		it('strips bullet prefixes before matching', async () => {
			mockLoadTodos.mockReturnValue([makeTodo('t1', '- implement login')]);
			mockProvider.getChecklists.mockResolvedValue([
				makeChecklist('item1', [{ id: 'ci1', name: 'implement login', complete: false }]),
			]);
			mockProvider.updateChecklistItem.mockResolvedValue(undefined);

			await syncCompletedTodosToChecklist('item1');

			expect(mockProvider.updateChecklistItem).toHaveBeenCalledWith('item1', 'ci1', true);
		});

		it('does not match unrelated items', async () => {
			mockLoadTodos.mockReturnValue([makeTodo('t1', 'write tests')]);
			mockProvider.getChecklists.mockResolvedValue([
				makeChecklist('item1', [{ id: 'ci1', name: 'implement login', complete: false }]),
			]);

			await syncCompletedTodosToChecklist('item1');

			expect(mockProvider.updateChecklistItem).not.toHaveBeenCalled();
		});
	});

	describe('dedup tracking', () => {
		it('does not re-sync already synced todos', async () => {
			mockLoadTodos.mockReturnValue([makeTodo('t1', 'implement login')]);
			mockProvider.getChecklists.mockResolvedValue([
				makeChecklist('item1', [{ id: 'ci1', name: 'implement login', complete: false }]),
			]);
			mockProvider.updateChecklistItem.mockResolvedValue(undefined);

			await syncCompletedTodosToChecklist('item1');
			await syncCompletedTodosToChecklist('item1');

			// Should only call once despite two sync calls
			expect(mockProvider.updateChecklistItem).toHaveBeenCalledTimes(1);
		});

		it('marks already-complete items as synced without API call', async () => {
			mockLoadTodos.mockReturnValue([makeTodo('t1', 'implement login')]);
			mockProvider.getChecklists.mockResolvedValue([
				makeChecklist('item1', [{ id: 'ci1', name: 'implement login', complete: true }]),
			]);

			await syncCompletedTodosToChecklist('item1');

			// No updateChecklistItem needed since already complete
			expect(mockProvider.updateChecklistItem).not.toHaveBeenCalled();

			// Second call should also not call it (todo was tracked as synced)
			await syncCompletedTodosToChecklist('item1');
			expect(mockProvider.updateChecklistItem).not.toHaveBeenCalled();
		});

		it('clearSyncedTodos allows re-syncing', async () => {
			mockLoadTodos.mockReturnValue([makeTodo('t1', 'implement login')]);
			mockProvider.getChecklists.mockResolvedValue([
				makeChecklist('item1', [{ id: 'ci1', name: 'implement login', complete: false }]),
			]);
			mockProvider.updateChecklistItem.mockResolvedValue(undefined);

			await syncCompletedTodosToChecklist('item1');

			clearSyncedTodos();

			await syncCompletedTodosToChecklist('item1');

			expect(mockProvider.updateChecklistItem).toHaveBeenCalledTimes(2);
		});
	});

	describe('error handling', () => {
		it('handles error from updateChecklistItem gracefully', async () => {
			mockLoadTodos.mockReturnValue([makeTodo('t1', 'implement login')]);
			mockProvider.getChecklists.mockResolvedValue([
				makeChecklist('item1', [{ id: 'ci1', name: 'implement login', complete: false }]),
			]);
			mockProvider.updateChecklistItem.mockRejectedValue(new Error('API error'));

			// Should not throw
			await expect(syncCompletedTodosToChecklist('item1')).resolves.toBeUndefined();
		});

		it('handles error from getPMProvider gracefully', async () => {
			const { getPMProvider } = await import('../../../../src/pm/index.js');
			vi.mocked(getPMProvider).mockImplementationOnce(() => {
				throw new Error('No PM provider');
			});

			mockLoadTodos.mockReturnValue([makeTodo('t1', 'implement login')]);

			// Should not throw
			await expect(syncCompletedTodosToChecklist('item1')).resolves.toBeUndefined();
		});

		it('handles error from getChecklists gracefully', async () => {
			mockLoadTodos.mockReturnValue([makeTodo('t1', 'implement login')]);
			mockProvider.getChecklists.mockRejectedValue(new Error('API error'));

			await expect(syncCompletedTodosToChecklist('item1')).resolves.toBeUndefined();
		});
	});

	describe('multiple todos and checklists', () => {
		it('syncs multiple done todos', async () => {
			mockLoadTodos.mockReturnValue([
				makeTodo('t1', 'task one'),
				makeTodo('t2', 'task two'),
				makeTodo('t3', 'task three', 'pending'), // not done, should be skipped
			]);
			mockProvider.getChecklists.mockResolvedValue([
				makeChecklist('item1', [
					{ id: 'ci1', name: 'task one', complete: false },
					{ id: 'ci2', name: 'task two', complete: false },
					{ id: 'ci3', name: 'task three', complete: false },
				]),
			]);
			mockProvider.updateChecklistItem.mockResolvedValue(undefined);

			await syncCompletedTodosToChecklist('item1');

			expect(mockProvider.updateChecklistItem).toHaveBeenCalledTimes(2);
			expect(mockProvider.updateChecklistItem).toHaveBeenCalledWith('item1', 'ci1', true);
			expect(mockProvider.updateChecklistItem).toHaveBeenCalledWith('item1', 'ci2', true);
		});
	});
});
