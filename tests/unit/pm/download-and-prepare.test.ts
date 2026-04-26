import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — the helper dispatches to per-provider download clients
// that we mock at the module level.
// ---------------------------------------------------------------------------

const {
	mockJiraDownloadAttachment,
	mockLinearDownloadAttachment,
	mockTrelloDownloadAttachment,
	mockGetPMProviderOrNull,
} = vi.hoisted(() => ({
	mockJiraDownloadAttachment: vi.fn(),
	mockLinearDownloadAttachment: vi.fn(),
	mockTrelloDownloadAttachment: vi.fn(),
	mockGetPMProviderOrNull: vi.fn(),
}));

vi.mock('../../../src/jira/client.js', () => ({
	jiraClient: { downloadAttachment: mockJiraDownloadAttachment },
}));
vi.mock('../../../src/linear/client.js', () => ({
	linearClient: { downloadAttachment: mockLinearDownloadAttachment },
}));
vi.mock('../../../src/trello/client.js', () => ({
	trelloClient: { downloadAttachment: mockTrelloDownloadAttachment },
}));
vi.mock('../../../src/pm/index.js', () => ({
	getPMProviderOrNull: mockGetPMProviderOrNull,
}));
vi.mock('../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { downloadAndPrepareImages } from '../../../src/pm/download-and-prepare.js';
import type { MediaReference } from '../../../src/pm/types.js';

describe('downloadAndPrepareImages', () => {
	const noopLogWriter = vi.fn();

	const ref = (
		url: string,
		mimeType = 'image/png',
		altText?: string,
		source: 'description' | 'comment' | 'attachment' = 'description',
	): MediaReference => ({ url, mimeType, altText, source });

	beforeEach(() => {
		mockJiraDownloadAttachment.mockReset();
		mockLinearDownloadAttachment.mockReset();
		mockTrelloDownloadAttachment.mockReset();
		mockGetPMProviderOrNull.mockReset();
		noopLogWriter.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('downloads each ref and returns success array + failure array', async () => {
		mockGetPMProviderOrNull.mockReturnValue({ type: 'linear' });
		mockLinearDownloadAttachment
			.mockResolvedValueOnce({ buffer: Buffer.from('one'), mimeType: 'image/png' })
			.mockResolvedValueOnce({ buffer: Buffer.from('two'), mimeType: 'image/jpeg' })
			.mockResolvedValueOnce(null); // failure

		const result = await downloadAndPrepareImages(
			'MNG-357',
			[
				ref('https://uploads.linear.app/a'),
				ref('https://uploads.linear.app/b'),
				ref('https://uploads.linear.app/c'),
			],
			noopLogWriter,
		);

		expect(result.images).toHaveLength(2);
		expect(result.failures).toHaveLength(1);
	});

	it('preserves base64 + altText + RESOLVED mimeType (not the input wildcard)', async () => {
		mockGetPMProviderOrNull.mockReturnValue({ type: 'linear' });
		mockLinearDownloadAttachment.mockResolvedValueOnce({
			buffer: Buffer.from('hello'),
			mimeType: 'image/png',
		});

		const result = await downloadAndPrepareImages(
			'MNG-1',
			[ref('https://uploads.linear.app/abc', 'image/*', 'Screenshot.png')],
			noopLogWriter,
		);

		expect(result.images).toHaveLength(1);
		expect(result.images[0]).toEqual({
			base64Data: Buffer.from('hello').toString('base64'),
			mimeType: 'image/png', // resolved, NOT the wildcard input
			altText: 'Screenshot.png',
		});
	});

	it('caps at MAX_IMAGES_PER_WORK_ITEM (10)', async () => {
		mockGetPMProviderOrNull.mockReturnValue({ type: 'linear' });
		mockLinearDownloadAttachment.mockResolvedValue({
			buffer: Buffer.from('x'),
			mimeType: 'image/png',
		});

		const refs: MediaReference[] = Array.from({ length: 12 }, (_, i) =>
			ref(`https://uploads.linear.app/${i}`),
		);
		await downloadAndPrepareImages('MNG-357', refs, noopLogWriter);

		expect(mockLinearDownloadAttachment).toHaveBeenCalledTimes(10);
	});

	it('dispatches to the correct per-provider download client', async () => {
		mockGetPMProviderOrNull.mockReturnValue({ type: 'linear' });
		mockLinearDownloadAttachment.mockResolvedValue({
			buffer: Buffer.from('x'),
			mimeType: 'image/png',
		});
		await downloadAndPrepareImages('MNG-1', [ref('https://x.com/a.png')], noopLogWriter);
		expect(mockLinearDownloadAttachment).toHaveBeenCalledTimes(1);
		expect(mockJiraDownloadAttachment).not.toHaveBeenCalled();
		expect(mockTrelloDownloadAttachment).not.toHaveBeenCalled();
	});

	it('falls back to trello when provider type is not jira or linear', async () => {
		mockGetPMProviderOrNull.mockReturnValue({ type: 'trello' });
		mockTrelloDownloadAttachment.mockResolvedValue({
			buffer: Buffer.from('x'),
			mimeType: 'image/png',
		});
		await downloadAndPrepareImages('w1', [ref('https://x.com/a.png')], noopLogWriter);
		expect(mockTrelloDownloadAttachment).toHaveBeenCalledTimes(1);
	});

	it('captures failure reason for download exceptions', async () => {
		mockGetPMProviderOrNull.mockReturnValue({ type: 'linear' });
		mockLinearDownloadAttachment.mockRejectedValue(new Error('network blip'));

		const result = await downloadAndPrepareImages(
			'MNG-1',
			[ref('https://uploads.linear.app/a')],
			noopLogWriter,
		);

		expect(result.images).toHaveLength(0);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toEqual({
			url: 'https://uploads.linear.app/a',
			reason: 'network blip',
		});
	});

	it('returns empty arrays when given no refs', async () => {
		const result = await downloadAndPrepareImages('w1', [], noopLogWriter);
		expect(result).toEqual({ images: [], failures: [] });
	});
});
