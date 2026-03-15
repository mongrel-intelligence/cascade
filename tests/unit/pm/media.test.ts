import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	MAX_IMAGES_PER_WORK_ITEM,
	MAX_IMAGE_SIZE_BYTES,
	downloadMedia,
	extractMarkdownImages,
	filterImageMedia,
	isImageMimeType,
	mediaToBase64DataUri,
} from '../../../src/pm/media.js';
import type { MediaReference } from '../../../src/pm/types.js';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
	it('MAX_IMAGE_SIZE_BYTES is 5 MB', () => {
		expect(MAX_IMAGE_SIZE_BYTES).toBe(5 * 1024 * 1024);
	});

	it('MAX_IMAGES_PER_WORK_ITEM is 10', () => {
		expect(MAX_IMAGES_PER_WORK_ITEM).toBe(10);
	});
});

// ---------------------------------------------------------------------------
// isImageMimeType
// ---------------------------------------------------------------------------

describe('isImageMimeType', () => {
	it.each([
		'image/png',
		'image/jpeg',
		'image/gif',
		'image/webp',
		'image/svg+xml',
		'image/bmp',
		'image/tiff',
		'image/avif',
		'image/apng',
		'image/x-icon',
	])('returns true for %s', (mime) => {
		expect(isImageMimeType(mime)).toBe(true);
	});

	it.each([
		'application/pdf',
		'text/plain',
		'application/octet-stream',
		'video/mp4',
		'audio/mpeg',
		'application/json',
	])('returns false for %s', (mime) => {
		expect(isImageMimeType(mime)).toBe(false);
	});

	it('is case-insensitive', () => {
		expect(isImageMimeType('IMAGE/PNG')).toBe(true);
		expect(isImageMimeType('Image/Jpeg')).toBe(true);
	});

	it('trims whitespace before checking', () => {
		expect(isImageMimeType('  image/png  ')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// filterImageMedia
// ---------------------------------------------------------------------------

describe('filterImageMedia', () => {
	const makeRef = (mimeType: string): MediaReference => ({
		url: 'https://example.com/file',
		mimeType,
		source: 'description',
	});

	it('returns only image references', () => {
		const refs: MediaReference[] = [
			makeRef('image/png'),
			makeRef('application/pdf'),
			makeRef('image/jpeg'),
			makeRef('text/plain'),
		];

		const result = filterImageMedia(refs);
		expect(result).toHaveLength(2);
		expect(result[0].mimeType).toBe('image/png');
		expect(result[1].mimeType).toBe('image/jpeg');
	});

	it('returns empty array when no images present', () => {
		const refs: MediaReference[] = [makeRef('application/pdf'), makeRef('text/plain')];
		expect(filterImageMedia(refs)).toHaveLength(0);
	});

	it('returns all refs when all are images', () => {
		const refs: MediaReference[] = [makeRef('image/png'), makeRef('image/gif')];
		expect(filterImageMedia(refs)).toHaveLength(2);
	});

	it('returns empty array for empty input', () => {
		expect(filterImageMedia([])).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// extractMarkdownImages
// ---------------------------------------------------------------------------

describe('extractMarkdownImages', () => {
	// Basic happy path
	it('extracts a single image', () => {
		const refs = extractMarkdownImages('Hello ![logo](https://example.com/logo.png)');
		expect(refs).toHaveLength(1);
		expect(refs[0]).toMatchObject({
			url: 'https://example.com/logo.png',
			mimeType: 'image/png',
			altText: 'logo',
			source: 'description',
		});
	});

	it('extracts multiple images', () => {
		const md = '![a](https://example.com/a.jpg) and ![b](https://example.com/b.gif)';
		const refs = extractMarkdownImages(md);
		expect(refs).toHaveLength(2);
		expect(refs[0].url).toBe('https://example.com/a.jpg');
		expect(refs[0].mimeType).toBe('image/jpeg');
		expect(refs[1].url).toBe('https://example.com/b.gif');
		expect(refs[1].mimeType).toBe('image/gif');
	});

	// Source parameter
	it('defaults source to "description"', () => {
		const refs = extractMarkdownImages('![x](https://example.com/x.png)');
		expect(refs[0].source).toBe('description');
	});

	it('uses provided source "comment"', () => {
		const refs = extractMarkdownImages('![x](https://example.com/x.png)', 'comment');
		expect(refs[0].source).toBe('comment');
	});

	// Empty / no images
	it('returns empty array for empty string', () => {
		expect(extractMarkdownImages('')).toHaveLength(0);
	});

	it('returns empty array when no images present', () => {
		expect(extractMarkdownImages('Just some plain text with no images.')).toHaveLength(0);
	});

	it('does not extract plain links (only images)', () => {
		expect(extractMarkdownImages('[link](https://example.com/image.png)')).toHaveLength(0);
	});

	// Alt text edge cases
	it('handles empty alt text', () => {
		const refs = extractMarkdownImages('![](https://example.com/img.png)');
		expect(refs).toHaveLength(1);
		expect(refs[0].altText).toBeUndefined();
	});

	it('preserves alt text with spaces', () => {
		const refs = extractMarkdownImages('![my cool logo](https://example.com/logo.png)');
		expect(refs[0].altText).toBe('my cool logo');
	});

	// MIME type inference
	it('infers jpeg MIME for .jpg extension', () => {
		const refs = extractMarkdownImages('![img](https://cdn.example.com/photo.jpg)');
		expect(refs[0].mimeType).toBe('image/jpeg');
	});

	it('infers webp MIME for .webp extension', () => {
		const refs = extractMarkdownImages('![img](https://cdn.example.com/photo.webp)');
		expect(refs[0].mimeType).toBe('image/webp');
	});

	it('infers svg MIME for .svg extension', () => {
		const refs = extractMarkdownImages('![icon](https://cdn.example.com/icon.svg)');
		expect(refs[0].mimeType).toBe('image/svg+xml');
	});

	it('uses application/octet-stream for unknown extension', () => {
		const refs = extractMarkdownImages('![file](https://example.com/file.xyz)');
		expect(refs[0].mimeType).toBe('application/octet-stream');
	});

	// Malformed markdown
	it('ignores malformed image syntax missing closing paren', () => {
		// "![alt](url" — no closing paren, should not match
		const refs = extractMarkdownImages('![broken](https://example.com/img.png');
		expect(refs).toHaveLength(0);
	});

	it('ignores malformed image syntax missing closing bracket', () => {
		const refs = extractMarkdownImages('![broken(https://example.com/img.png)');
		expect(refs).toHaveLength(0);
	});

	it('handles image URLs with query strings', () => {
		const refs = extractMarkdownImages(
			'![img](https://example.com/img.png?size=large&format=webp)',
		);
		expect(refs).toHaveLength(1);
		expect(refs[0].url).toBe('https://example.com/img.png?size=large&format=webp');
	});

	it('handles mixed content (text and images)', () => {
		const md = [
			'# Title',
			'',
			'Some description here.',
			'',
			'![screenshot](https://example.com/shot.png)',
			'',
			'More text.',
			'',
			'![diagram](https://example.com/diagram.gif)',
		].join('\n');

		const refs = extractMarkdownImages(md);
		expect(refs).toHaveLength(2);
		expect(refs[0].altText).toBe('screenshot');
		expect(refs[1].altText).toBe('diagram');
	});

	it('is idempotent across multiple calls (no global regex state leakage)', () => {
		const md = '![x](https://example.com/x.png)';
		const first = extractMarkdownImages(md);
		const second = extractMarkdownImages(md);
		expect(first).toHaveLength(1);
		expect(second).toHaveLength(1);
	});

	it('handles non-image URLs gracefully (non-image extension)', () => {
		const refs = extractMarkdownImages('![doc](https://example.com/readme.pdf)');
		expect(refs).toHaveLength(1);
		// MIME is inferred as octet-stream since pdf is not in the image extension map
		expect(refs[0].mimeType).toBe('application/octet-stream');
	});

	it('caps results at MAX_IMAGES_PER_WORK_ITEM', () => {
		// Build markdown with more images than the limit
		const images = Array.from(
			{ length: MAX_IMAGES_PER_WORK_ITEM + 5 },
			(_, i) => `![img${i}](https://example.com/img${i}.png)`,
		).join(' ');

		const refs = extractMarkdownImages(images);
		expect(refs).toHaveLength(MAX_IMAGES_PER_WORK_ITEM);
		// First and last within the cap should be present
		expect(refs[0].url).toBe('https://example.com/img0.png');
		expect(refs[MAX_IMAGES_PER_WORK_ITEM - 1].url).toBe(
			`https://example.com/img${MAX_IMAGES_PER_WORK_ITEM - 1}.png`,
		);
	});
});

// ---------------------------------------------------------------------------
// downloadMedia
// ---------------------------------------------------------------------------

describe('downloadMedia', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns buffer and mimeType from Content-Type header on success', async () => {
		const imageBytes = Buffer.from('fake-image-data');
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(imageBytes, {
				status: 200,
				headers: { 'Content-Type': 'image/png' },
			}),
		);

		const result = await downloadMedia('https://example.com/image.png');

		expect(result).not.toBeNull();
		// biome-ignore lint/style/noNonNullAssertion: guarded by expect above
		expect(result!.buffer).toBeInstanceOf(Buffer);
		// biome-ignore lint/style/noNonNullAssertion: guarded by expect above
		expect(result!.mimeType).toBe('image/png');
	});

	it('strips charset from Content-Type when determining MIME type', async () => {
		const imageBytes = Buffer.from('fake-jpeg');
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(imageBytes, {
				status: 200,
				headers: { 'Content-Type': 'image/jpeg; charset=utf-8' },
			}),
		);

		const result = await downloadMedia('https://example.com/photo.jpg');

		// biome-ignore lint/style/noNonNullAssertion: successful download guaranteed by mock
		expect(result!.mimeType).toBe('image/jpeg');
	});

	it('falls back to URL extension MIME detection when no Content-Type header', async () => {
		const imageBytes = Buffer.from('fake-png');
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(imageBytes, { status: 200 }));

		const result = await downloadMedia('https://example.com/image.png');

		// biome-ignore lint/style/noNonNullAssertion: successful download guaranteed by mock
		expect(result!.mimeType).toBe('image/png');
	});

	it('passes auth headers to fetch', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(Buffer.from('data'), {
				status: 200,
				headers: { 'Content-Type': 'image/gif' },
			}),
		);

		const headers = { Authorization: 'Basic abc123' };
		await downloadMedia('https://example.com/image.gif', headers);

		expect(fetchSpy).toHaveBeenCalledOnce();
		const [, options] = fetchSpy.mock.calls[0];
		expect((options as RequestInit).headers).toEqual(headers);
	});

	it('returns null for non-OK HTTP status', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));

		const result = await downloadMedia('https://example.com/missing.png');

		expect(result).toBeNull();
	});

	it('returns null when Content-Length exceeds MAX_IMAGE_SIZE_BYTES', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(Buffer.from('data'), {
				status: 200,
				headers: {
					'Content-Type': 'image/png',
					'Content-Length': String(MAX_IMAGE_SIZE_BYTES + 1),
				},
			}),
		);

		const result = await downloadMedia('https://example.com/large.png');

		expect(result).toBeNull();
	});

	it('returns null when body bytes exceed MAX_IMAGE_SIZE_BYTES (no Content-Length)', async () => {
		// Create a buffer just over the limit
		const oversizedBuffer = Buffer.alloc(MAX_IMAGE_SIZE_BYTES + 1, 'x');
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(oversizedBuffer, {
				status: 200,
				headers: { 'Content-Type': 'image/png' },
			}),
		);

		const result = await downloadMedia('https://example.com/huge.png');

		expect(result).toBeNull();
	});

	it('returns null when fetch times out (AbortError)', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(
			Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }),
		);

		const result = await downloadMedia('https://example.com/slow.png');

		expect(result).toBeNull();
	});

	it('returns null when fetch throws a network error', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failure'));

		const result = await downloadMedia('https://example.com/error.png');

		expect(result).toBeNull();
	});

	it('downloads successfully when Content-Length is exactly MAX_IMAGE_SIZE_BYTES', async () => {
		const imageBytes = Buffer.alloc(MAX_IMAGE_SIZE_BYTES, 'x');
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(imageBytes, {
				status: 200,
				headers: {
					'Content-Type': 'image/webp',
					'Content-Length': String(MAX_IMAGE_SIZE_BYTES),
				},
			}),
		);

		const result = await downloadMedia('https://example.com/exact.webp');

		expect(result).not.toBeNull();
		// biome-ignore lint/style/noNonNullAssertion: guarded by expect above
		expect(result!.buffer.byteLength).toBe(MAX_IMAGE_SIZE_BYTES);
	});
});

// ---------------------------------------------------------------------------
// mediaToBase64DataUri
// ---------------------------------------------------------------------------

describe('mediaToBase64DataUri', () => {
	it('returns a correctly formatted data URI', () => {
		const buffer = Buffer.from('hello');
		const result = mediaToBase64DataUri(buffer, 'image/png');
		expect(result).toBe(`data:image/png;base64,${Buffer.from('hello').toString('base64')}`);
	});

	it('works for different MIME types', () => {
		const buffer = Buffer.from([0xff, 0xd8, 0xff]);
		const result = mediaToBase64DataUri(buffer, 'image/jpeg');
		expect(result).toMatch(/^data:image\/jpeg;base64,/);
	});

	it('empty buffer produces valid (empty content) data URI', () => {
		const buffer = Buffer.alloc(0);
		const result = mediaToBase64DataUri(buffer, 'image/gif');
		expect(result).toBe('data:image/gif;base64,');
	});
});
