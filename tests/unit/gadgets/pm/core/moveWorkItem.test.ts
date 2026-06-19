import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPMProvider } from '../../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
}));

import { moveWorkItem } from '../../../../../src/gadgets/pm/core/moveWorkItem.js';

describe('moveWorkItem', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockProvider.getWorkItemUrl.mockReturnValue('https://trello.com/c/card1');
	});

	describe('unguarded path (no expectedSourceState)', () => {
		it('returns a structured moved result on success', async () => {
			mockProvider.moveWorkItem.mockResolvedValue(undefined);

			const result = await moveWorkItem({
				workItemId: 'card1',
				destination: 'list2',
			});

			expect(mockProvider.moveWorkItem).toHaveBeenCalledWith('card1', 'list2');
			expect(mockProvider.getWorkItem).not.toHaveBeenCalled();
			expect(result).toMatchObject({
				status: 'moved',
				id: 'card1',
				url: 'https://trello.com/c/card1',
				destination: 'list2',
			});
			expect(typeof result.updatedAt).toBe('string');
			expect(result.previousStatus).toBeUndefined();
			expect(result.previousStatusId).toBeUndefined();
		});

		it('throws on provider failure (no prose sentinel)', async () => {
			mockProvider.moveWorkItem.mockRejectedValue(new Error('API error'));

			await expect(
				moveWorkItem({
					workItemId: 'card1',
					destination: 'list2',
				}),
			).rejects.toThrow('API error');
		});

		it('propagates non-Error throws', async () => {
			mockProvider.moveWorkItem.mockRejectedValue('network timeout');

			await expect(
				moveWorkItem({
					workItemId: 'card1',
					destination: 'list2',
				}),
			).rejects.toThrow('network timeout');
		});
	});

	// ── expectedSourceState guard ────────────────────────────────────────────
	// Defends against parallel agents (e.g. two backlog-manager runs racing on
	// the same backlog) by verifying the work item is in the expected source
	// state before mutating. Live incident 2026-05-06 (MNG-538): a second
	// backlog-manager run moved MNG-538 from In Progress back to TODO,
	// triggering a duplicate implementation run (PRs #287, #288).
	describe('expectedSourceState guard', () => {
		const baseItem = {
			id: 'MNG-538',
			title: 'Persistence for tool confirmation policy',
			description: '',
			url: 'https://linear.app/mongrel/issue/MNG-538',
			labels: [],
		};

		it('returns a moved result when current status matches expectedSourceState', async () => {
			mockProvider.getWorkItem.mockResolvedValue({
				...baseItem,
				status: 'Backlog',
			});
			mockProvider.moveWorkItem.mockResolvedValue(undefined);

			const result = await moveWorkItem({
				workItemId: 'MNG-538',
				destination: 'todo-state-id',
				expectedSourceState: 'Backlog',
			});

			expect(mockProvider.getWorkItem).toHaveBeenCalledWith('MNG-538');
			expect(mockProvider.moveWorkItem).toHaveBeenCalledWith('MNG-538', 'todo-state-id');
			expect(result).toMatchObject({
				status: 'moved',
				id: 'MNG-538',
				url: 'https://linear.app/mongrel/issue/MNG-538',
				destination: 'todo-state-id',
				previousStatus: 'Backlog',
			});
		});

		it('proceeds with move when current statusId matches expectedSourceState', async () => {
			mockProvider.getWorkItem.mockResolvedValue({
				...baseItem,
				status: 'Ready',
				statusId: 'state-backlog',
			});
			mockProvider.moveWorkItem.mockResolvedValue(undefined);

			const result = await moveWorkItem({
				workItemId: 'MNG-538',
				destination: 'state-todo',
				expectedSourceState: 'state-backlog',
			});

			expect(mockProvider.moveWorkItem).toHaveBeenCalledWith('MNG-538', 'state-todo');
			expect(result.status).toBe('moved');
			expect(result.previousStatus).toBe('Ready');
			expect(result.previousStatusId).toBe('state-backlog');
		});

		it('returns aborted result when current status differs from expectedSourceState', async () => {
			mockProvider.getWorkItem.mockResolvedValue({
				...baseItem,
				status: 'In Progress',
			});

			const result = await moveWorkItem({
				workItemId: 'MNG-538',
				destination: 'todo-state-id',
				expectedSourceState: 'Backlog',
			});

			expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
			expect(result).toMatchObject({
				status: 'aborted',
				id: 'MNG-538',
				url: 'https://linear.app/mongrel/issue/MNG-538',
				destination: 'todo-state-id',
				previousStatus: 'In Progress',
			});
			expect(result.message).toContain('In Progress');
			expect(result.message).toContain('Backlog');
		});

		it('aborts when Linear issue is in an unmapped Ideas statusId', async () => {
			mockProvider.getWorkItem.mockResolvedValue({
				...baseItem,
				status: 'Ideas',
				statusId: 'state-ideas',
			});

			const result = await moveWorkItem({
				workItemId: 'MNG-700',
				destination: 'state-todo',
				expectedSourceState: 'state-backlog',
			});

			expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
			expect(result.status).toBe('aborted');
			expect(result.previousStatus).toBe('Ideas');
			expect(result.previousStatusId).toBe('state-ideas');
			expect(result.message).toContain('Ideas (state-ideas)');
			expect(result.message).toContain('state-backlog');
		});

		it('matches expectedSourceState case-insensitively (Linear vs Trello casing drift)', async () => {
			mockProvider.getWorkItem.mockResolvedValue({
				...baseItem,
				status: 'BACKLOG',
			});
			mockProvider.moveWorkItem.mockResolvedValue(undefined);

			const result = await moveWorkItem({
				workItemId: 'MNG-538',
				destination: 'todo-state-id',
				expectedSourceState: 'backlog',
			});

			expect(mockProvider.moveWorkItem).toHaveBeenCalled();
			expect(result.status).toBe('moved');
		});

		it('returns noop when current status is already the destination (idempotency)', async () => {
			// expectedSourceState matches but current status equals destination —
			// rare race where a parallel agent already moved the item. Treat as
			// no-op rather than firing a redundant Linear API call.
			mockProvider.getWorkItem.mockResolvedValue({
				...baseItem,
				status: 'Todo',
			});

			const result = await moveWorkItem({
				workItemId: 'MNG-538',
				destination: 'Todo',
				expectedSourceState: 'Backlog',
			});

			expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
			expect(result.status).toBe('noop');
			expect(result.previousStatus).toBe('Todo');
			expect(result.message).toMatch(/already|no-op/i);
		});

		it('does NOT call getWorkItem when expectedSourceState is omitted (back-compat)', async () => {
			mockProvider.moveWorkItem.mockResolvedValue(undefined);

			await moveWorkItem({
				workItemId: 'card1',
				destination: 'list2',
			});

			expect(mockProvider.getWorkItem).not.toHaveBeenCalled();
			expect(mockProvider.moveWorkItem).toHaveBeenCalledWith('card1', 'list2');
		});

		it('throws when guarded read-back throws (no prose sentinel)', async () => {
			mockProvider.getWorkItem.mockRejectedValue(new Error('API down'));

			await expect(
				moveWorkItem({
					workItemId: 'MNG-538',
					destination: 'todo-state-id',
					expectedSourceState: 'Backlog',
				}),
			).rejects.toThrow('API down');

			expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
		});
	});
});
