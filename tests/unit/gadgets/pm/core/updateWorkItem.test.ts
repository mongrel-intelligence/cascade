import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPMProvider, createMockWorkItem } from '../../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
}));

import { updateWorkItem } from '../../../../../src/gadgets/pm/core/updateWorkItem.js';

beforeEach(() => {
	// Default work-item read-back for the post-mutation metadata fetch.
	mockProvider.getWorkItem.mockResolvedValue(
		createMockWorkItem({
			id: 'item1',
			title: 'Stored title',
			url: 'https://trello.com/c/item1',
			updatedAt: '2026-03-15T12:00:00.000Z',
		}),
	);
	mockProvider.getWorkItemUrl.mockReturnValue('https://trello.com/c/item1');
});

describe('updateWorkItem', () => {
	describe('noop path (nothing to update)', () => {
		it('returns a structured noop result when no fields are provided', async () => {
			const result = await updateWorkItem({ workItemId: 'item1' });
			expect(result).toMatchObject({
				status: 'noop',
				id: 'item1',
				title: 'Stored title',
				url: 'https://trello.com/c/item1',
				changedFields: [],
				addedLabelIds: [],
				message: 'Nothing to update - provide title, description, or labels',
			});
			expect(typeof result.updatedAt).toBe('string');
			expect(mockProvider.updateWorkItem).not.toHaveBeenCalled();
			expect(mockProvider.addLabel).not.toHaveBeenCalled();
		});

		it('returns a structured noop when addLabelIds is empty', async () => {
			const result = await updateWorkItem({ workItemId: 'item1', addLabelIds: [] });
			expect(result.status).toBe('noop');
			expect(result.addedLabelIds).toEqual([]);
			expect(mockProvider.addLabel).not.toHaveBeenCalled();
		});
	});

	describe('updated path (provider write)', () => {
		it('updates title only and surfaces post-write metadata', async () => {
			mockProvider.updateWorkItem.mockResolvedValue(undefined);

			const result = await updateWorkItem({ workItemId: 'item1', title: 'New Title' });

			expect(mockProvider.updateWorkItem).toHaveBeenCalledWith('item1', {
				title: 'New Title',
				description: undefined,
			});
			expect(result).toEqual({
				status: 'updated',
				id: 'item1',
				title: 'Stored title',
				url: 'https://trello.com/c/item1',
				updatedAt: '2026-03-15T12:00:00.000Z',
				changedFields: ['title'],
				addedLabelIds: [],
			});
		});

		it('updates description only', async () => {
			mockProvider.updateWorkItem.mockResolvedValue(undefined);

			const result = await updateWorkItem({ workItemId: 'item1', description: 'New description' });

			expect(mockProvider.updateWorkItem).toHaveBeenCalledWith('item1', {
				title: undefined,
				description: 'New description',
			});
			expect(result.status).toBe('updated');
			expect(result.changedFields).toEqual(['description']);
			expect(result.addedLabelIds).toEqual([]);
		});

		it('adds labels and echoes addedLabelIds without writing title/description', async () => {
			mockProvider.addLabel.mockResolvedValue(undefined);

			const result = await updateWorkItem({
				workItemId: 'item1',
				addLabelIds: ['label1', 'label2'],
			});

			expect(mockProvider.addLabel).toHaveBeenCalledTimes(2);
			expect(mockProvider.addLabel).toHaveBeenCalledWith('item1', 'label1');
			expect(mockProvider.addLabel).toHaveBeenCalledWith('item1', 'label2');
			expect(mockProvider.updateWorkItem).not.toHaveBeenCalled();
			expect(result.status).toBe('updated');
			expect(result.changedFields).toEqual([]);
			expect(result.addedLabelIds).toEqual(['label1', 'label2']);
		});

		it('combines title, description, and labels in a single result', async () => {
			mockProvider.updateWorkItem.mockResolvedValue(undefined);
			mockProvider.addLabel.mockResolvedValue(undefined);

			const result = await updateWorkItem({
				workItemId: 'item1',
				title: 'T',
				description: 'D',
				addLabelIds: ['l1'],
			});

			expect(result.status).toBe('updated');
			expect(result.changedFields).toEqual(['title', 'description']);
			expect(result.addedLabelIds).toEqual(['l1']);
		});
	});

	describe('read-back fallback', () => {
		it('synthesises url + timestamp when post-write read-back throws', async () => {
			mockProvider.updateWorkItem.mockResolvedValue(undefined);
			mockProvider.getWorkItem.mockRejectedValue(new Error('Read-back failed'));
			mockProvider.getWorkItemUrl.mockReturnValue('https://fallback.example/item1');

			const result = await updateWorkItem({ workItemId: 'item1', title: 'T' });

			expect(result.status).toBe('updated');
			expect(result.url).toBe('https://fallback.example/item1');
			expect(typeof result.updatedAt).toBe('string');
			// Title falls back to the caller-supplied title when read-back fails
			expect(result.title).toBe('T');
		});
	});

	describe('error propagation', () => {
		it('throws on provider updateWorkItem failure (no prose sentinel)', async () => {
			mockProvider.updateWorkItem.mockRejectedValue(new Error('API error'));

			await expect(updateWorkItem({ workItemId: 'item1', title: 'T' })).rejects.toThrow(
				'API error',
			);
		});

		it('throws on provider addLabel failure', async () => {
			mockProvider.addLabel.mockRejectedValue(new Error('Label not found'));

			await expect(updateWorkItem({ workItemId: 'item1', addLabelIds: ['l1'] })).rejects.toThrow(
				'Label not found',
			);
		});
	});
});
