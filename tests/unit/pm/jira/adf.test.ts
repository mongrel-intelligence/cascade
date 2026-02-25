import { describe, expect, it } from 'vitest';
import { adfToPlainText, markdownToAdf } from '../../../../src/pm/jira/adf.js';

describe('markdownToAdf', () => {
	it('converts a simple paragraph', () => {
		const result = markdownToAdf('Hello world');
		expect(result).toEqual({
			type: 'doc',
			version: 1,
			content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
		});
	});

	it('converts headings', () => {
		const result = markdownToAdf('## My Heading') as { content: unknown[] };
		expect(result.content[0]).toEqual({
			type: 'heading',
			attrs: { level: 2 },
			content: [{ type: 'text', text: 'My Heading' }],
		});
	});

	it('converts different heading levels', () => {
		for (let level = 1; level <= 6; level++) {
			const md = `${'#'.repeat(level)} Heading ${level}`;
			const result = markdownToAdf(md) as { content: Array<{ attrs: { level: number } }> };
			expect(result.content[0].attrs.level).toBe(level);
		}
	});

	it('converts bullet lists', () => {
		const result = markdownToAdf('- Item 1\n- Item 2\n- Item 3') as { content: unknown[] };
		const list = result.content[0] as { type: string; content: unknown[] };
		expect(list.type).toBe('bulletList');
		expect(list.content).toHaveLength(3);
	});

	it('converts bullet lists with * marker', () => {
		const result = markdownToAdf('* Item 1\n* Item 2') as { content: unknown[] };
		const list = result.content[0] as { type: string; content: unknown[] };
		expect(list.type).toBe('bulletList');
		expect(list.content).toHaveLength(2);
	});

	it('converts code blocks', () => {
		const md = '```typescript\nconst x = 1;\n```';
		const result = markdownToAdf(md) as { content: unknown[] };
		expect(result.content[0]).toEqual({
			type: 'codeBlock',
			attrs: { language: 'typescript' },
			content: [{ type: 'text', text: 'const x = 1;' }],
		});
	});

	it('converts code blocks without language', () => {
		const md = '```\nsome code\n```';
		const result = markdownToAdf(md) as { content: unknown[] };
		// marklassian uses language: 'text' for unlabelled code blocks
		const block = result.content[0] as { type: string; content: unknown[] };
		expect(block.type).toBe('codeBlock');
	});

	it('converts bold text', () => {
		const result = markdownToAdf('Hello **bold** world') as { content: unknown[] };
		const para = result.content[0] as { content: unknown[] };
		expect(para.content).toContainEqual({
			type: 'text',
			text: 'bold',
			marks: [{ type: 'strong' }],
		});
	});

	it('converts inline code', () => {
		const result = markdownToAdf('Use `code` here') as { content: unknown[] };
		const para = result.content[0] as { content: unknown[] };
		expect(para.content).toContainEqual({
			type: 'text',
			text: 'code',
			marks: [{ type: 'code' }],
		});
	});

	it('skips empty lines', () => {
		const result = markdownToAdf('Line 1\n\nLine 2') as { content: unknown[] };
		expect(result.content).toHaveLength(2);
		expect(result.content[0]).toMatchObject({ type: 'paragraph' });
		expect(result.content[1]).toMatchObject({ type: 'paragraph' });
	});

	it('returns empty content for empty input', () => {
		const result = markdownToAdf('') as { content: unknown[] };
		// marklassian returns an empty content array for empty input
		expect(result.content).toEqual([]);
	});

	it('handles mixed content', () => {
		const md = '# Title\n\nSome text\n\n- Item 1\n- Item 2\n\n```js\nconsole.log(1);\n```';
		const result = markdownToAdf(md) as { content: Array<{ type: string }> };
		const types = result.content.map((n) => n.type);
		expect(types).toEqual(['heading', 'paragraph', 'bulletList', 'codeBlock']);
	});

	it('converts markdown tables to ADF table nodes', () => {
		const md = '| Col1 | Col2 |\n| --- | --- |\n| A | B |';
		const result = markdownToAdf(md) as { content: unknown[] };
		expect(result.content).toHaveLength(1);
		const table = result.content[0] as { type: string; content: unknown[] };
		expect(table.type).toBe('table');
		// Two rows: header row + data row
		expect(table.content).toHaveLength(2);
		const headerRow = table.content[0] as { type: string; content: unknown[] };
		expect(headerRow.type).toBe('tableRow');
		const headerCells = headerRow.content as Array<{ type: string }>;
		expect(headerCells[0].type).toBe('tableHeader');
		expect(headerCells[1].type).toBe('tableHeader');
	});

	it('converts markdown table header cell text', () => {
		const md = '| Name | Age |\n| --- | --- |\n| Alice | 30 |';
		const result = markdownToAdf(md) as {
			content: Array<{
				type: string;
				content: Array<{
					type: string;
					content: Array<{ type: string; content: Array<{ type: string; content: unknown[] }> }>;
				}>;
			}>;
		};
		const table = result.content[0];
		const headerRow = table.content[0];
		const firstHeaderCell = headerRow.content[0];
		// tableHeader > paragraph > text
		const para = firstHeaderCell.content[0];
		expect(para.type).toBe('paragraph');
	});

	it('converts markdown links to ADF link marks', () => {
		const md = '[Click here](https://example.com)';
		const result = markdownToAdf(md) as { content: unknown[] };
		const para = result.content[0] as { content: unknown[] };
		const linkNode = para.content[0] as { type: string; text: string; marks: unknown[] };
		expect(linkNode.type).toBe('text');
		expect(linkNode.text).toBe('Click here');
		expect(linkNode.marks).toContainEqual({
			type: 'link',
			attrs: { href: 'https://example.com' },
		});
	});

	it('converts inline link within text', () => {
		const md = 'See [docs](https://docs.example.com) for details';
		const result = markdownToAdf(md) as { content: unknown[] };
		const para = result.content[0] as { content: unknown[] };
		// Should have text nodes including one with a link mark
		const hasLink = para.content.some(
			(n) =>
				typeof n === 'object' &&
				n !== null &&
				'marks' in n &&
				Array.isArray((n as { marks: unknown[] }).marks) &&
				(n as { marks: Array<{ type: string }> }).marks.some((m) => m.type === 'link'),
		);
		expect(hasLink).toBe(true);
	});
});

