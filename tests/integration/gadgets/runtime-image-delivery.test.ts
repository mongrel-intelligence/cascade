/**
 * Module-integration test for spec 016/2.
 *
 * Wires the REAL `readWorkItem` gadget + REAL `downloadAndPrepareImages`
 * (Plan 1's helper) + REAL `writeRuntimeImages` (Plan 2's writer), plus the
 * real `extractMarkdownImages`/`filterImageMedia`/`mimeTypeFromUrl` chain
 * inside `readWorkItemWithMedia`. Mocks: filesystem (we don't write to a
 * real disk during tests) and the per-provider download client (we control
 * the response Content-Type).
 *
 * Pins the mid-run pickup contract: an image added between two `readWorkItem`
 * calls is delivered on the second call as a file path in the returned text.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockMkdir, mockWriteFile, mockLinearDownload, mockTrelloDownload, mockJiraDownload } =
	vi.hoisted(() => ({
		mockMkdir: vi.fn().mockResolvedValue(undefined),
		mockWriteFile: vi.fn().mockResolvedValue(undefined),
		mockLinearDownload: vi.fn(),
		mockTrelloDownload: vi.fn(),
		mockJiraDownload: vi.fn(),
	}));

vi.mock('node:fs/promises', () => ({
	mkdir: mockMkdir,
	writeFile: mockWriteFile,
}));

vi.mock('../../../src/linear/client.js', () => ({
	linearClient: { downloadAttachment: mockLinearDownload },
}));
vi.mock('../../../src/trello/client.js', () => ({
	trelloClient: { downloadAttachment: mockTrelloDownload },
}));
vi.mock('../../../src/jira/client.js', () => ({
	jiraClient: { downloadAttachment: mockJiraDownload },
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createMockPMProvider } from '../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../src/pm/index.js', async () => {
	const real = await vi.importActual<typeof import('../../../src/pm/index.js')>(
		'../../../src/pm/index.js',
	);
	return {
		...real,
		getPMProvider: () => mockProvider,
		getPMProviderOrNull: () => mockProvider,
	};
});

import { readWorkItem } from '../../../src/gadgets/pm/core/readWorkItem.js';

describe('spec 016/2 — runtime image delivery (module-integration)', () => {
	beforeEach(() => {
		mockMkdir.mockReset();
		mockMkdir.mockResolvedValue(undefined);
		mockWriteFile.mockReset();
		mockWriteFile.mockResolvedValue(undefined);
		mockLinearDownload.mockReset();
		mockTrelloDownload.mockReset();
		mockJiraDownload.mockReset();
		mockProvider.getWorkItem.mockReset();
		mockProvider.getChecklists.mockReset();
		mockProvider.getAttachments.mockReset();
		mockProvider.getWorkItemComments.mockReset();
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([]);
		mockProvider.getWorkItemComments.mockResolvedValue([]);
		(mockProvider as unknown as { type: string }).type = 'linear';
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('extension-less Linear URL → on-disk file path appears in text', async () => {
		mockProvider.getWorkItem.mockResolvedValue({
			id: 'MNG-357',
			title: 'Bug from screenshot',
			url: 'https://linear.app/x/MNG-357',
			description: '![](https://uploads.linear.app/abc-123)',
			labels: [],
			inlineMedia: [
				{
					url: 'https://uploads.linear.app/abc-123',
					mimeType: 'image/*',
					altText: undefined,
					source: 'description',
				},
			],
		});
		mockLinearDownload.mockResolvedValue({
			buffer: Buffer.from('PNG-bytes'),
			mimeType: 'image/png',
		});

		const text = await readWorkItem('MNG-357', false);

		// On-disk path with PNG extension (resolved from Content-Type).
		expect(text).toContain('.cascade/context/images/work-item-MNG-357-img-0.png');
		// File was actually written.
		expect(mockWriteFile).toHaveBeenCalledTimes(1);
	});

	it('mid-run pickup: image added after first call is delivered on second call', async () => {
		// First call — no images.
		mockProvider.getWorkItem.mockResolvedValueOnce({
			id: 'MNG-1',
			title: 'Bug',
			url: 'https://linear.app/x/MNG-1',
			description: 'Empty description',
			labels: [],
			inlineMedia: [],
		});

		const firstText = await readWorkItem('MNG-1', false);
		expect(firstText).not.toContain('.cascade/context/images/');
		expect(mockWriteFile).not.toHaveBeenCalled();

		// Second call — teammate has now uploaded a screenshot.
		mockProvider.getWorkItem.mockResolvedValueOnce({
			id: 'MNG-1',
			title: 'Bug',
			url: 'https://linear.app/x/MNG-1',
			description: '![](https://uploads.linear.app/new-screenshot)',
			labels: [],
			inlineMedia: [
				{
					url: 'https://uploads.linear.app/new-screenshot',
					mimeType: 'image/*',
					source: 'description',
				},
			],
		});
		mockLinearDownload.mockResolvedValue({
			buffer: Buffer.from('NEW'),
			mimeType: 'image/png',
		});

		const secondText = await readWorkItem('MNG-1', false);
		expect(secondText).toContain('.cascade/context/images/work-item-MNG-1-img-0.png');
		expect(mockWriteFile).toHaveBeenCalledTimes(1);
	});

	it('Trello extensioned URL regression: still delivered on disk', async () => {
		(mockProvider as unknown as { type: string }).type = 'trello';
		mockProvider.getWorkItem.mockResolvedValue({
			id: 'card-1',
			title: 'Card',
			url: 'https://trello.com/c/card-1',
			description: '![](https://trello.com/foo.png)',
			labels: [],
			inlineMedia: [
				{ url: 'https://trello.com/foo.png', mimeType: 'image/png', source: 'description' },
			],
		});
		mockTrelloDownload.mockResolvedValue({
			buffer: Buffer.from('TRELLO'),
			mimeType: 'image/png',
		});

		const text = await readWorkItem('card-1', false);
		expect(text).toContain('.cascade/context/images/work-item-card-1-img-0.png');
		expect(mockTrelloDownload).toHaveBeenCalledWith('https://trello.com/foo.png');
	});

	it('failed download: failure surfaced in text, no orphan path', async () => {
		mockProvider.getWorkItem.mockResolvedValue({
			id: 'MNG-2',
			title: 'Bug',
			url: 'https://linear.app/x/MNG-2',
			description: '![](https://uploads.linear.app/will-fail)',
			labels: [],
			inlineMedia: [
				{
					url: 'https://uploads.linear.app/will-fail',
					mimeType: 'image/*',
					source: 'description',
				},
			],
		});
		mockLinearDownload.mockRejectedValue(new Error('upstream 500'));

		const text = await readWorkItem('MNG-2', false);
		// No on-disk path mentioned.
		expect(text).not.toContain('.cascade/context/images/work-item');
		// Failure visible.
		expect(text).toContain('Failed Image Downloads');
		expect(text).toContain('upstream 500');
		// No file was written.
		expect(mockWriteFile).not.toHaveBeenCalled();
	});
});
