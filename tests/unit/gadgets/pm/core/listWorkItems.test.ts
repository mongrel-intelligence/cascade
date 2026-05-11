import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPMProvider } from '../../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
}));

import { listWorkItems } from '../../../../../src/gadgets/pm/core/listWorkItems.js';

describe('listWorkItems', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns "No work items found." when list is empty', async () => {
		mockProvider.listWorkItems.mockResolvedValue([]);

		const result = await listWorkItems('list1');

		expect(mockProvider.listWorkItems).toHaveBeenCalledWith('list1', {});
		expect(result).toBe('No work items found.');
	});

	it('passes status filter without requiring a container ID', async () => {
		mockProvider.listWorkItems.mockResolvedValue([]);

		await listWorkItems({ status: 'backlog' });

		expect(mockProvider.listWorkItems).toHaveBeenCalledWith(undefined, { status: 'backlog' });
	});

	it('passes both containerId and status when supplied', async () => {
		mockProvider.listWorkItems.mockResolvedValue([]);

		await listWorkItems({ containerId: 'team-1', status: 'todo' });

		expect(mockProvider.listWorkItems).toHaveBeenCalledWith('team-1', { status: 'todo' });
	});

	it('rejects missing containerId and status', async () => {
		await expect(listWorkItems({})).rejects.toThrow(
			'Error listing work items: Either containerId or status is required.',
		);
	});

	it('rejects unfiltered backlog-manager listing', async () => {
		const originalAgentType = process.env.CASCADE_AGENT_TYPE;
		process.env.CASCADE_AGENT_TYPE = 'backlog-manager';
		try {
			await expect(listWorkItems({ containerId: 'team-1' })).rejects.toThrow(
				'Backlog-manager must list work items with a status filter',
			);
		} finally {
			if (originalAgentType === undefined) {
				delete process.env.CASCADE_AGENT_TYPE;
			} else {
				process.env.CASCADE_AGENT_TYPE = originalAgentType;
			}
		}
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

	it('throws an error message on failure', async () => {
		mockProvider.listWorkItems.mockRejectedValue(new Error('API error'));

		await expect(listWorkItems('list1')).rejects.toThrow('Error listing work items: API error');
	});
});
