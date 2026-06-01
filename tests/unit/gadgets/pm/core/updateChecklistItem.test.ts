import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPMProvider, createMockWorkItem } from '../../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
}));

import { updateChecklistItem } from '../../../../../src/gadgets/pm/core/updateChecklistItem.js';

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

describe('updateChecklistItem', () => {
	it('marks a checklist item as complete and returns the structured result', async () => {
		mockProvider.updateChecklistItem.mockResolvedValue(undefined);

		const result = await updateChecklistItem('item1', 'checkItem1', true);

		expect(mockProvider.updateChecklistItem).toHaveBeenCalledWith('item1', 'checkItem1', true);
		expect(result).toEqual({
			status: 'updated',
			workItemId: 'item1',
			workItemUrl: 'https://trello.com/c/item1',
			checkItemId: 'checkItem1',
			complete: true,
			updatedAt: '2026-03-15T12:00:00.000Z',
		});
	});

	it('marks a checklist item as incomplete and returns the structured result', async () => {
		mockProvider.updateChecklistItem.mockResolvedValue(undefined);

		const result = await updateChecklistItem('item1', 'checkItem1', false);

		expect(mockProvider.updateChecklistItem).toHaveBeenCalledWith('item1', 'checkItem1', false);
		expect(result).toEqual({
			status: 'updated',
			workItemId: 'item1',
			workItemUrl: 'https://trello.com/c/item1',
			checkItemId: 'checkItem1',
			complete: false,
			updatedAt: '2026-03-15T12:00:00.000Z',
		});
	});

	it('throws when the provider mutation fails (no prose sentinel)', async () => {
		mockProvider.updateChecklistItem.mockRejectedValue(new Error('API error'));

		await expect(updateChecklistItem('item1', 'checkItem1', true)).rejects.toThrow('API error');
	});

	it('propagates non-Error thrown values as-is', async () => {
		mockProvider.updateChecklistItem.mockRejectedValue('string error');

		await expect(updateChecklistItem('item1', 'ci1', false)).rejects.toBe('string error');
	});

	it('falls back to getWorkItemUrl + synthesised timestamp when read-back fails', async () => {
		mockProvider.updateChecklistItem.mockResolvedValue(undefined);
		mockProvider.getWorkItem.mockRejectedValue(new Error('Read-back failed'));
		mockProvider.getWorkItemUrl.mockReturnValue('https://fallback.example/item1');

		const result = await updateChecklistItem('item1', 'checkItem1', true);

		expect(result.status).toBe('updated');
		expect(result.workItemUrl).toBe('https://fallback.example/item1');
		expect(typeof result.updatedAt).toBe('string');
		expect(result.updatedAt.length).toBeGreaterThan(0);
	});

	it('surfaces the provider-supplied updatedAt when present', async () => {
		mockProvider.updateChecklistItem.mockResolvedValue(undefined);
		mockProvider.getWorkItem.mockResolvedValue(
			createMockWorkItem({
				id: 'PROJ-42',
				url: 'https://jira.example.com/browse/PROJ-42',
				updatedAt: '2025-12-01T01:02:03.000Z',
			}),
		);

		const result = await updateChecklistItem('PROJ-42', 'sub-1', true);

		expect(result.updatedAt).toBe('2025-12-01T01:02:03.000Z');
		expect(result.workItemUrl).toBe('https://jira.example.com/browse/PROJ-42');
	});
});
