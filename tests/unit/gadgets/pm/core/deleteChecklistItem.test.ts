import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPMProvider, createMockWorkItem } from '../../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
}));

import { deleteChecklistItem } from '../../../../../src/gadgets/pm/core/deleteChecklistItem.js';

beforeEach(() => {
	vi.clearAllMocks();
	mockProvider.getWorkItem.mockResolvedValue(
		createMockWorkItem({
			id: 'item1',
			url: 'https://trello.com/c/item1',
			updatedAt: '2026-03-15T12:00:00.000Z',
		}),
	);
	mockProvider.getWorkItemUrl.mockReturnValue('https://trello.com/c/item1');
});

describe('deleteChecklistItem', () => {
	it('deletes a checklist item and returns the structured result', async () => {
		mockProvider.deleteChecklistItem.mockResolvedValue(undefined);

		const result = await deleteChecklistItem('item1', 'checkItem1');

		expect(mockProvider.deleteChecklistItem).toHaveBeenCalledWith('item1', 'checkItem1');
		expect(result).toEqual({
			status: 'deleted',
			workItemId: 'item1',
			workItemUrl: 'https://trello.com/c/item1',
			checkItemId: 'checkItem1',
			updatedAt: '2026-03-15T12:00:00.000Z',
		});
	});

	it('throws when the provider mutation fails (no prose sentinel)', async () => {
		mockProvider.deleteChecklistItem.mockRejectedValue(new Error('API error'));

		await expect(deleteChecklistItem('item1', 'checkItem1')).rejects.toThrow('API error');
	});

	it('propagates non-Error thrown values as-is', async () => {
		mockProvider.deleteChecklistItem.mockRejectedValue('string error');

		await expect(deleteChecklistItem('item1', 'ci1')).rejects.toBe('string error');
	});

	it('falls back to getWorkItemUrl + synthesised timestamp when read-back fails', async () => {
		mockProvider.deleteChecklistItem.mockResolvedValue(undefined);
		mockProvider.getWorkItem.mockRejectedValue(new Error('Read-back failed'));
		mockProvider.getWorkItemUrl.mockReturnValue('https://fallback.example/item1');

		const result = await deleteChecklistItem('item1', 'checkItem1');

		expect(result.status).toBe('deleted');
		expect(result.workItemUrl).toBe('https://fallback.example/item1');
		expect(typeof result.updatedAt).toBe('string');
		expect(result.updatedAt.length).toBeGreaterThan(0);
	});

	it('surfaces the provider-supplied updatedAt when present', async () => {
		mockProvider.deleteChecklistItem.mockResolvedValue(undefined);
		mockProvider.getWorkItem.mockResolvedValue(
			createMockWorkItem({
				id: 'PROJ-42',
				url: 'https://jira.example.com/browse/PROJ-42',
				updatedAt: '2025-12-01T01:02:03.000Z',
			}),
		);

		const result = await deleteChecklistItem('PROJ-42', 'sub-48');

		expect(result.updatedAt).toBe('2025-12-01T01:02:03.000Z');
		expect(result.workItemUrl).toBe('https://jira.example.com/browse/PROJ-42');
	});
});
