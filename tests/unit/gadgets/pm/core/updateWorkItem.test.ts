import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockProvider = {
	type: 'trello' as const,
	getWorkItem: vi.fn(),
	getChecklists: vi.fn(),
	getAttachments: vi.fn(),
	getWorkItemComments: vi.fn(),
	updateWorkItem: vi.fn(),
	addComment: vi.fn(),
	createWorkItem: vi.fn(),
	listWorkItems: vi.fn(),
	moveWorkItem: vi.fn(),
	addLabel: vi.fn(),
	removeLabel: vi.fn(),
	createChecklist: vi.fn(),
	addChecklistItem: vi.fn(),
	updateChecklistItem: vi.fn(),
	addAttachment: vi.fn(),
	addAttachmentFile: vi.fn(),
	getCustomFieldNumber: vi.fn(),
	updateCustomFieldNumber: vi.fn(),
	getWorkItemUrl: vi.fn(),
	getAuthenticatedUser: vi.fn(),
};

vi.mock('../../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
}));

import { updateWorkItem } from '../../../../../src/gadgets/pm/core/updateWorkItem.js';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('updateWorkItem', () => {
	it('returns early message when nothing to update', async () => {
		const result = await updateWorkItem({ workItemId: 'item1' });
		expect(result).toBe('Nothing to update - provide title, description, or labels');
		expect(mockProvider.updateWorkItem).not.toHaveBeenCalled();
	});

	it('updates title only', async () => {
		mockProvider.updateWorkItem.mockResolvedValue(undefined);

		const result = await updateWorkItem({ workItemId: 'item1', title: 'New Title' });

		expect(mockProvider.updateWorkItem).toHaveBeenCalledWith('item1', {
			title: 'New Title',
			description: undefined,
		});
		expect(result).toBe('Work item updated: title');
	});

	it('updates description only', async () => {
		mockProvider.updateWorkItem.mockResolvedValue(undefined);

		const result = await updateWorkItem({ workItemId: 'item1', description: 'New description' });

		expect(mockProvider.updateWorkItem).toHaveBeenCalledWith('item1', {
			title: undefined,
			description: 'New description',
		});
		expect(result).toBe('Work item updated: description');
	});

	it('adds labels', async () => {
		mockProvider.addLabel.mockResolvedValue(undefined);

		const result = await updateWorkItem({ workItemId: 'item1', addLabelIds: ['label1', 'label2'] });

		expect(mockProvider.addLabel).toHaveBeenCalledTimes(2);
		expect(mockProvider.addLabel).toHaveBeenCalledWith('item1', 'label1');
		expect(mockProvider.addLabel).toHaveBeenCalledWith('item1', 'label2');
		expect(result).toBe('Work item updated: 2 label(s)');
	});

	it('updates title and description together', async () => {
		mockProvider.updateWorkItem.mockResolvedValue(undefined);

		const result = await updateWorkItem({ workItemId: 'item1', title: 'T', description: 'D' });

		expect(mockProvider.updateWorkItem).toHaveBeenCalledOnce();
		expect(result).toBe('Work item updated: title, description');
	});

	it('updates title, description, and labels together', async () => {
		mockProvider.updateWorkItem.mockResolvedValue(undefined);
		mockProvider.addLabel.mockResolvedValue(undefined);

		const result = await updateWorkItem({
			workItemId: 'item1',
			title: 'T',
			description: 'D',
			addLabelIds: ['l1'],
		});

		expect(result).toBe('Work item updated: title, description, 1 label(s)');
	});

	it('returns error message on failure', async () => {
		mockProvider.updateWorkItem.mockRejectedValue(new Error('API error'));

		const result = await updateWorkItem({ workItemId: 'item1', title: 'T' });

		expect(result).toBe('Error updating work item: API error');
	});

	it('does not call updateWorkItem when only labels provided', async () => {
		mockProvider.addLabel.mockResolvedValue(undefined);

		await updateWorkItem({ workItemId: 'item1', addLabelIds: ['l1'] });

		expect(mockProvider.updateWorkItem).not.toHaveBeenCalled();
	});

	it('does not add labels when addLabelIds is empty array', async () => {
		const result = await updateWorkItem({ workItemId: 'item1', addLabelIds: [] });

		expect(result).toBe('Nothing to update - provide title, description, or labels');
		expect(mockProvider.addLabel).not.toHaveBeenCalled();
	});
});
