import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPMProvider } from '../../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
}));

import { deleteChecklistItem } from '../../../../../src/gadgets/pm/core/deleteChecklistItem.js';

describe('deleteChecklistItem', () => {
	it('deletes a checklist item and returns success message', async () => {
		mockProvider.deleteChecklistItem.mockResolvedValue(undefined);

		const result = await deleteChecklistItem('item1', 'checkItem1');

		expect(mockProvider.deleteChecklistItem).toHaveBeenCalledWith('item1', 'checkItem1');
		expect(result).toBe('Checklist item checkItem1 deleted from work item item1');
	});

	it('returns error message on failure', async () => {
		mockProvider.deleteChecklistItem.mockRejectedValue(new Error('API error'));

		const result = await deleteChecklistItem('item1', 'checkItem1');

		expect(result).toBe('Error deleting checklist item: API error');
	});

	it('handles non-Error thrown value', async () => {
		mockProvider.deleteChecklistItem.mockRejectedValue('string error');

		const result = await deleteChecklistItem('item1', 'ci1');

		expect(result).toBe('Error deleting checklist item: string error');
	});
});
