import { describe, expect, it, vi } from 'vitest';

import { createMockPMProvider } from '../../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
}));

import { listWorkItems } from '../../../../../src/gadgets/pm/core/listWorkItems.js';

describe('listWorkItems', () => {
	it('returns "No work items found." when list is empty', async () => {
		mockProvider.listWorkItems.mockResolvedValue([]);

		const result = await listWorkItems('list1');

		expect(result).toBe('No work items found.');
	});

	it('formats work items with title, id, url', async () => {
		mockProvider.listWorkItems.mockResolvedValue([
			{
				id: 'item1',
				title: 'First Item',
				url: 'https://trello.com/c/item1',
				description: 'Short desc',
				labels: [],
			},
			{
				id: 'item2',
				title: 'Second Item',
				url: 'https://trello.com/c/item2',
				description: '',
				labels: [],
			},
		]);

		const result = await listWorkItems('list1');

		expect(result).toContain('# Work Items (2)');
		expect(result).toContain('## First Item');
		expect(result).toContain('- **ID:** item1');
		expect(result).toContain('- **URL:** https://trello.com/c/item1');
		expect(result).toContain('## Second Item');
		expect(result).toContain('- **ID:** item2');
	});

	it('truncates long descriptions', async () => {
		const longDesc = 'A'.repeat(150);
		mockProvider.listWorkItems.mockResolvedValue([
			{
				id: 'item1',
				title: 'Item',
				url: 'https://trello.com/c/item1',
				description: longDesc,
				labels: [],
			},
		]);

		const result = await listWorkItems('list1');

		expect(result).toContain('...');
		// Description truncated to 100 chars + '...'
		expect(result).toContain('A'.repeat(100));
		expect(result).not.toContain('A'.repeat(101));
	});

	it('omits description when empty', async () => {
		mockProvider.listWorkItems.mockResolvedValue([
			{
				id: 'item1',
				title: 'Item',
				url: 'https://trello.com/c/item1',
				description: '',
				labels: [],
			},
		]);

		const result = await listWorkItems('list1');

		expect(result).not.toContain('**Description:**');
	});

	it('includes short description without truncation', async () => {
		mockProvider.listWorkItems.mockResolvedValue([
			{
				id: 'item1',
				title: 'Item',
				url: 'https://trello.com/c/item1',
				description: 'Short',
				labels: [],
			},
		]);

		const result = await listWorkItems('list1');

		expect(result).toContain('**Description:** Short');
		expect(result).not.toContain('...');
	});

	it('returns error message on failure', async () => {
		mockProvider.listWorkItems.mockRejectedValue(new Error('API error'));

		const result = await listWorkItems('list1');

		expect(result).toBe('Error listing work items: API error');
	});
});
