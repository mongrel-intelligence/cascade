import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPMProvider } from '../../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
}));

import { readWorkItem } from '../../../../../src/gadgets/pm/core/readWorkItem.js';

describe('readWorkItem', () => {
	const baseItem = {
		id: 'item1',
		title: 'Test Work Item',
		url: 'https://trello.com/c/item1',
		description: 'A description',
		labels: [{ id: 'l1', name: 'Bug', color: 'red' }],
	};

	it('formats work item with title, description, labels, checklists, attachments', async () => {
		mockProvider.getWorkItem.mockResolvedValue(baseItem);
		mockProvider.getChecklists.mockResolvedValue([
			{
				id: 'cl1',
				name: 'Tasks',
				workItemId: 'item1',
				items: [
					{ id: 'ci1', name: 'Item 1', complete: false },
					{ id: 'ci2', name: 'Item 2', complete: true },
				],
			},
		]);
		mockProvider.getAttachments.mockResolvedValue([
			{
				id: 'a1',
				name: 'file.txt',
				url: 'https://example.com/file.txt',
				date: '2024-01-01T00:00:00Z',
				mimeType: 'text/plain',
				bytes: 100,
			},
		]);

		const result = await readWorkItem('item1', false);

		expect(result).toContain('# Test Work Item');
		expect(result).toContain('**URL:** https://trello.com/c/item1');
		expect(result).toContain('A description');
		expect(result).toContain('Bug (red)');
		expect(result).toContain('Tasks [checklistId: cl1]');
		expect(result).toContain('[ ] Item 1 [checkItemId: ci1]');
		expect(result).toContain('[x] Item 2 [checkItemId: ci2]');
		expect(result).toContain('[file.txt](https://example.com/file.txt)');
	});

	it('shows "(No description)" when description is empty', async () => {
		mockProvider.getWorkItem.mockResolvedValue({ ...baseItem, description: '' });
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([]);

		const result = await readWorkItem('item1', false);

		expect(result).toContain('(No description)');
	});

	it('omits labels section when empty', async () => {
		mockProvider.getWorkItem.mockResolvedValue({ ...baseItem, labels: [] });
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([]);

		const result = await readWorkItem('item1', false);

		expect(result).not.toContain('## Labels');
	});

	it('omits checklists section when empty', async () => {
		mockProvider.getWorkItem.mockResolvedValue(baseItem);
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([]);

		const result = await readWorkItem('item1', false);

		expect(result).not.toContain('## Checklists');
	});

	it('omits attachments section when empty', async () => {
		mockProvider.getWorkItem.mockResolvedValue(baseItem);
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([]);

		const result = await readWorkItem('item1', false);

		expect(result).not.toContain('## Attachments');
	});

	it('fetches comments when includeComments=true', async () => {
		mockProvider.getWorkItem.mockResolvedValue(baseItem);
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([]);
		mockProvider.getWorkItemComments.mockResolvedValue([
			{
				id: 'c1',
				author: { name: 'Alice', id: 'u1', username: 'alice' },
				date: '2024-01-01T00:00:00Z',
				text: 'Hello world',
			},
		]);

		const result = await readWorkItem('item1', true);

		expect(result).toContain('## Comments (1)');
		expect(result).toContain('Alice');
		expect(result).toContain('Hello world');
		expect(mockProvider.getWorkItemComments).toHaveBeenCalledWith('item1');
	});

	it('shows "(No comments)" when includeComments=true but no comments', async () => {
		mockProvider.getWorkItem.mockResolvedValue(baseItem);
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([]);
		mockProvider.getWorkItemComments.mockResolvedValue([]);

		const result = await readWorkItem('item1', true);

		expect(result).toContain('(No comments)');
	});

	it('does not fetch comments when includeComments=false', async () => {
		mockProvider.getWorkItem.mockResolvedValue(baseItem);
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([]);

		await readWorkItem('item1', false);

		expect(mockProvider.getWorkItemComments).not.toHaveBeenCalled();
	});

	it('returns error message on failure', async () => {
		mockProvider.getWorkItem.mockRejectedValue(new Error('Network error'));

		const result = await readWorkItem('item1');

		expect(result).toContain('Error reading work item: Network error');
	});

	it('handles label without color', async () => {
		mockProvider.getWorkItem.mockResolvedValue({
			...baseItem,
			labels: [{ id: 'l1', name: 'Feature' }],
		});
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([]);

		const result = await readWorkItem('item1', false);

		expect(result).toContain('- Feature\n');
		expect(result).not.toContain('Feature (');
	});

	it('formats attachment without date', async () => {
		mockProvider.getWorkItem.mockResolvedValue(baseItem);
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([
			{
				id: 'a1',
				name: 'nodoc.txt',
				url: 'https://example.com/nodoc.txt',
				mimeType: 'text/plain',
				bytes: 0,
			},
		]);

		const result = await readWorkItem('item1', false);

		expect(result).toContain('[nodoc.txt](https://example.com/nodoc.txt)');
	});

	it('reverses comments (newest first)', async () => {
		mockProvider.getWorkItem.mockResolvedValue(baseItem);
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([]);
		mockProvider.getWorkItemComments.mockResolvedValue([
			{
				id: 'c1',
				author: { name: 'Alice', id: 'u1', username: 'alice' },
				date: '2024-01-01T00:00:00Z',
				text: 'First',
			},
			{
				id: 'c2',
				author: { name: 'Bob', id: 'u2', username: 'bob' },
				date: '2024-01-02T00:00:00Z',
				text: 'Second',
			},
		]);

		const result = await readWorkItem('item1', true);

		const firstPos = result.indexOf('First');
		const secondPos = result.indexOf('Second');
		// Second comment appears first (reversed order)
		expect(secondPos).toBeLessThan(firstPos);
	});
});
