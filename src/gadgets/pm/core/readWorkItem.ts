import type { Attachment, MediaReference } from '../../../pm/index.js';
import { filterImageMedia, getPMProvider, getPMProviderOrNull } from '../../../pm/index.js';
import { logger } from '../../../utils/logging.js';

interface Label {
	name: string;
	color?: string;
}

interface ChecklistItem {
	id: string;
	name: string;
	complete: boolean;
}

interface Checklist {
	id: string;
	name: string;
	items: ChecklistItem[];
}

interface Comment {
	author: { name: string };
	date: string;
	text: string;
	inlineMedia?: MediaReference[];
}

/**
 * Result returned by readWorkItemWithMedia().
 */
export interface WorkItemWithMedia {
	/** Formatted text representation of the work item */
	text: string;
	/** All image media references discovered in the work item description, card attachments, and comments (deduplicated by URL) */
	media: MediaReference[];
	/** The total number of media and attachment references found before MIME-type filtering */
	urlsDetected: number;
}

function formatLabels(labels: Label[]): string {
	if (labels.length === 0) return '';
	const items = labels.map((l) => `- ${l.name}${l.color ? ` (${l.color})` : ''}`).join('\n');
	return `## Labels\n\n${items}\n\n`;
}

function formatChecklists(checklists: Checklist[]): string {
	if (checklists.length === 0) return '';
	let result = '## Checklists\n\n';
	for (const checklist of checklists) {
		result += `### ${checklist.name} [checklistId: ${checklist.id}]\n\n`;
		for (const item of checklist.items) {
			const checkbox = item.complete ? '[x]' : '[ ]';
			result += `- ${checkbox} ${item.name} [checkItemId: ${item.id}]\n`;
		}
		result += '\n';
	}
	return result;
}

function formatAttachments(attachments: Attachment[]): string {
	if (attachments.length === 0) return '';
	let result = '## Attachments\n\n';
	for (const att of attachments) {
		result += `- [${att.name}](${att.url})`;
		if (att.date) {
			result += ` (${new Date(att.date).toISOString()})`;
		}
		result += '\n';
	}
	return `${result}\n`;
}

function formatComments(comments: Comment[]): string {
	if (comments.length === 0) return '## Comments\n\n(No comments)\n\n';
	let result = `## Comments (${comments.length})\n\n`;
	for (const comment of comments.slice().reverse()) {
		const date = new Date(comment.date).toISOString();
		result += `### ${comment.author.name} (${date})\n\n`;
		result += `${comment.text}\n\n`;
	}
	return result;
}

/**
 * Formats a list of pre-fetched image media references as a [Pre-fetched Images] section.
 * Each image is listed with its source and optional alt text.
 */
function formatPreFetchedImages(images: MediaReference[]): string {
	if (images.length === 0) return '';
	let result = '## Pre-fetched Images\n\n';
	for (const img of images) {
		const label = img.altText ? img.altText : (img.url.split('?')[0].split('/').pop() ?? img.url);
		result += `- [Image: ${label}] (${img.source})\n`;
	}
	return `${result}\n`;
}

/**
 * Reads a work item and returns both the formatted text and any image media
 * references found in the work item description and comments.
 *
 * Image references are collected from:
 * - Work item description (`item.inlineMedia`)
 * - Card attachments with image MIME types
 * - Each comment (`comment.inlineMedia`)
 *
 * Only image MIME types are included (filtered via filterImageMedia).
 */
