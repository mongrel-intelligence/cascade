/**
 * Atlassian Document Format (ADF) helpers.
 *
 * JIRA Cloud's REST API v3 uses ADF for rich text fields.
 * These helpers convert between markdown and ADF.
 */

/**
 * Convert a simple markdown string to ADF document.
 * Handles paragraphs, headings, bullet lists, bold, inline code, and code blocks.
 */
function parseCodeBlock(lines: string[], startIndex: number): { node: unknown; nextIndex: number } {
	const lang = lines[startIndex].slice(3).trim();
	const codeLines: string[] = [];
	let i = startIndex + 1;
	while (i < lines.length && !lines[i].startsWith('```')) {
		codeLines.push(lines[i]);
		i++;
	}
	return {
		node: {
			type: 'codeBlock',
			attrs: lang ? { language: lang } : {},
			content: [{ type: 'text', text: codeLines.join('\n') }],
		},
		nextIndex: i + 1, // skip closing ```
	};
}

function parseBulletList(
	lines: string[],
	startIndex: number,
): { node: unknown; nextIndex: number } {
	const items: unknown[] = [];
	let i = startIndex;
	while (i < lines.length && lines[i].match(/^[-*]\s+/)) {
		const itemText = lines[i].replace(/^[-*]\s+/, '');
		items.push({
			type: 'listItem',
			content: [{ type: 'paragraph', content: inlineToAdf(itemText) }],
		});
		i++;
	}
	return { node: { type: 'bulletList', content: items }, nextIndex: i };
}

export function markdownToAdf(markdown: string): unknown {
	const lines = markdown.split('\n');
	const content: unknown[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		if (line.startsWith('```')) {
			const result = parseCodeBlock(lines, i);
			content.push(result.node);
			i = result.nextIndex;
			continue;
		}

		const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
		if (headingMatch) {
			content.push({
				type: 'heading',
				attrs: { level: headingMatch[1].length },
				content: inlineToAdf(headingMatch[2]),
			});
			i++;
			continue;
		}

		if (line.match(/^[-*]\s+/)) {
			const result = parseBulletList(lines, i);
			content.push(result.node);
			i = result.nextIndex;
			continue;
		}

		if (line.trim() === '') {
			i++;
			continue;
		}

		content.push({
			type: 'paragraph',
			content: inlineToAdf(line),
		});
		i++;
	}

	return {
		type: 'doc',
		version: 1,
		content: content.length > 0 ? content : [{ type: 'paragraph', content: [] }],
	};
}

/**
 * Convert inline markdown to ADF inline nodes.
 */
function inlineToAdf(text: string): unknown[] {
	const nodes: unknown[] = [];
	// Simple approach: handle **bold**, `code`, and plain text
	const regex = /(\*\*(.+?)\*\*|`([^`]+)`)/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null = regex.exec(text);

	while (match !== null) {
		// Add plain text before this match
		if (match.index > lastIndex) {
			nodes.push({ type: 'text', text: text.slice(lastIndex, match.index) });
		}

		if (match[2]) {
			// Bold
			nodes.push({ type: 'text', text: match[2], marks: [{ type: 'strong' }] });
		} else if (match[3]) {
			// Inline code
			nodes.push({ type: 'text', text: match[3], marks: [{ type: 'code' }] });
		}

		lastIndex = match.index + match[0].length;
		match = regex.exec(text);
	}

	// Add remaining plain text
	if (lastIndex < text.length) {
		nodes.push({ type: 'text', text: text.slice(lastIndex) });
	}

	// Fallback for empty
	if (nodes.length === 0 && text) {
		nodes.push({ type: 'text', text });
	}

	return nodes;
}

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
