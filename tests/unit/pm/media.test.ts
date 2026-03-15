import { describe, expect, it } from 'vitest';
import {
	MAX_IMAGES_PER_WORK_ITEM,
	MAX_IMAGE_SIZE_BYTES,
	extractMarkdownImages,
	filterImageMedia,
	isImageMimeType,
} from '../../../src/pm/media.js';
import type { MediaReference } from '../../../src/pm/types.js';

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
});