describe('adfToPlainText', () => {
	it('converts a simple paragraph', () => {
		const adf = {
			type: 'doc',
			version: 1,
			content: [
				{
					type: 'paragraph',
					content: [{ type: 'text', text: 'Hello world' }],
				},
			],
		};
		expect(adfToPlainText(adf)).toBe('Hello world');
	});

	it('converts headings', () => {
		const adf = {
			type: 'doc',
			version: 1,
			content: [
				{
					type: 'heading',
					attrs: { level: 2 },
					content: [{ type: 'text', text: 'Title' }],
				},
			],
		};
		expect(adfToPlainText(adf)).toBe('## Title');
	});

	it('converts bullet lists', () => {
		const adf = {
			type: 'doc',
			version: 1,
			content: [
				{
					type: 'bulletList',
					content: [
						{
							type: 'listItem',
							content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item 1' }] }],
						},
						{
							type: 'listItem',
							content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item 2' }] }],
						},
					],
				},
			],
		};
		const result = adfToPlainText(adf);
		expect(result).toContain('- Item 1');
		expect(result).toContain('- Item 2');
	});

	it('converts code blocks', () => {
		const adf = {
			type: 'doc',
			version: 1,
			content: [
				{
					type: 'codeBlock',
					content: [{ type: 'text', text: 'const x = 1;' }],
				},
			],
		};
		const result = adfToPlainText(adf);
		expect(result).toContain('```');
		expect(result).toContain('const x = 1;');
	});

	it('returns empty string for null/undefined', () => {
		expect(adfToPlainText(null)).toBe('');
		expect(adfToPlainText(undefined)).toBe('');
	});

	it('returns empty string for non-object', () => {
		expect(adfToPlainText('string')).toBe('');
		expect(adfToPlainText(42)).toBe('');
	});

	it('returns text from text node', () => {
		expect(adfToPlainText({ type: 'text', text: 'Hello' })).toBe('Hello');
	});

	it('returns empty string when text is missing', () => {
		expect(adfToPlainText({ type: 'text' })).toBe('');
	});

	it('handles nested content', () => {
		const adf = {
			type: 'doc',
			version: 1,
			content: [
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'Hello ' },
						{ type: 'text', text: 'world' },
					],
				},
			],
		};
		expect(adfToPlainText(adf)).toBe('Hello \nworld');
	});

	it('collapses triple+ newlines', () => {
		const adf = {
			type: 'doc',
			version: 1,
			content: [
				{ type: 'paragraph', content: [{ type: 'text', text: 'Line 1' }] },
				{ type: 'paragraph', content: [{ type: 'text', text: 'Line 2' }] },
			],
		};
		const result = adfToPlainText(adf);
		expect(result).not.toMatch(/\n{3,}/);
	});

	it('converts ADF table to markdown table format', () => {
		const adf = {
			type: 'doc',
			version: 1,
			content: [
				{
					type: 'table',
					content: [
						{
							type: 'tableRow',
							content: [
								{
									type: 'tableHeader',
									content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col1' }] }],
								},
								{
									type: 'tableHeader',
									content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col2' }] }],
								},
							],
						},
						{
							type: 'tableRow',
							content: [
								{
									type: 'tableCell',
									content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
								},
								{
									type: 'tableCell',
									content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }],
								},
							],
						},
					],
				},
			],
		};
		const result = adfToPlainText(adf);
		// Should have a header row
		expect(result).toContain('| Col1 | Col2 |');
		// Should have separator row
		expect(result).toContain('| --- | --- |');
		// Should have data row
		expect(result).toContain('| A | B |');
	});

	it('converts ADF table with inline formatting in cells', () => {
		const adf = {
			type: 'doc',
			version: 1,
			content: [
				{
					type: 'table',
					content: [
						{
							type: 'tableRow',
							content: [
								{
									type: 'tableHeader',
									content: [
										{
											type: 'paragraph',
											content: [{ type: 'text', text: 'Name', marks: [{ type: 'strong' }] }],
										},
									],
								},
								{
									type: 'tableHeader',
									content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Value' }] }],
								},
							],
						},
						{
							type: 'tableRow',
							content: [
								{
									type: 'tableCell',
									content: [{ type: 'paragraph', content: [{ type: 'text', text: 'key1' }] }],
								},
								{
									type: 'tableCell',
									content: [{ type: 'paragraph', content: [{ type: 'text', text: '100' }] }],
								},
							],
						},
					],
				},
			],
		};
		const result = adfToPlainText(adf);
		expect(result).toContain('Name');
		expect(result).toContain('Value');
		expect(result).toContain('key1');
		expect(result).toContain('100');
		expect(result).toContain('---');
	});

	it('handles empty table cells', () => {
		const adf = {
			type: 'doc',
			version: 1,
			content: [
				{
					type: 'table',
					content: [
						{
							type: 'tableRow',
							content: [
								{
									type: 'tableHeader',
									content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
								},
								{
									type: 'tableHeader',
									content: [{ type: 'paragraph', content: [] }],
								},
							],
						},
					],
				},
			],
		};
		const result = adfToPlainText(adf);
		expect(result).toContain('| A |');
	});
});

