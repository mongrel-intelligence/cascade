import { describe, expect, it, vi } from 'vitest';

import { createMockPMProvider, createMockWorkItem } from '../../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
}));

import { createWorkItem } from '../../../../../src/gadgets/pm/core/createWorkItem.js';

describe('createWorkItem', () => {
	it('returns a structured WorkItemCreatedResult with provider metadata', async () => {
		mockProvider.createWorkItem.mockResolvedValue(
			createMockWorkItem({
				id: 'item1',
				title: 'New Feature',
				description: 'A new feature',
				url: 'https://trello.com/c/item1',
				updatedAt: '2026-03-15T12:00:00.000Z',
				createdAt: '2026-03-15T12:00:00.000Z',
				labels: [],
			}),
		);

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
		expect(result).toEqual({
			status: 'created',
			id: 'item1',
			title: 'New Feature',
			url: 'https://trello.com/c/item1',
			updatedAt: '2026-03-15T12:00:00.000Z',
		});
	});

	it('creates work item without description', async () => {
		mockProvider.createWorkItem.mockResolvedValue(
			createMockWorkItem({
				id: 'item2',
				title: 'Simple Item',
				description: '',
				url: 'https://trello.com/c/item2',
				updatedAt: '2026-03-15T13:00:00.000Z',
				createdAt: '2026-03-15T13:00:00.000Z',
				labels: [],
			}),
		);

		const result = await createWorkItem({
			containerId: 'list1',
			title: 'Simple Item',
		});

		expect(result).toMatchObject({
			status: 'created',
			id: 'item2',
			title: 'Simple Item',
			url: 'https://trello.com/c/item2',
		});
	});

	it('surfaces optional workflow-state fields when the provider returned them', async () => {
		mockProvider.createWorkItem.mockResolvedValue(
			createMockWorkItem({
				id: 'MNG-1',
				title: 'Linear-like create',
				description: '',
				url: 'https://linear.app/team/issue/MNG-1',
				updatedAt: '2026-03-15T14:00:00.000Z',
				status: 'Backlog',
				statusId: 'state-backlog-uuid',
			}),
		);

		const result = await createWorkItem({
			containerId: 'team-x',
			title: 'Linear-like create',
		});

		expect(result).toEqual({
			status: 'created',
			id: 'MNG-1',
			title: 'Linear-like create',
			url: 'https://linear.app/team/issue/MNG-1',
			updatedAt: '2026-03-15T14:00:00.000Z',
			workflowStatus: 'Backlog',
			workflowStatusId: 'state-backlog-uuid',
		});
	});

	it('falls back to createdAt when updatedAt is absent (creation-only providers)', async () => {
		mockProvider.createWorkItem.mockResolvedValue({
			id: 'item-only-created',
			title: 'Created-only timestamp',
			description: '',
			url: 'https://trello.com/c/item-only-created',
			labels: [],
			createdAt: '2026-03-15T15:00:00.000Z',
		});

		const result = await createWorkItem({
			containerId: 'list1',
			title: 'Created-only timestamp',
		});

		expect(result.updatedAt).toBe('2026-03-15T15:00:00.000Z');
	});

	it('synthesises a current ISO timestamp when the provider omits both timestamps', async () => {
		mockProvider.createWorkItem.mockResolvedValue({
			id: 'item-no-ts',
			title: 'No timestamps',
			description: '',
			url: 'https://trello.com/c/item-no-ts',
			labels: [],
		});

		const result = await createWorkItem({
			containerId: 'list1',
			title: 'No timestamps',
		});

		expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('throws on failure instead of swallowing errors (no prose sentinel)', async () => {
		mockProvider.createWorkItem.mockRejectedValue(new Error('API error'));

		await expect(
			createWorkItem({
				containerId: 'list1',
				title: 'Fail',
			}),
		).rejects.toThrow('API error');
	});
});
