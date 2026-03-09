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

	it('returns error string on failure', async () => {
		mockProvider.moveWorkItem.mockRejectedValue(new Error('API error'));

		const result = await moveWorkItem({
			workItemId: 'card1',
			destination: 'list2',
		});

		expect(result).toBe('Error moving work item: API error');
	});

	it('handles non-Error throws', async () => {
		mockProvider.moveWorkItem.mockRejectedValue('network timeout');

		const result = await moveWorkItem({
			workItemId: 'card1',
			destination: 'list2',
		});

		expect(result).toBe('Error moving work item: network timeout');
	});
});
