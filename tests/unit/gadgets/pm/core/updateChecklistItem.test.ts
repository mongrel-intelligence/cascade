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

import { updateChecklistItem } from '../../../../../src/gadgets/pm/core/updateChecklistItem.js';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('updateChecklistItem', () => {
	it('marks a checklist item as complete', async () => {
		mockProvider.updateChecklistItem.mockResolvedValue(undefined);

		const result = await updateChecklistItem('item1', 'checkItem1', true);

		expect(mockProvider.updateChecklistItem).toHaveBeenCalledWith('item1', 'checkItem1', true);
		expect(result).toBe('Checklist item checkItem1 marked complete on work item item1');
	});

	it('marks a checklist item as incomplete', async () => {
		mockProvider.updateChecklistItem.mockResolvedValue(undefined);

		const result = await updateChecklistItem('item1', 'checkItem1', false);

		expect(mockProvider.updateChecklistItem).toHaveBeenCalledWith('item1', 'checkItem1', false);
		expect(result).toBe('Checklist item checkItem1 marked incomplete on work item item1');
	});

	it('returns error message on failure', async () => {
		mockProvider.updateChecklistItem.mockRejectedValue(new Error('API error'));

		const result = await updateChecklistItem('item1', 'checkItem1', true);

		expect(result).toBe('Error updating checklist item: API error');
	});

	it('handles non-Error thrown value', async () => {
		mockProvider.updateChecklistItem.mockRejectedValue('string error');

		const result = await updateChecklistItem('item1', 'ci1', false);

		expect(result).toBe('Error updating checklist item: string error');
	});
});
