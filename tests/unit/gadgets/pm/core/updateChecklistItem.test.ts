import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPMProvider } from '../../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

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
