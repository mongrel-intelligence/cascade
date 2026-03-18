import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPMProvider } from '../../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
	filterImageMedia: vi.fn((refs) => refs.filter((r) => r.mimeType.startsWith('image/'))),
}));

import {
	readWorkItem,
	readWorkItemWithMedia,
} from '../../../../../src/gadgets/pm/core/readWorkItem.js';

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

describe('readWorkItemWithMedia', () => {
	const baseItem = {
		id: 'item1',
		title: 'Media Work Item',
		url: 'https://trello.com/c/item1',
		description: 'A description',
		labels: [],
	};

	it('returns text and empty media when no inlineMedia on work item', async () => {
		mockProvider.getWorkItem.mockResolvedValue(baseItem);
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([]);
		mockProvider.getWorkItemComments.mockResolvedValue([]);

		const result = await readWorkItemWithMedia('item1', true);

		expect(result.text).toContain('# Media Work Item');
		expect(result.media).toEqual([]);
		expect(result.text).not.toContain('## Pre-fetched Images');
	});

	it('collects image media from work item inlineMedia', async () => {
		mockProvider.getWorkItem.mockResolvedValue({
			...baseItem,
			inlineMedia: [
				{ url: 'https://example.com/img.png', mimeType: 'image/png', source: 'description' },
			],
		});
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([]);
		mockProvider.getWorkItemComments.mockResolvedValue([]);

		const result = await readWorkItemWithMedia('item1', true);

		expect(result.media).toHaveLength(1);
		expect(result.media[0].url).toBe('https://example.com/img.png');
		expect(result.media[0].mimeType).toBe('image/png');
		expect(result.text).toContain('## Pre-fetched Images');
		expect(result.text).toContain('[Image: img.png]');
	});

	it('collects image media from comments inlineMedia', async () => {
		mockProvider.getWorkItem.mockResolvedValue(baseItem);
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([]);
		mockProvider.getWorkItemComments.mockResolvedValue([
			{
				id: 'c1',
				author: { name: 'Alice', id: 'u1', username: 'alice' },
				date: '2024-01-01T00:00:00Z',
				text: 'See this image',
				inlineMedia: [
					{
						url: 'https://example.com/screenshot.jpg',
						mimeType: 'image/jpeg',
						altText: 'screenshot',
						source: 'comment' as const,
					},
				],
			},
		]);

		const result = await readWorkItemWithMedia('item1', true);

		expect(result.media).toHaveLength(1);
		expect(result.media[0].url).toBe('https://example.com/screenshot.jpg');
		expect(result.media[0].source).toBe('comment');
		expect(result.text).toContain('## Pre-fetched Images');
		expect(result.text).toContain('[Image: screenshot]');
	});

	it('collects media from both work item and comments', async () => {
		mockProvider.getWorkItem.mockResolvedValue({
			...baseItem,
			inlineMedia: [
				{
					url: 'https://example.com/desc.png',
					mimeType: 'image/png',
					altText: 'diagram',
					source: 'description' as const,
				},
			],
		});
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([]);
		mockProvider.getWorkItemComments.mockResolvedValue([
			{
				id: 'c1',
				author: { name: 'Alice', id: 'u1', username: 'alice' },
				date: '2024-01-01T00:00:00Z',
				text: 'Comment with image',
				inlineMedia: [
					{
						url: 'https://example.com/comment.gif',
						mimeType: 'image/gif',
						source: 'comment' as const,
					},
				],
			},
		]);

		const result = await readWorkItemWithMedia('item1', true);

		expect(result.media).toHaveLength(2);
		expect(result.media[0].url).toBe('https://example.com/desc.png');
		expect(result.media[1].url).toBe('https://example.com/comment.gif');
	});

	it('does not collect non-image media references', async () => {
		mockProvider.getWorkItem.mockResolvedValue({
			...baseItem,
			inlineMedia: [
				{
					url: 'https://example.com/doc.pdf',
					mimeType: 'application/pdf',
					source: 'description' as const,
				},
			],
		});
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([]);
		mockProvider.getWorkItemComments.mockResolvedValue([]);

		const result = await readWorkItemWithMedia('item1', true);

		expect(result.media).toEqual([]);
		expect(result.text).not.toContain('## Pre-fetched Images');
	});

	it('does not collect comment media when includeComments=false', async () => {
		mockProvider.getWorkItem.mockResolvedValue(baseItem);
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([]);

		const result = await readWorkItemWithMedia('item1', false);

		expect(result.media).toEqual([]);
		expect(mockProvider.getWorkItemComments).not.toHaveBeenCalled();
	});

	it('collects image-type card attachments as media references', async () => {
		mockProvider.getWorkItem.mockResolvedValue(baseItem);
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([
			{
				id: 'a1',
				name: 'screenshot.png',
				url: 'https://trello.com/attachments/screenshot.png',
				mimeType: 'image/png',
				bytes: 50000,
			},
			{
				id: 'a2',
				name: 'document.pdf',
				url: 'https://trello.com/attachments/document.pdf',
				mimeType: 'application/pdf',
				bytes: 10000,
			},
		]);
		mockProvider.getWorkItemComments.mockResolvedValue([]);

		const result = await readWorkItemWithMedia('item1', true);

		expect(result.media).toHaveLength(1);
		expect(result.media[0].url).toBe('https://trello.com/attachments/screenshot.png');
		expect(result.media[0].mimeType).toBe('image/png');
		expect(result.media[0].altText).toBe('screenshot.png');
		expect(result.media[0].source).toBe('attachment');
		expect(result.text).toContain('## Pre-fetched Images');
		expect(result.text).toContain('[Image: screenshot.png]');
	});

	it('excludes non-image mimeType attachments from media', async () => {
		mockProvider.getWorkItem.mockResolvedValue(baseItem);
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([
			{
				id: 'a1',
				name: 'document.pdf',
				url: 'https://trello.com/attachments/document.pdf',
				mimeType: 'application/pdf',
				bytes: 10000,
				date: '2024-01-01T00:00:00Z',
			},
		]);
		mockProvider.getWorkItemComments.mockResolvedValue([]);

		const result = await readWorkItemWithMedia('item1', true);

		expect(result.media).toEqual([]);
	});

	it('shows alt text in inline media section when provided', async () => {
		mockProvider.getWorkItem.mockResolvedValue({
			...baseItem,
			inlineMedia: [
				{
					url: 'https://example.com/flow-diagram.png',
					mimeType: 'image/png',
					altText: 'Architecture Diagram',
					source: 'description' as const,
				},
			],
		});
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([]);
		mockProvider.getWorkItemComments.mockResolvedValue([]);

		const result = await readWorkItemWithMedia('item1', true);

		expect(result.text).toContain('[Image: Architecture Diagram]');
	});

	it('deduplicates media when same URL appears in both inlineMedia and attachments', async () => {
		const sharedUrl = 'https://jira.example.com/secure/attachment/10001/diagram.png';
		mockProvider.getWorkItem.mockResolvedValue({
			...baseItem,
			inlineMedia: [
				{
					url: sharedUrl,
					mimeType: 'image/png',
					altText: 'diagram',
					source: 'description' as const,
				},
			],
		});
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([
			{
				id: 'a1',
				name: 'diagram.png',
				url: sharedUrl,
				mimeType: 'image/png',
				bytes: 5000,
				date: '2024-01-01T00:00:00Z',
			},
		]);
		mockProvider.getWorkItemComments.mockResolvedValue([]);

		const result = await readWorkItemWithMedia('item1', true);

		// Same URL from description and attachment — must appear only once
		expect(result.media).toHaveLength(1);
		// description source wins (first occurrence)
		expect(result.media[0].source).toBe('description');
		// Should appear once in the Pre-fetched Images section
		expect(result.text.match(/\[Image: diagram\]/g)).toHaveLength(1);
	});
});
