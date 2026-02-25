import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPMProvider } from '../../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
}));

import { createWorkItem } from '../../../../../src/gadgets/pm/core/createWorkItem.js';

describe('createWorkItem', () => {
	it('creates a work item and returns success message', async () => {
		mockProvider.createWorkItem.mockResolvedValue({
			id: 'item1',
			title: 'New Feature',
			description: 'A new feature',
			url: 'https://trello.com/c/item1',
			labels: [],
		});

		const result = await createWorkItem({
			containerId: 'list1',
			title: 'New Feature',
			description: 'A new feature',
		});

		expect(mockProvider.createWorkItem).toHaveBeenCalledWith({
			containerId: 'list1',
			title: 'New Feature',
			description: 'A new feature',
		});
		expect(result).toBe(
			'Work item created successfully: "New Feature" - https://trello.com/c/item1',
		);
	});

	it('creates work item without description', async () => {
		mockProvider.createWorkItem.mockResolvedValue({
			id: 'item2',
			title: 'Simple Item',
			description: '',
			url: 'https://trello.com/c/item2',
			labels: [],
		});

		const result = await createWorkItem({
			containerId: 'list1',
			title: 'Simple Item',
		});

		expect(result).toBe(
			'Work item created successfully: "Simple Item" - https://trello.com/c/item2',
		);
	});

	it('throws on failure instead of swallowing errors', async () => {
		mockProvider.createWorkItem.mockRejectedValue(new Error('API error'));

		await expect(
			createWorkItem({
				containerId: 'list1',
				title: 'Fail',
			}),
		).rejects.toThrow('API error');
	});
});
