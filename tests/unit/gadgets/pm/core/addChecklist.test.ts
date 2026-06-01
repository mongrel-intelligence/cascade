import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPMProvider, createMockWorkItem } from '../../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
}));

import { addChecklist } from '../../../../../src/gadgets/pm/core/addChecklist.js';

const providerWithBulk = mockProvider as typeof mockProvider & {
	createChecklistWithItems?: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
	vi.clearAllMocks();
	delete providerWithBulk.createChecklistWithItems;
	// Default work-item read-back for URL + updatedAt. Individual tests
	// override `getWorkItem` to stub provider-specific timestamps.
	mockProvider.getWorkItem.mockResolvedValue(
		createMockWorkItem({
			id: 'item1',
			url: 'https://trello.com/c/item1',
			updatedAt: '2026-03-15T12:00:00.000Z',
		}),
	);
	mockProvider.getWorkItemUrl.mockReturnValue('https://trello.com/c/item1');
});

describe('addChecklist', () => {
	describe('inline-style (bulk path / createChecklistWithItems)', () => {
		it('uses provider bulk creation when available and returns the structured result', async () => {
			providerWithBulk.createChecklistWithItems = vi.fn().mockResolvedValue({
				id: 'cl1',
				name: 'My Tasks',
				workItemId: 'item1',
				// Inline-description providers (Linear/JIRA) return deterministic
				// hashed item IDs from the bulk path — mirror that shape here.
				items: [
					{ id: 'task-a-hash', name: 'Task A', complete: false },
					{ id: 'task-b-hash', name: 'Task B', complete: false },
				],
			});

			const result = await addChecklist({
				workItemId: 'item1',
				checklistName: 'My Tasks',
				items: ['Task A', { name: 'Task B', description: 'Details' }],
			});

			expect(providerWithBulk.createChecklistWithItems).toHaveBeenCalledTimes(1);
			expect(providerWithBulk.createChecklistWithItems).toHaveBeenCalledWith('item1', 'My Tasks', [
				{ name: 'Task A', checked: false },
				{ name: 'Task B', checked: false, description: 'Details' },
			]);
			expect(mockProvider.createChecklist).not.toHaveBeenCalled();
			expect(mockProvider.addChecklistItem).not.toHaveBeenCalled();
			expect(result).toEqual({
				status: 'created',
				checklistId: 'cl1',
				checklistName: 'My Tasks',
				workItemId: 'item1',
				workItemUrl: 'https://trello.com/c/item1',
				updatedAt: '2026-03-15T12:00:00.000Z',
				itemCount: 2,
				itemIds: ['task-a-hash', 'task-b-hash'],
			});
		});

		it('returns an empty itemIds array when the bulk path returns no item IDs', async () => {
			providerWithBulk.createChecklistWithItems = vi.fn().mockResolvedValue({
				id: 'cl1',
				name: 'My Tasks',
				workItemId: 'item1',
				items: [],
			});

			const result = await addChecklist({
				workItemId: 'item1',
				checklistName: 'My Tasks',
				items: ['Task A'],
			});

			expect(result.itemIds).toEqual([]);
			expect(result.itemCount).toBe(1);
		});
	});

	describe('native-style (per-item fallback path)', () => {
		it('creates checklist and adds string items', async () => {
			mockProvider.createChecklist.mockResolvedValue({
				id: 'cl1',
				name: 'My Tasks',
				workItemId: 'item1',
				items: [],
			});
			mockProvider.addChecklistItem.mockResolvedValue(undefined);

			const result = await addChecklist({
				workItemId: 'item1',
				checklistName: 'My Tasks',
				items: ['Task A', 'Task B'],
			});

			expect(mockProvider.createChecklist).toHaveBeenCalledWith('item1', 'My Tasks');
			expect(mockProvider.addChecklistItem).toHaveBeenCalledTimes(2);
			expect(mockProvider.addChecklistItem).toHaveBeenCalledWith('cl1', 'Task A', false, undefined);
			expect(mockProvider.addChecklistItem).toHaveBeenCalledWith('cl1', 'Task B', false, undefined);
			expect(result).toEqual({
				status: 'created',
				checklistId: 'cl1',
				checklistName: 'My Tasks',
				workItemId: 'item1',
				workItemUrl: 'https://trello.com/c/item1',
				updatedAt: '2026-03-15T12:00:00.000Z',
				itemCount: 2,
				itemIds: [],
			});
		});

		it('creates checklist and adds object items with descriptions', async () => {
			mockProvider.createChecklist.mockResolvedValue({
				id: 'cl1',
				name: 'Steps',
				workItemId: 'PROJ-42',
				items: [],
			});
			mockProvider.addChecklistItem.mockResolvedValue(undefined);
			mockProvider.getWorkItem.mockResolvedValue(
				createMockWorkItem({
					id: 'PROJ-42',
					url: 'https://jira.example.com/browse/PROJ-42',
					updatedAt: '2026-03-15T13:00:00.000Z',
				}),
			);

			const result = await addChecklist({
				workItemId: 'PROJ-42',
				checklistName: 'Steps',
				items: [
					{ name: 'Add endpoint', description: '**Files:** `src/api.ts`\n- Add POST route' },
					{ name: 'Write tests' },
				],
			});

			expect(mockProvider.addChecklistItem).toHaveBeenCalledTimes(2);
			expect(mockProvider.addChecklistItem).toHaveBeenCalledWith(
				'cl1',
				'Add endpoint',
				false,
				'**Files:** `src/api.ts`\n- Add POST route',
			);
			expect(mockProvider.addChecklistItem).toHaveBeenCalledWith(
				'cl1',
				'Write tests',
				false,
				undefined,
			);
			expect(result).toMatchObject({
				status: 'created',
				checklistId: 'cl1',
				checklistName: 'Steps',
				workItemId: 'PROJ-42',
				workItemUrl: 'https://jira.example.com/browse/PROJ-42',
				updatedAt: '2026-03-15T13:00:00.000Z',
				itemCount: 2,
			});
		});

		it('handles mixed string and object items', async () => {
			mockProvider.createChecklist.mockResolvedValue({
				id: 'cl1',
				name: 'Mixed',
				workItemId: 'item1',
				items: [],
			});
			mockProvider.addChecklistItem.mockResolvedValue(undefined);

			const result = await addChecklist({
				workItemId: 'item1',
				checklistName: 'Mixed',
				items: [
					'Simple string item',
					{ name: 'Object item', description: 'Detailed description' },
					'Another string',
				],
			});

			expect(mockProvider.addChecklistItem).toHaveBeenCalledTimes(3);
			expect(mockProvider.addChecklistItem).toHaveBeenCalledWith(
				'cl1',
				'Simple string item',
				false,
				undefined,
			);
			expect(mockProvider.addChecklistItem).toHaveBeenCalledWith(
				'cl1',
				'Object item',
				false,
				'Detailed description',
			);
			expect(mockProvider.addChecklistItem).toHaveBeenCalledWith(
				'cl1',
				'Another string',
				false,
				undefined,
			);
			expect(result.itemCount).toBe(3);
		});
	});

	describe('validation and provider errors', () => {
		it('throws error when creating checklist with no items', async () => {
			await expect(
				addChecklist({
					workItemId: 'item1',
					checklistName: 'Empty',
					items: [],
				}),
			).rejects.toThrow('At least one checklist item is required');

			expect(mockProvider.createChecklist).not.toHaveBeenCalled();
			expect(mockProvider.addChecklistItem).not.toHaveBeenCalled();
		});

		it('throws on createChecklist failure (no prose sentinel)', async () => {
			mockProvider.createChecklist.mockRejectedValue(new Error('API error'));

			await expect(
				addChecklist({
					workItemId: 'item1',
					checklistName: 'Tasks',
					items: ['A'],
				}),
			).rejects.toThrow('API error');
		});

		it('throws on createChecklistWithItems failure (no prose sentinel)', async () => {
			providerWithBulk.createChecklistWithItems = vi
				.fn()
				.mockRejectedValue(new Error('Bulk creation failed'));

			await expect(
				addChecklist({
					workItemId: 'item1',
					checklistName: 'Tasks',
					items: ['A'],
				}),
			).rejects.toThrow('Bulk creation failed');
		});

		it('throws if addChecklistItem fails (no prose sentinel)', async () => {
			mockProvider.createChecklist.mockResolvedValue({
				id: 'cl1',
				name: 'Tasks',
				workItemId: 'item1',
				items: [],
			});
			mockProvider.addChecklistItem.mockRejectedValue(new Error('Add item failed'));

			await expect(
				addChecklist({
					workItemId: 'item1',
					checklistName: 'Tasks',
					items: ['A'],
				}),
			).rejects.toThrow('Add item failed');
		});
	});

	describe('read-back fallback', () => {
		// A successful mutation must not be masked by a failing work-item
		// read-back — the helper at `readWorkItemContext` swallows the
		// read-back error and synthesises a fallback URL+timestamp.
		it('falls back to getWorkItemUrl + synthesised timestamp when read-back throws', async () => {
			providerWithBulk.createChecklistWithItems = vi.fn().mockResolvedValue({
				id: 'cl1',
				name: 'Tasks',
				workItemId: 'item1',
				items: [{ id: 'a-hash', name: 'A', complete: false }],
			});
			mockProvider.getWorkItem.mockRejectedValue(new Error('Read-back failed'));
			mockProvider.getWorkItemUrl.mockReturnValue('https://fallback.example/item1');

			const result = await addChecklist({
				workItemId: 'item1',
				checklistName: 'Tasks',
				items: ['A'],
			});

			expect(result.status).toBe('created');
			expect(result.workItemUrl).toBe('https://fallback.example/item1');
			expect(typeof result.updatedAt).toBe('string');
			expect(result.updatedAt.length).toBeGreaterThan(0);
		});

		it('synthesises updatedAt when the provider omits it on read-back', async () => {
			providerWithBulk.createChecklistWithItems = vi.fn().mockResolvedValue({
				id: 'cl1',
				name: 'Tasks',
				workItemId: 'item1',
				items: [],
			});
			mockProvider.getWorkItem.mockResolvedValue(
				createMockWorkItem({
					id: 'item1',
					url: 'https://trello.com/c/item1',
					updatedAt: undefined,
				}),
			);

			const result = await addChecklist({
				workItemId: 'item1',
				checklistName: 'Tasks',
				items: ['A'],
			});

			expect(result.workItemUrl).toBe('https://trello.com/c/item1');
			expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		});
	});
});
