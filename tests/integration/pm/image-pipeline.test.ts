/**
 * Module-integration test for spec 016/1.
 *
 * Wires the REAL `mimeTypeFromUrl` + REAL `isImageMimeType` + REAL
 * `filterImageMedia` + REAL `extractMarkdownImages` + REAL
 * `downloadAndPrepareImages` (via dynamic import in `fetchWorkItemStep`),
 * mocking only the per-provider download client (so we control the
 * Content-Type response without needing a real Linear endpoint) and the
 * upstream `readWorkItemWithMedia` (so we don't need a real PM provider).
 *
 * Pins the end-to-end MNG-357 reproduction: extension-less Linear URL flows
 * through extract → filter → download → ContextInjection.images without
 * being dropped. Pre-spec-016 behavior would fail this test because
 * `filterImageMedia` would drop the `application/octet-stream` ref.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLinearDownload, mockTrelloDownload, mockJiraDownload } = vi.hoisted(() => ({
	mockLinearDownload: vi.fn(),
	mockTrelloDownload: vi.fn(),
	mockJiraDownload: vi.fn(),
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

vi.mock('../../../src/gadgets/pm/core/readWorkItem.js', () => ({
	readWorkItemWithMedia: vi.fn(),
	readWorkItem: vi.fn(),
}));

vi.mock('../../../src/pm/index.js', async () => {
	// Need to keep MAX_IMAGES_PER_WORK_ITEM real so the cap matches production
	const real = await vi.importActual<typeof import('../../../src/pm/index.js')>(
		'../../../src/pm/index.js',
	);
	return {
		...real,
		getPMProviderOrNull: vi.fn(),
	};
});

import { fetchWorkItemStep } from '../../../src/agents/definitions/contextSteps.js';
import { readWorkItemWithMedia } from '../../../src/gadgets/pm/core/readWorkItem.js';
import { getPMProviderOrNull } from '../../../src/pm/index.js';
import { extractMarkdownImages, filterImageMedia } from '../../../src/pm/media.js';
import type { AgentInput } from '../../../src/types/index.js';

const mockReadWorkItemWithMedia = vi.mocked(readWorkItemWithMedia);
const mockGetPMProviderOrNull = vi.mocked(getPMProviderOrNull);

describe('spec 016/1 — boot-path image pipeline (module-integration)', () => {
	beforeEach(() => {
		mockLinearDownload.mockReset();
		mockTrelloDownload.mockReset();
		mockJiraDownload.mockReset();
		mockReadWorkItemWithMedia.mockReset();
		mockGetPMProviderOrNull.mockReset();
	});

	function makeParams(input: Partial<AgentInput>) {
		return {
			input: input as AgentInput,
			repoDir: '/tmp/repo',
			contextFiles: [],
			logWriter: vi.fn(),
		};
	}

	it('MNG-357 reproduction: extension-less Linear URL extracted via real path lands as image with resolved MIME', async () => {
		// Step 1: real extraction — pin that Linear-shaped URLs survive the filter via image/* sentinel.
		const description = '![](https://uploads.linear.app/abc-123-def-456)';
		const refs = extractMarkdownImages(description);
		expect(refs).toHaveLength(1);
		expect(refs[0].mimeType).toBe('image/*');
		const filtered = filterImageMedia(refs);
		expect(filtered).toHaveLength(1); // wildcard survived

		// Step 2: real fetchWorkItemStep flow with that ref + a stubbed download.
		mockReadWorkItemWithMedia.mockResolvedValue({
			text: '# MNG-357\n\n![](https://uploads.linear.app/abc-123-def-456)',
			media: filtered, // pass the real-extracted refs
			urlsDetected: filtered.length,
		});
		mockGetPMProviderOrNull.mockReturnValue({ type: 'linear' } as never);
		mockLinearDownload.mockResolvedValue({
			buffer: Buffer.from('PNG-bytes-here'),
			mimeType: 'image/png', // server-side Content-Type — this is the ground truth
		});

		const result = await fetchWorkItemStep(makeParams({ workItemId: 'MNG-357' }));

		// Image was delivered; MIME resolved to the Content-Type, not the wildcard.
		expect(result).toHaveLength(1);
		expect(result[0].images).toHaveLength(1);
		expect(result[0].images?.[0].mimeType).toBe('image/png');
		expect(result[0].images?.[0].base64Data).toBe(Buffer.from('PNG-bytes-here').toString('base64'));
	});

	it('emits the diagnostic line `[image-pipeline] work-item-fetch summary` with non-zero downloads', async () => {
		const refs = extractMarkdownImages('![](https://uploads.linear.app/abc-123)');
		mockReadWorkItemWithMedia.mockResolvedValue({
			text: '# x',
			media: refs,
			urlsDetected: 1,
		});
		mockGetPMProviderOrNull.mockReturnValue({ type: 'linear' } as never);
		mockLinearDownload.mockResolvedValue({
			buffer: Buffer.from('x'),
			mimeType: 'image/png',
		});

		const params = makeParams({ workItemId: 'MNG-357' });
		await fetchWorkItemStep(params);

		expect(params.logWriter).toHaveBeenCalledWith(
			'INFO',
			'[image-pipeline] work-item-fetch summary',
			expect.objectContaining({
				provider: 'linear',
				workItemId: 'MNG-357',
				urlsDetected: 1,
				urlsAfterFilter: 1,
				urlsDownloaded: 1,
				urlsFailed: 0,
			}),
		);
	});

	it('Trello PNG URL regression: extensioned URL still resolves and downloads', async () => {
		const refs = extractMarkdownImages('![](https://trello.com/foo.png)');
		expect(refs[0].mimeType).toBe('image/png'); // extension-resolved

		mockReadWorkItemWithMedia.mockResolvedValue({
			text: '# t',
			media: refs,
			urlsDetected: refs.length,
		});
		mockGetPMProviderOrNull.mockReturnValue({ type: 'trello' } as never);
		mockTrelloDownload.mockResolvedValue({
			buffer: Buffer.from('y'),
			mimeType: 'image/png',
		});

		const result = await fetchWorkItemStep(makeParams({ workItemId: 'card-1' }));
		expect(result[0].images).toHaveLength(1);
		expect(result[0].images?.[0].mimeType).toBe('image/png');
	});
});