export async function readWorkItemWithMedia(
	workItemId: string,
	includeComments = true,
): Promise<WorkItemWithMedia> {
	const provider = getPMProvider();
	const [item, checklists, attachments] = await Promise.all([
		provider.getWorkItem(workItemId),
		provider.getChecklists(workItemId),
		provider.getAttachments(workItemId),
	]);

	// Collect all image media references
	const allMedia: MediaReference[] = [];
	let urlsDetected = 0;

	if (item.inlineMedia && item.inlineMedia.length > 0) {
		urlsDetected += item.inlineMedia.length;
		allMedia.push(...filterImageMedia(item.inlineMedia));
	}

	// Add image-type card attachments as media references
	urlsDetected += attachments.length;
	allMedia.push(
		...filterImageMedia(
			attachments.map((att) => ({
				url: att.url,
				mimeType: att.mimeType,
				altText: att.name,
				source: 'attachment' as const,
			})),
		),
	);

	let text = `# ${item.title}\n\n**URL:** ${item.url}\n\n## Description\n\n${item.description || '(No description)'}\n\n`;
	text += formatLabels(item.labels);
	text += formatChecklists(checklists);
	text += formatAttachments(attachments);

	if (includeComments) {
		const comments = await provider.getWorkItemComments(workItemId);
		for (const comment of comments) {
			if (comment.inlineMedia && comment.inlineMedia.length > 0) {
				urlsDetected += comment.inlineMedia.length;
				allMedia.push(...filterImageMedia(comment.inlineMedia));
			}
		}
		text += formatComments(comments);
	}

	// Deduplicate by URL — JIRA description images are always backed by an attachment,
	// so the same URL can appear via item.inlineMedia and via getAttachments(). Keep
	// the first occurrence (description > attachment > comment priority).
	const seen = new Set<string>();
	const dedupedMedia = allMedia.filter((ref) => {
		if (seen.has(ref.url)) return false;
		seen.add(ref.url);
		return true;
	});

	// Append pre-fetched images section listing discovered images
	text += formatPreFetchedImages(dedupedMedia);

	return { text, media: dedupedMedia, urlsDetected };
}

/**
 * Format the on-disk paths for a successfully-written batch of runtime
 * images. Replaces the existing "Pre-fetched Images" URL list with a
 * "Local Image Files" section that the agent can hand to its file-read
 * tool. Failed downloads (if any) are surfaced inline so the agent
 * doesn't silently miss missing context.
 */
function formatRuntimeImagePaths(
	paths: string[],
	failures: { url: string; reason: string }[],
): string {
	if (paths.length === 0 && failures.length === 0) return '';
	const lines: string[] = ['## Local Image Files', ''];
	for (const path of paths) {
		lines.push(`- ${path}`);
	}
	if (failures.length > 0) {
		lines.push('', '### Failed Image Downloads');
		for (const f of failures) {
			lines.push(`- ${f.url} — ${f.reason}`);
		}
	}
	lines.push('');
	return `${lines.join('\n')}\n`;
}

/**
 * Spec 016/2: runtime gadget downloads + writes images to disk so the
 * agent can read them mid-run. Returns text whose pre-fetched-images
 * section now lists local file paths the agent can hand to its
 * file-read tool, not just URL refs.
 *
 * Each fetch emits the AC#5 grep-stable diagnostic line — same format
 * as the boot-path emission in `fetchWorkItemStep`.
 */
export async function readWorkItem(workItemId: string, includeComments = true): Promise<string> {
	try {
		const { text, media, urlsDetected } = await readWorkItemWithMedia(workItemId, includeComments);

		// Spec 016/2: download + write any image media so agent can Read them.
		const { downloadAndPrepareImages } = await import('../../../pm/download-and-prepare.js');
		const { writeRuntimeImages } = await import('./writeRuntimeImages.js');

		const provider = getPMProviderOrNull();
		const logWriter = (
			level: 'INFO' | 'WARN' | 'ERROR',
			message: string,
			meta?: Record<string, unknown>,
		) => {
			logger[level.toLowerCase() as 'info' | 'warn' | 'error'](message, meta);
		};

		const { images, failures } = await downloadAndPrepareImages(workItemId, media, logWriter);

		let writePaths: string[] = [];
		let writeFailures: { path: string; reason: string }[] = [];
		if (images.length > 0) {
			const writeResult = await writeRuntimeImages({ workItemId, images });
			writePaths = writeResult.paths;
			writeFailures = writeResult.failures;
		}
		// AC#5 diagnostic line — same prefix as the boot-path emission.
		const urlsByMimeType: Record<string, number> = {};
		for (const ref of media) {
			urlsByMimeType[ref.mimeType] = (urlsByMimeType[ref.mimeType] ?? 0) + 1;
		}
		logger.info('[image-pipeline] work-item-fetch summary', {
			provider: provider?.type ?? 'unknown',
			workItemId,
			urlsDetected,
			urlsAfterFilter: media.length,
			urlsDownloaded: images.length,
			urlsFailed: failures.length + writeFailures.length,
			urlsByMimeType,
		});

		// Append the local file paths section so agents can Read them.
		const downloadFailures: { url: string; reason: string }[] = failures.map((f) => ({
			url: f.url,
			reason: f.reason,
		}));
		for (const f of writeFailures) {
			downloadFailures.push({ url: f.path, reason: `Local write failed: ${f.reason}` });
		}
		const augmented = text + formatRuntimeImagePaths(writePaths, downloadFailures);
		return augmented;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Error reading work item: ${message}`);
	}
}
