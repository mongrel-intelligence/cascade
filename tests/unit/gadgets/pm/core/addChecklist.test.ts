import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPMProvider } from '../../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
}));

import { addChecklist } from '../../../../../src/gadgets/pm/core/addChecklist.js';

describe('addChecklist', () => {
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
		expect(result).toBe('Checklist "My Tasks" created with 2 items on work item item1');
	});

	it('creates checklist and adds object items with descriptions', async () => {
		mockProvider.createChecklist.mockResolvedValue({
			id: 'cl1',
			name: 'Steps',
			workItemId: 'PROJ-42',
			items: [],
		});
		mockProvider.addChecklistItem.mockResolvedValue(undefined);

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
		expect(result).toBe('Checklist "Steps" created with 2 items on work item PROJ-42');
	});

	it('handles mixed string and object items', async () => {
		mockProvider.createChecklist.mockResolvedValue({
			id: 'cl1',
			name: 'Mixed',
			workItemId: 'item1',
			items: [],
		});
		mockProvider.addChecklistItem.mockResolvedValue(undefined);

		await addChecklist({
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
	});

	it('creates checklist with no items', async () => {
		mockProvider.createChecklist.mockResolvedValue({
			id: 'cl1',
			name: 'Empty',
			workItemId: 'item1',
			items: [],
		});

		const result = await addChecklist({
			workItemId: 'item1',
			checklistName: 'Empty',
			items: [],
		});

		expect(mockProvider.addChecklistItem).not.toHaveBeenCalled();
		expect(result).toBe('Checklist "Empty" created with 0 items on work item item1');
	});

	it('throws on createChecklist failure', async () => {
		mockProvider.createChecklist.mockRejectedValue(new Error('API error'));

		await expect(
			addChecklist({
				workItemId: 'item1',
				checklistName: 'Tasks',
				items: ['A'],
			}),
		).rejects.toThrow('API error');
	});

	it('throws if addChecklistItem fails', async () => {
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
