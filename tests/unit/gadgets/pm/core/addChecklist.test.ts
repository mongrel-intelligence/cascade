import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPMProvider } from '../../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
}));

import { addChecklist } from '../../../../../src/gadgets/pm/core/addChecklist.js';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('addChecklist', () => {
	it('creates checklist and adds items', async () => {
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
		expect(mockProvider.addChecklistItem).toHaveBeenCalledWith('cl1', 'Task A');
		expect(mockProvider.addChecklistItem).toHaveBeenCalledWith('cl1', 'Task B');
		expect(result).toBe('Checklist "My Tasks" created with 2 items on work item item1');
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