describe('roundtrip: markdownToAdf -> adfToPlainText', () => {
	it('preserves simple text', () => {
		const md = 'Hello world';
		const adf = markdownToAdf(md);
		const result = adfToPlainText(adf);
		expect(result).toBe('Hello world');
	});

	it('preserves headings', () => {
		const md = '## My Title';
		const adf = markdownToAdf(md);
		const result = adfToPlainText(adf);
		expect(result).toBe('## My Title');
	});

	it('preserves bullet list content', () => {
		const md = '- First\n- Second';
		const adf = markdownToAdf(md);
		const result = adfToPlainText(adf);
		expect(result).toContain('First');
		expect(result).toContain('Second');
	});

	it('preserves code block content', () => {
		const md = '```\ncode here\n```';
		const adf = markdownToAdf(md);
		const result = adfToPlainText(adf);
		expect(result).toContain('code here');
	});

	it('roundtrips a markdown table', () => {
		const md = '| Header1 | Header2 |\n| --- | --- |\n| Cell1 | Cell2 |';
		const adf = markdownToAdf(md);
		const result = adfToPlainText(adf);
		// The result should be a recognizable markdown table
		expect(result).toContain('| Header1 | Header2 |');
		expect(result).toContain('| --- | --- |');
		expect(result).toContain('| Cell1 | Cell2 |');
	});

	it('roundtrips a table with multiple data rows', () => {
		const md = '| Name | Score |\n| --- | --- |\n| Alice | 95 |\n| Bob | 87 |\n| Charlie | 92 |';
		const adf = markdownToAdf(md);
		const result = adfToPlainText(adf);
		expect(result).toContain('Alice');
		expect(result).toContain('Bob');
		expect(result).toContain('Charlie');
		expect(result).toContain('Name');
		expect(result).toContain('Score');
	});

	it('roundtrips a table with inline formatting in cells', () => {
		const md = '| **Bold** | Normal |\n| --- | --- |\n| `code` | plain |';
		const adf = markdownToAdf(md);
		const result = adfToPlainText(adf);
		// Should preserve cell content (text without marks in plain output)
		expect(result).toContain('Bold');
		expect(result).toContain('Normal');
		expect(result).toContain('code');
		expect(result).toContain('plain');
	});
});
