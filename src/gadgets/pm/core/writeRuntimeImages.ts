/**
 * Write runtime work-item images to `.cascade/context/images/` so the
 * agent can read them with its file-read tool.
 *
 * Spec 016/2: this is the runtime sibling of the boot-path writer
 * (`writeInjectionImages` in `src/backends/shared/contextFiles.ts`).
 * Both produce the same on-disk filename convention:
 *   `.cascade/context/images/work-item-<workItemId>-img-<index>.<ext>`
 *
 * Extension is derived from the resolved MIME type. When MIME resolution
 * failed (the `image/*` wildcard sentinel from spec 016/1 was never resolved
 * because download response Content-Type was missing), the extension falls
 * back to `.bin` and a warn log fires — never silently degrade.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContextImage } from '../../../agents/contracts/index.js';
import { logger } from '../../../utils/logging.js';

/** Default location where runtime images are written, relative to the repo root. */
export const DEFAULT_CONTEXT_IMAGES_RELATIVE = '.cascade/context/images';

/**
 * Map MIME types to file extensions.
 * Mirrors the Plan 1 boot-path convention (image/jpeg → .jpg) so the boot-
 * path and runtime-path produce identical artifacts.
 */
const MIME_TO_EXTENSION: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/svg+xml': 'svg',
	'image/avif': 'avif',
	'image/apng': 'apng',
	'image/bmp': 'bmp',
	'image/tiff': 'tiff',
	'image/x-icon': 'ico',
};

/**
 * Resolve a file extension for the given MIME type. Returns `bin` for the
 * unresolved wildcard sentinel `image/*` AND for any unknown MIME, with a
 * caller-provided warn log for the wildcard case.
 */
function resolveExtension(mimeType: string, workItemId: string): string {
	const normalized = mimeType.toLowerCase().trim();
	const ext = MIME_TO_EXTENSION[normalized];
	if (ext) return ext;
	if (normalized === 'image/*') {
		logger.warn('writeRuntimeImages: unresolved MIME — falling back to .bin extension', {
			workItemId,
			mimeType,
		});
		return 'bin';
	}
	logger.warn('writeRuntimeImages: unknown MIME — falling back to .bin extension', {
		workItemId,
		mimeType,
	});
	return 'bin';
}

export interface WriteRuntimeImagesArgs {
	workItemId: string;
	images: ContextImage[];
	/** Optional repo root; defaults to the current working directory. */
	repoDir?: string;
}

export interface WriteRuntimeImagesResult {
	/** Repo-relative paths of successfully-written image files. */
	paths: string[];
	/** Per-image write failures (if any). */
	failures: { reason: string }[];
}

/**
 * Write each {@link ContextImage} to `.cascade/context/images/` with the
 * stable naming convention `work-item-<id>-img-<index>.<ext>`. Idempotent
 * — running twice with the same workItemId overwrites the prior files
 * (caller is responsible for re-running if it wants fresh bytes).
 */
export async function writeRuntimeImages(
	args: WriteRuntimeImagesArgs,
): Promise<WriteRuntimeImagesResult> {
	const { workItemId, images, repoDir } = args;
	if (images.length === 0) return { paths: [], failures: [] };

	const baseDir = repoDir
		? join(repoDir, DEFAULT_CONTEXT_IMAGES_RELATIVE)
		: DEFAULT_CONTEXT_IMAGES_RELATIVE;

	// Always mkdir -p; cheap, idempotent.
	await mkdir(baseDir, { recursive: true });

	const paths: string[] = [];
	const failures: { reason: string }[] = [];

	for (let i = 0; i < images.length; i++) {
		const img = images[i];
		const ext = resolveExtension(img.mimeType, workItemId);
		const filename = `work-item-${workItemId}-img-${i}.${ext}`;
		const absolutePath = join(baseDir, filename);
		// Repo-relative path is what we return to the caller for inclusion in
		// the agent's text response — the agent's Read tool consumes paths
		// relative to its workspace root.
		const relativePath = repoDir
			? `${DEFAULT_CONTEXT_IMAGES_RELATIVE}/${filename}`
			: `${DEFAULT_CONTEXT_IMAGES_RELATIVE}/${filename}`;

		try {
			const buffer = Buffer.from(img.base64Data, 'base64');
			await writeFile(absolutePath, buffer);
			paths.push(relativePath);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			logger.warn('writeRuntimeImages: failed to write image', {
				workItemId,
				index: i,
				path: relativePath,
				reason,
			});
			failures.push({ reason });
		}
	}

	return { paths, failures };
}
