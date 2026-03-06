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
		case 'table': {
			const rows = (n.content ?? []) as AdfNode[];
			const rowLines: string[] = [];
			let headerSeparatorInserted = false;
			for (const row of rows) {
				const cells = (row.content ?? []) as AdfNode[];
				const cellTexts = cells.map((cell) => adfToPlainText(cell).trim());
				rowLines.push(`| ${cellTexts.join(' | ')} |`);
				// Insert separator after the first row (header row)
				if (!headerSeparatorInserted) {
					rowLines.push(`| ${cells.map(() => '---').join(' | ')} |`);
					headerSeparatorInserted = true;
				}
			}
			return [...rowLines, ''];
		}
		case 'tableRow':
			return [(n.content ?? []).map((cell) => adfToPlainText(cell)).join(' | ')];
		case 'tableHeader':
		case 'tableCell':
			return [adfToPlainText(n)];
		default:
			return [adfToPlainText(n)];
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
