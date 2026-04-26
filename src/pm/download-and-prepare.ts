/**
 * Download-and-prepare helper for work-item images.
 *
 * Lifted from `src/agents/definitions/contextSteps.ts` (the inline loop in
 * `fetchWorkItemStep`) into a shared module so spec 016/2's runtime gadget
 * can call it too. Both call sites get the same per-provider dispatch, the
 * same Promise.all, and the same per-failure WARN log.
 *
 * Spec 016/1.
 */

import type { ContextImage } from '../agents/contracts/index.js';
import { getPMProviderOrNull } from './index.js';
import { MAX_IMAGES_PER_WORK_ITEM } from './media.js';
import type { MediaReference } from './types.js';

export type LogWriter = (
	level: 'INFO' | 'WARN' | 'ERROR',
	message: string,
	meta?: Record<string, unknown>,
) => void;

export interface DownloadAndPrepareResult {
	images: ContextImage[];
	failures: { url: string; reason: string }[];
}

/**
 * Downloads each {@link MediaReference} via the appropriate per-provider
 * client (jira / linear / trello) and prepares them as {@link ContextImage}
 * entries with base64 bytes and the resolved Content-Type-derived MIME.
 *
 * Caps at {@link MAX_IMAGES_PER_WORK_ITEM}.
 *
 * Failures are returned as a parallel array, never thrown — so the caller
 * can always surface a stable success/failure summary in its diagnostic log.
 */
export async function downloadAndPrepareImages(
	workItemId: string,
	media: MediaReference[],
	logWriter: LogWriter,
): Promise<DownloadAndPrepareResult> {
	if (media.length === 0) return { images: [], failures: [] };

	const provider = getPMProviderOrNull();
	const limited = media.slice(0, MAX_IMAGES_PER_WORK_ITEM);

	const { jiraClient } = await import('../jira/client.js');
	const { trelloClient } = await import('../trello/client.js');
	const { linearClient } = await import('../linear/client.js');

	const failures: { url: string; reason: string }[] = [];

	const results = await Promise.all(
		limited.map(async (ref) => {
			try {
				let downloaded: { buffer: Buffer; mimeType: string } | null = null;
				if (provider?.type === 'jira') {
					downloaded = await jiraClient.downloadAttachment(ref.url);
				} else if (provider?.type === 'linear') {
					downloaded = await linearClient.downloadAttachment(ref.url);
				} else {
					downloaded = await trelloClient.downloadAttachment(ref.url);
				}
				if (!downloaded) {
					logWriter('WARN', 'downloadAndPrepareImages: download returned null', {
						workItemId,
						url: ref.url.split('?')[0],
					});
					failures.push({ url: ref.url, reason: 'download returned null' });
					return null;
				}
				return {
					base64Data: downloaded.buffer.toString('base64'),
					mimeType: downloaded.mimeType,
					altText: ref.altText,
				};
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				logWriter('WARN', 'downloadAndPrepareImages: failed to download image', {
					workItemId,
					url: ref.url.split('?')[0],
					error: reason,
				});
				failures.push({ url: ref.url, reason });
				return null;
			}
		}),
	);

	const images: ContextImage[] = [];
	for (const r of results) {
		if (r !== null) images.push(r);
	}
	return { images, failures };
}
