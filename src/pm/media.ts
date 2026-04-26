/**
 * Utilities for extracting and working with inline media references from
 * work item descriptions and comments.
 */

import { logger } from '../utils/logging.js';
import type { AdfMediaReference } from './jira/adf.js';
import type { MediaReference } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum supported image file size in bytes (5 MB) */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Timeout for downloading media (10 seconds) */
const DOWNLOAD_TIMEOUT_MS = 10_000;

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
 * Also accepts the `'image/*'` wildcard sentinel — used by spec 016/1 for
 * extension-less PM-provider URLs whose MIME is resolved at download-time
 * via the response's Content-Type header. The wildcard never reaches disk;
 * `downloadMedia` resolves it to a concrete MIME before the bytes are written.
 *
 * @param mime - The MIME type string to test (e.g. `'image/png'`).
 */
export function isImageMimeType(mime: string): boolean {
	const normalized = mime.toLowerCase().trim();
	if (normalized === 'image/*') return true;
	return IMAGE_MIME_TYPES.has(normalized);
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
 * Trusted PM-provider upload hosts whose extension-less URLs we treat as
 * candidate images and resolve at download-time via the response's
 * Content-Type header. Spec 016/1.
 *
 * Linear's user-pasted-screenshot URLs (`https://uploads.linear.app/<uuid>`)
 * have no file extension in the pathname; before this allowlist they fell
 * through to `'application/octet-stream'` and were silently filtered out by
 * `filterImageMedia`. To add a new trusted host: append the bare hostname
 * here. Do NOT add hosts whose Content-Type headers are unreliable — the
 * wildcard sentinel skips the URL-extension verdict and trusts the response.
 */
const IMAGE_HOST_ALLOWLIST: ReadonlySet<string> = new Set(['uploads.linear.app']);

/**
 * Infers a MIME type from the file extension in a URL.
 *
 * Returns `'application/octet-stream'` when the extension is unknown — except
 * for hosts in {@link IMAGE_HOST_ALLOWLIST}, where extension-less URLs return
 * the `'image/*'` wildcard sentinel so they survive the pre-download image
 * filter. Spec 016/1.
 *
 * @param url - The URL to examine.
 */
function mimeTypeFromUrl(url: string): string {
	try {
		const parsed = new URL(url);
		const pathname = parsed.pathname;
		const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
		const fromExt = EXTENSION_MIME_MAP[ext];
		if (fromExt) return fromExt;
		// Spec 016/1: trusted PM upload hosts return `image/*` for extension-less
		// URLs so the download path can resolve the real MIME from the response.
		if (IMAGE_HOST_ALLOWLIST.has(parsed.hostname)) return 'image/*';
		return 'application/octet-stream';
	} catch {
		// Relative URL or malformed URL — try a simple extension check; no host,
		// so cannot apply the allowlist.
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

// ---------------------------------------------------------------------------
// Download utilities
// ---------------------------------------------------------------------------

/**
 * Result of a successful media download.
 */
export interface DownloadMediaResult {
	/** Raw bytes of the downloaded media */
	buffer: Buffer;
	/** MIME type detected from Content-Type header or URL extension fallback */
	mimeType: string;
}

/**
 * Downloads media bytes from a URL with a 10-second timeout and
 * {@link MAX_IMAGE_SIZE_BYTES} size enforcement.
 *
 * Auth headers (e.g. `Authorization: Basic ...`) can be provided by callers
 * such as the Trello or JIRA client wrappers.
 *
 * Returns `null` gracefully on any failure (network error, timeout, oversized
 * file, non-OK status) so callers never need to catch.
 *
 * @param url         - The URL to download.
 * @param authHeaders - Optional additional request headers (e.g. auth headers).
 * @returns `{ buffer, mimeType }` on success, `null` on any failure.
 */
export async function downloadMedia(
	url: string,
	authHeaders?: Record<string, string>,
): Promise<DownloadMediaResult | null> {
	// Strip query params from the URL used in log messages to avoid leaking
	// credentials (e.g. Trello key/token query params).
	const safeUrl = url.split('?')[0];

	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

		let response: Response;
		try {
			response = await fetch(url, {
				signal: controller.signal,
				headers: authHeaders,
			});
		} catch (err) {
			clearTimeout(timeout);
			throw err;
		}

		if (!response.ok) {
			clearTimeout(timeout);
			logger.warn('downloadMedia: non-OK response', { url: safeUrl, status: response.status });
			return null;
		}

		// Enforce size limit using Content-Length header before streaming
		const contentLength = response.headers.get('Content-Length');
		if (contentLength !== null) {
			const length = Number(contentLength);
			if (!Number.isNaN(length) && length > MAX_IMAGE_SIZE_BYTES) {
				clearTimeout(timeout);
				logger.warn('downloadMedia: content exceeds MAX_IMAGE_SIZE_BYTES (pre-check)', {
					url: safeUrl,
					bytes: length,
					limit: MAX_IMAGE_SIZE_BYTES,
				});
				return null;
			}
		}

		// Read the response body as an ArrayBuffer and convert to Buffer.
		// clearTimeout is deferred to here so the abort signal remains active
		// for the entire body read, not just the connection phase.
		let arrayBuffer: ArrayBuffer;
		try {
			arrayBuffer = await response.arrayBuffer();
		} finally {
			clearTimeout(timeout);
		}

		if (arrayBuffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
			logger.warn('downloadMedia: content exceeds MAX_IMAGE_SIZE_BYTES (post-read)', {
				url: safeUrl,
				bytes: arrayBuffer.byteLength,
				limit: MAX_IMAGE_SIZE_BYTES,
			});
			return null;
		}

		const buffer = Buffer.from(arrayBuffer);

		// Determine MIME type: prefer Content-Type header, fall back to URL extension
		const contentType = response.headers.get('Content-Type') ?? '';
		const mimeType = contentType ? contentType.split(';')[0].trim() : mimeTypeFromUrl(url);

		return { buffer, mimeType };
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			logger.warn('downloadMedia: timed out', { url: safeUrl, timeoutMs: DOWNLOAD_TIMEOUT_MS });
		} else {
			logger.warn('downloadMedia: failed', { url: safeUrl, error: String(err) });
		}
		return null;
	}
}

// ---------------------------------------------------------------------------
// JIRA media URL resolution
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a JIRA attachment as returned by the REST API.
 * Only the fields needed for URL resolution are required.
 */
export interface JiraAttachmentLike {
	/** JIRA attachment ID */
	id?: string;
	/** Attachment filename */
	filename?: string;
	/** Download URL of the attachment content */
	content?: string;
	/** MIME type reported by JIRA */
	mimeType?: string;
}

/**
 * Resolves a list of ADF media node references to actual download URLs by
 * matching against the JIRA issue's attachment list.
 *
 * JIRA's `media` ADF nodes reference internal media by an opaque ID stored in
 * `attrs.id`. The corresponding download URL lives in the issue's
 * `fields.attachment` array. This function bridges the two by:
 *
 * 1. Building a lookup map from attachment ID → attachment record.
 * 2. For each {@link AdfMediaReference}, finding the attachment whose `id`
 *    matches `mediaId`.
 * 3. Returning a {@link MediaReference} with the attachment's download URL and
 *    MIME type.
 *
 * References that cannot be matched (e.g. external media not backed by an
 * attachment) are silently skipped with a debug-level log.
 *
 * Results are capped at {@link MAX_IMAGES_PER_WORK_ITEM}.
 *
 * @param refs        - ADF media node references produced by `extractAdfMediaNodes`.
 * @param attachments - JIRA attachment records from `fields.attachment`.
 * @param source      - Whether the media came from a description or a comment.
 * @returns Resolved {@link MediaReference} objects (at most `MAX_IMAGES_PER_WORK_ITEM`).
 *
 * @example
 * ```ts
 * const refs = extractAdfMediaNodes(fields.description);
 * const mediaRefs = resolveJiraMediaUrls(refs, fields.attachment ?? [], 'description');
 * ```
 */
export function resolveJiraMediaUrls(
	refs: AdfMediaReference[],
	attachments: JiraAttachmentLike[],
	source: 'description' | 'comment' = 'description',
): MediaReference[] {
	if (refs.length === 0 || attachments.length === 0) return [];

	// Build a lookup map: attachment ID → attachment record
	const attachmentById = new Map<string, JiraAttachmentLike>();
	for (const att of attachments) {
		if (att.id) {
			attachmentById.set(att.id, att);
		}
	}

	const results: MediaReference[] = [];

	for (const ref of refs) {
		if (results.length >= MAX_IMAGES_PER_WORK_ITEM) break;

		const attachment = attachmentById.get(ref.mediaId);
		if (!attachment) {
			logger.debug('resolveJiraMediaUrls: no attachment found for media ID', {
				mediaId: ref.mediaId,
			});
			continue;
		}

		const url = attachment.content;
		if (!url) {
			logger.debug('resolveJiraMediaUrls: attachment has no content URL', {
				mediaId: ref.mediaId,
				attachmentId: attachment.id,
			});
			continue;
		}

		const mimeType = attachment.mimeType ?? mimeTypeFromUrl(url);

		results.push({
			url,
			mimeType,
			altText: ref.altText || attachment.filename || undefined,
			source,
		});
	}

	return results;
}
