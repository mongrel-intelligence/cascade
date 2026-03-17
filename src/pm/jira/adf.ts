/**
 * Atlassian Document Format (ADF) helpers.
 *
 * JIRA Cloud's REST API v3 uses ADF for rich text fields.
 * These helpers convert between markdown and ADF.
 *
 * markdownToAdf: delegates to the `marklassian` library which handles
 * tables, links, strikethrough, blockquotes, task lists, and more.
 *
 * adfToPlainText: custom reverse converter (ADF → plain text / markdown).
 */

export { markdownToAdf } from 'marklassian';

/**
 * Convert ADF document to plain text.
 * Used when reading JIRA issue descriptions/comments.
 */
interface AdfNode {
	type?: string;
	content?: unknown[];
	text?: string;
	attrs?: Record<string, unknown>;
}

/** Converts an ADF table node to markdown table lines. */
function convertTableNode(n: AdfNode): string[] {
	const rows = (n.content ?? []) as AdfNode[];
	const rowLines: string[] = [];
	let headerSeparatorInserted = false;
	for (const row of rows) {
		const cells = (row.content ?? []) as AdfNode[];
		const cellTexts = cells.map((cell) => adfToPlainText(cell).trim());
		rowLines.push(`| ${cellTexts.join(' | ')} |`);
		if (!headerSeparatorInserted) {
			rowLines.push(`| ${cells.map(() => '---').join(' | ')} |`);
			headerSeparatorInserted = true;
		}
	}
	return [...rowLines, ''];
}

/** Converts mediaSingle/mediaGroup nodes to image placeholder lines. */
function convertMediaContainerNode(n: AdfNode): string[] {
	const mediaNodes = (n.content ?? []) as AdfNode[];
	const placeholders = mediaNodes.map((m) => {
		const alt = (m.attrs?.alt as string | undefined) ?? '';
		return `[Image: ${alt}]`;
	});
	return placeholders.length > 0 ? [...placeholders, ''] : [''];
}

function convertAdfNode(n: AdfNode): string[] {
	switch (n.type) {
		case 'paragraph':
			return [adfToPlainText(n), ''];
		case 'heading': {
			const level = (n.attrs?.level as number) ?? 1;
			return [`${'#'.repeat(level)} ${adfToPlainText(n)}`, ''];
		}
		case 'bulletList':
			return [...(n.content ?? []).map((item) => `- ${adfToPlainText(item)}`), ''];
		case 'listItem':
			return [adfToPlainText(n)];
		case 'codeBlock':
			return ['```', adfToPlainText(n), '```', ''];
		case 'text':
			return [n.text ?? ''];
		case 'table':
			return convertTableNode(n);
		case 'tableRow':
			return [(n.content ?? []).map((cell) => adfToPlainText(cell)).join(' | ')];
		case 'tableHeader':
		case 'tableCell':
			return [adfToPlainText(n)];
		case 'mediaSingle':
		case 'mediaGroup':
			return convertMediaContainerNode(n);
		case 'media': {
			const alt = (n.attrs?.alt as string | undefined) ?? '';
			return [`[Image: ${alt}]`];
		}
		default:
			return [adfToPlainText(n)];
	}
}

// ---------------------------------------------------------------------------
// ADF media node extraction
// ---------------------------------------------------------------------------

/**
 * A raw JIRA media reference extracted from an ADF document.
 * Contains the JIRA-internal media ID (from attrs.id) and optional metadata.
 */
export interface AdfMediaReference {
	/** JIRA media ID (value of attrs.id on a media node) */
	mediaId: string;
	/** Media type as reported by JIRA (e.g. 'file', 'external') */
	mediaType: string;
	/** Optional alt text from attrs.alt */
	altText?: string;
}

/**
 * Walks an ADF document tree and returns all `media` node references found.
 * Both `mediaSingle` and `mediaGroup` wrappers are traversed transparently.
 *
 * @param adf - An ADF document (or any ADF node/subtree). Accepts unknown so
 *              callers can pass raw API fields without casting.
 * @returns Array of {@link AdfMediaReference} objects; empty when none found.
 *
 * @example
 * ```ts
 * const refs = extractAdfMediaNodes(fields.description);
 * // [{ mediaId: 'abc-123', mediaType: 'file', altText: undefined }]
 * ```
 */
export function extractAdfMediaNodes(adf: unknown): AdfMediaReference[] {
	if (!adf || typeof adf !== 'object') return [];

	const results: AdfMediaReference[] = [];
	collectMediaNodes(adf as AdfNode, results);
	return results;
}

/** Recursive helper that appends media node refs to `results`. */
function collectMediaNodes(node: AdfNode, results: AdfMediaReference[]): void {
	if (node.type === 'media') {
		const mediaId = node.attrs?.id as string | undefined;
		if (mediaId) {
			results.push({
				mediaId,
				mediaType: (node.attrs?.type as string | undefined) ?? 'file',
				altText: node.attrs?.alt as string | undefined,
			});
		}
		// media nodes do not have children — no need to recurse
		return;
	}

	// Recurse into content for all other node types
	if (Array.isArray(node.content)) {
		for (const child of node.content) {
			collectMediaNodes(child as AdfNode, results);
		}
	}
}

export function adfToPlainText(adf: unknown): string {
	if (!adf || typeof adf !== 'object') return '';

	const doc = adf as AdfNode;

	if (doc.type === 'text') return doc.text ?? '';
	if (!doc.content || !Array.isArray(doc.content)) return doc.text ?? '';

	const parts: string[] = [];
	for (const node of doc.content) {
		parts.push(...convertAdfNode(node as AdfNode));
	}

	return parts
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
