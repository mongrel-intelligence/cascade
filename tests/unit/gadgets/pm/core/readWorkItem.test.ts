import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPMProvider } from '../../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

const { mockDownloadAndPrepareImages, mockWriteRuntimeImages } = vi.hoisted(() => ({
	mockDownloadAndPrepareImages: vi.fn().mockResolvedValue({ images: [], failures: [] }),
	mockWriteRuntimeImages: vi.fn().mockResolvedValue({ paths: [], failures: [] }),
}));

vi.mock('../../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
	filterImageMedia: vi.fn((refs) => refs.filter((r) => r.mimeType.startsWith('image/'))),
	getPMProviderOrNull: vi.fn(() => mockProvider),
}));

vi.mock('../../../../../src/pm/download-and-prepare.js', () => ({
	downloadAndPrepareImages: mockDownloadAndPrepareImages,
}));

vi.mock('../../../../../src/gadgets/pm/core/writeRuntimeImages.js', () => ({
	writeRuntimeImages: mockWriteRuntimeImages,
}));

vi.mock('../../../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
	readStructuredWorkItemDetails,
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

	it('throws an error message on failure', async () => {
		mockProvider.getWorkItem.mockRejectedValue(new Error('Network error'));

		await expect(readWorkItem('item1')).rejects.toThrow('Error reading work item: Network error');
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

	// =====================================================================
	// Spec 016/2: runtime gadget downloads + writes images to disk
	// =====================================================================
	describe('spec 016/2 — runtime image delivery', () => {
		beforeEach(() => {
			mockDownloadAndPrepareImages.mockReset();
			mockDownloadAndPrepareImages.mockResolvedValue({ images: [], failures: [] });
			mockWriteRuntimeImages.mockReset();
			mockWriteRuntimeImages.mockResolvedValue({ paths: [], failures: [] });
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it('when work item has images, downloads + writes them and inlines paths into text', async () => {
			mockProvider.getWorkItem.mockResolvedValue({
				...baseItem,
				inlineMedia: [
					{
						url: 'https://uploads.linear.app/abc',
						mimeType: 'image/*',
						altText: 'Screenshot.png',
						source: 'description',
					},
				],
			});
			mockProvider.getChecklists.mockResolvedValue([]);
			mockProvider.getAttachments.mockResolvedValue([]);
			mockDownloadAndPrepareImages.mockResolvedValue({
				images: [
					{
						base64Data: Buffer.from('PNG').toString('base64'),
						mimeType: 'image/png',
						altText: 'Screenshot.png',
					},
				],
				failures: [],
			});
			mockWriteRuntimeImages.mockResolvedValue({
				paths: ['.cascade/context/images/work-item-item1-img-0.png'],
				failures: [],
			});

			const result = await readWorkItem('item1', false);

			// Text should mention the on-disk path the agent can Read.
			expect(result).toContain('.cascade/context/images/work-item-item1-img-0.png');
			expect(mockDownloadAndPrepareImages).toHaveBeenCalledTimes(1);
			expect(mockWriteRuntimeImages).toHaveBeenCalledTimes(1);
			expect(mockWriteRuntimeImages).toHaveBeenCalledWith(
				expect.objectContaining({
					workItemId: 'item1',
					images: expect.arrayContaining([expect.objectContaining({ mimeType: 'image/png' })]),
				}),
			);
		});

		it('when work item has no images, returns text unchanged (no disk write)', async () => {
			mockProvider.getWorkItem.mockResolvedValue(baseItem);
			mockProvider.getChecklists.mockResolvedValue([]);
			mockProvider.getAttachments.mockResolvedValue([]);

			const result = await readWorkItem('item1', false);

			expect(result).toContain('# Test Work Item');
			expect(mockWriteRuntimeImages).not.toHaveBeenCalled();
		});

		it('emits the diagnostic log line at runtime path with same prefix as boot path', async () => {
			const { logger } = await import('../../../../../src/utils/logging.js');
			vi.mocked(logger.info).mockClear();

			mockProvider.getWorkItem.mockResolvedValue({
				...baseItem,
				inlineMedia: [{ url: 'https://x/a.png', mimeType: 'image/png', source: 'description' }],
			});
			mockProvider.getChecklists.mockResolvedValue([]);
			mockProvider.getAttachments.mockResolvedValue([]);
			mockDownloadAndPrepareImages.mockResolvedValue({
				images: [{ base64Data: 'aGk=', mimeType: 'image/png', altText: undefined }],
				failures: [],
			});
			mockWriteRuntimeImages.mockResolvedValue({
				paths: ['.cascade/context/images/work-item-item1-img-0.png'],
				failures: [],
			});

			await readWorkItem('item1', false);

			expect(logger.info).toHaveBeenCalledWith(
				'[image-pipeline] work-item-fetch summary',
				expect.objectContaining({
					workItemId: 'item1',
					urlsDetected: expect.any(Number),
					urlsAfterFilter: expect.any(Number),
					urlsDownloaded: 1,
					urlsFailed: 0,
				}),
			);
		});

		it('when download fails, the failure is recorded in the diagnostic log; no path appears in text', async () => {
			const { logger } = await import('../../../../../src/utils/logging.js');
			vi.mocked(logger.info).mockClear();

			mockProvider.getWorkItem.mockResolvedValue({
				...baseItem,
				inlineMedia: [{ url: 'https://x/fail.png', mimeType: 'image/png', source: 'description' }],
			});
			mockProvider.getChecklists.mockResolvedValue([]);
			mockProvider.getAttachments.mockResolvedValue([]);
			mockDownloadAndPrepareImages.mockResolvedValue({
				images: [],
				failures: [{ url: 'https://x/fail.png', reason: 'network error' }],
			});

			const result = await readWorkItem('item1', false);

			// No on-disk path included.
			expect(result).not.toContain('.cascade/context/images/work-item');
			// Failure was visible in the diagnostic log line.
			expect(logger.info).toHaveBeenCalledWith(
				'[image-pipeline] work-item-fetch summary',
				expect.objectContaining({ urlsDownloaded: 0, urlsFailed: 1 }),
			);
		});

		it('text shape preserved: existing sections (Description, Comments) remain', async () => {
			mockProvider.getWorkItem.mockResolvedValue({
				...baseItem,
				inlineMedia: [{ url: 'https://x/a.png', mimeType: 'image/png', source: 'description' }],
			});
			mockProvider.getChecklists.mockResolvedValue([]);
			mockProvider.getAttachments.mockResolvedValue([]);
			mockProvider.getWorkItemComments.mockResolvedValue([
				{
					id: 'c1',
					author: { name: 'A', id: 'u', username: 'a' },
					date: '2024-01-01T00:00:00Z',
					text: 'a comment',
				},
			]);
			mockDownloadAndPrepareImages.mockResolvedValue({
				images: [{ base64Data: 'aGk=', mimeType: 'image/png', altText: undefined }],
				failures: [],
			});
			mockWriteRuntimeImages.mockResolvedValue({
				paths: ['.cascade/context/images/work-item-item1-img-0.png'],
				failures: [],
			});

			const result = await readWorkItem('item1', true);

			expect(result).toContain('## Description');
			expect(result).toContain('a comment');
			expect(result).toContain('.cascade/context/images/work-item-item1-img-0.png');
		});
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

describe('readStructuredWorkItemDetails', () => {
	it('returns raw provider fields and filtered media without formatting markdown', async () => {
		mockProvider.getWorkItem.mockResolvedValue({
			id: 'item1',
			title: 'Structured Work Item',
			url: 'https://trello.com/c/item1',
			description: 'Depends on MNG-123',
			labels: [{ id: 'l1', name: 'Bug', color: 'red' }],
			inlineMedia: [
				{ url: 'https://example.com/desc.png', mimeType: 'image/png', source: 'description' },
				{
					url: 'https://example.com/desc.pdf',
					mimeType: 'application/pdf',
					source: 'description',
				},
			],
		});
		mockProvider.getChecklists.mockResolvedValue([
			{
				id: 'cl1',
				name: 'Tasks',
				workItemId: 'item1',
				items: [{ id: 'ci1', name: 'Item 1', complete: false }],
			},
		]);
		mockProvider.getAttachments.mockResolvedValue([
			{
				id: 'a1',
				name: 'screenshot.png',
				url: 'https://example.com/screenshot.png',
				mimeType: 'image/png',
				bytes: 100,
				date: '2026-05-12T00:00:00.000Z',
			},
		]);
		mockProvider.getWorkItemComments.mockResolvedValue([
			{
				id: 'c1',
				author: { id: 'u1', name: 'Alice', username: 'alice' },
				date: '2026-05-12T00:00:00.000Z',
				text: 'Waiting for review',
				inlineMedia: [
					{
						url: 'https://example.com/comment.jpg',
						mimeType: 'image/jpeg',
						source: 'comment' as const,
					},
				],
			},
		]);

		const result = await readStructuredWorkItemDetails('item1', true);

		expect(result.item.title).toBe('Structured Work Item');
		expect(result.checklists[0].items[0].id).toBe('ci1');
		expect(result.attachments[0].name).toBe('screenshot.png');
		expect(result.comments[0].text).toBe('Waiting for review');
		expect(result.media.map((ref) => ref.url)).toEqual([
			'https://example.com/desc.png',
			'https://example.com/screenshot.png',
			'https://example.com/comment.jpg',
		]);
		expect(JSON.stringify(result)).not.toContain('# Structured Work Item');
	});
});
