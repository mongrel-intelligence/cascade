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
	});

	it('calls provider.moveWorkItem with correct args and returns success message', async () => {
		mockProvider.moveWorkItem.mockResolvedValue(undefined);

		const result = await moveWorkItem({
			workItemId: 'card1',
			destination: 'list2',
		});

		expect(mockProvider.moveWorkItem).toHaveBeenCalledWith('card1', 'list2');
		expect(result).toBe('Work item card1 moved to list2 successfully');
	});

	it('throws an error message on failure', async () => {
		mockProvider.moveWorkItem.mockRejectedValue(new Error('API error'));

		await expect(
			moveWorkItem({
				workItemId: 'card1',
				destination: 'list2',
			}),
		).rejects.toThrow('Error moving work item: API error');
	});

	it('handles non-Error throws', async () => {
		mockProvider.moveWorkItem.mockRejectedValue('network timeout');

		await expect(
			moveWorkItem({
				workItemId: 'card1',
				destination: 'list2',
			}),
		).rejects.toThrow('Error moving work item: network timeout');
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

		it('proceeds with move when current status matches expectedSourceState', async () => {
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
			expect(result).toContain('moved');
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
			expect(result).toContain('moved');
		});

		it('aborts move when current status differs from expectedSourceState', async () => {
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
			expect(result).toMatch(/Aborted|aborted|skipped/);
			expect(result).toContain('In Progress');
			expect(result).toContain('Backlog');
		});

		it('aborts move when Linear issue is in an unmapped Ideas statusId', async () => {
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
			expect(result).toContain('Ideas (state-ideas)');
			expect(result).toContain('state-backlog');
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
			expect(result).toContain('moved');
		});

		it('skips silently when current status is already the destination (idempotency)', async () => {
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
			expect(result).toMatch(/already|no-op|aborted/i);
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

		it('throws a structured error if getWorkItem throws', async () => {
			mockProvider.getWorkItem.mockRejectedValue(new Error('API down'));

			await expect(
				moveWorkItem({
					workItemId: 'MNG-538',
					destination: 'todo-state-id',
					expectedSourceState: 'Backlog',
				}),
			).rejects.toThrow('Error moving work item: API down');

			expect(mockProvider.moveWorkItem).not.toHaveBeenCalled();
		});
	});
});
