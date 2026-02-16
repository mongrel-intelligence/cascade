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
export function markdownToAdf(markdown: string): unknown {
	const lines = markdown.split('\n');
	const content: unknown[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		// Code block
		if (line.startsWith('```')) {
			const lang = line.slice(3).trim();
			const codeLines: string[] = [];
			i++;
			while (i < lines.length && !lines[i].startsWith('```')) {
				codeLines.push(lines[i]);
				i++;
			}
			i++; // skip closing ```
			content.push({
				type: 'codeBlock',
				attrs: lang ? { language: lang } : {},
				content: [{ type: 'text', text: codeLines.join('\n') }],
			});
			continue;
		}

		// Heading
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

		// Bullet list
		if (line.match(/^[-*]\s+/)) {
			const items: unknown[] = [];
			while (i < lines.length && lines[i].match(/^[-*]\s+/)) {
				const itemText = lines[i].replace(/^[-*]\s+/, '');
				items.push({
					type: 'listItem',
					content: [{ type: 'paragraph', content: inlineToAdf(itemText) }],
				});
				i++;
			}
			content.push({ type: 'bulletList', content: items });
			continue;
		}

		// Empty line
		if (line.trim() === '') {
			i++;
			continue;
		}

		// Regular paragraph
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
export function adfToPlainText(adf: unknown): string {
	if (!adf || typeof adf !== 'object') return '';

	const doc = adf as { type?: string; content?: unknown[]; text?: string };

	if (doc.type === 'text') {
		return doc.text ?? '';
	}

	if (!doc.content || !Array.isArray(doc.content)) {
		return doc.text ?? '';
	}

	const parts: string[] = [];
	for (const node of doc.content) {
		const n = node as {
			type?: string;
			content?: unknown[];
			text?: string;
			attrs?: Record<string, unknown>;
		};

		switch (n.type) {
			case 'paragraph':
				parts.push(adfToPlainText(n));
				parts.push('');
				break;
			case 'heading': {
				const level = (n.attrs?.level as number) ?? 1;
				parts.push(`${'#'.repeat(level)} ${adfToPlainText(n)}`);
				parts.push('');
				break;
			}
			case 'bulletList':
				if (n.content) {
					for (const item of n.content) {
						parts.push(`- ${adfToPlainText(item)}`);
					}
				}
				parts.push('');
				break;
			case 'listItem':
				parts.push(adfToPlainText(n));
				break;
			case 'codeBlock':
				parts.push('```');
				parts.push(adfToPlainText(n));
				parts.push('```');
				parts.push('');
				break;
			case 'text':
				parts.push(n.text ?? '');
				break;
			default:
				parts.push(adfToPlainText(n));
				break;
		}
	}

	return parts
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
