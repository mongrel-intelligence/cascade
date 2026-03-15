/**
 * Utilities for extracting and working with inline media references from
 * work item descriptions and comments.
 */

import type { MediaReference } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum supported image file size in bytes (5 MB) */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Maximum number of inline media references to extract per work item */
export const MAX_IMAGES_PER_WORK_ITEM = 10;

// ---------------------------------------------------------------------------
// MIME type helpers
// ---------------------------------------------------------------------------

/** Common image MIME types */
const IMAGE_MIME_TYPES = new Set([
	'image/apng',
	'image/avif',
	'image/bmp',
	'image/gif',
	'image/jpeg',
	'image/png',
	'image/svg+xml',
	'image/tiff',
	'image/webp',
	'image/x-icon',
]);

/**
 * Returns true when the supplied MIME type represents a common image format.
 *
 * @param mime - The MIME type string to test (e.g. `'image/png'`).
 */
export function isImageMimeType(mime: string): boolean {
	return IMAGE_MIME_TYPES.has(mime.toLowerCase().trim());
}

/**
 * Filters an array of `MediaReference` objects to only those whose
 * `mimeType` is a recognised image MIME type.
 *
 * @param refs - Array of media references to filter.
 */
export function filterImageMedia(refs: MediaReference[]): MediaReference[] {
	return refs.filter((ref) => isImageMimeType(ref.mimeType));
}

// ---------------------------------------------------------------------------
// MIME type inference from URL
// ---------------------------------------------------------------------------

/** Maps common image file extensions to MIME types */
const EXTENSION_MIME_MAP: Record<string, string> = {
	apng: 'image/apng',
	avif: 'image/avif',
	bmp: 'image/bmp',
	gif: 'image/gif',
	ico: 'image/x-icon',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	png: 'image/png',
	svg: 'image/svg+xml',
	tif: 'image/tiff',
	tiff: 'image/tiff',
	webp: 'image/webp',
};

/**
 * Infers a MIME type from the file extension in a URL.
 * Returns `'application/octet-stream'` when the extension is unknown.
 *
 * @param url - The URL to examine.
 */
function mimeTypeFromUrl(url: string): string {
	try {
		const pathname = new URL(url).pathname;
		const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
		return EXTENSION_MIME_MAP[ext] ?? 'application/octet-stream';
	} catch {
		// Relative URL or malformed URL — try a simple extension check
		const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
		return EXTENSION_MIME_MAP[ext] ?? 'application/octet-stream';
	}
}

// ---------------------------------------------------------------------------
// Markdown image extraction
// ---------------------------------------------------------------------------

/**
 * Regex that matches Markdown image syntax: `![alt text](url)`
 *
 * Capture groups:
 *  1 — alt text (may be empty)
 *  2 — URL
 */
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Extracts Markdown image references (`![alt](url)`) from a string.
 *
 * Results are capped at {@link MAX_IMAGES_PER_WORK_ITEM} entries. Images
 * beyond that limit are silently dropped.
 *
 * @param md     - Markdown text to parse.
 * @param source - Where the text came from (`'description'` or `'comment'`).
 * @returns An array of `MediaReference` objects (at most `MAX_IMAGES_PER_WORK_ITEM`);
 *          empty when no images are found.
 *
 * @example
 * ```ts
 * const refs = extractMarkdownImages('Hello ![logo](https://example.com/logo.png)', 'description');
 * // [{ url: 'https://example.com/logo.png', mimeType: 'image/png', altText: 'logo', source: 'description' }]
 * ```
 */
export function extractMarkdownImages(
	md: string,
	source: 'description' | 'comment' = 'description',
): MediaReference[] {
	if (!md) {
		return [];
	}

	const results: MediaReference[] = [];

	// Use matchAll to avoid assignment-in-expression lint errors.
	// We create a new regex instance per call to avoid shared lastIndex state.
	const re = new RegExp(MARKDOWN_IMAGE_RE.source, MARKDOWN_IMAGE_RE.flags);
	for (const match of md.matchAll(re)) {
		const altText = match[1] ?? '';
		const url = match[2]?.trim() ?? '';

		if (!url) {
			continue;
		}

		results.push({
			url,
			mimeType: mimeTypeFromUrl(url),
			altText: altText || undefined,
			source,
		});

		if (results.length >= MAX_IMAGES_PER_WORK_ITEM) {
			break;
		}
	}

	return results;
}
