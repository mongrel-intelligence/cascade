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
		const block = result.content[0] as { attrs: Record<string, unknown> };
		expect(block.attrs).toEqual({});
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

	it('returns empty paragraph for empty input', () => {
		const result = markdownToAdf('') as { content: unknown[] };
		expect(result.content).toEqual([{ type: 'paragraph', content: [] }]);
	});

	it('handles mixed content', () => {
		const md = '# Title\n\nSome text\n\n- Item 1\n- Item 2\n\n```js\nconsole.log(1);\n```';
		const result = markdownToAdf(md) as { content: Array<{ type: string }> };
		const types = result.content.map((n) => n.type);
		expect(types).toEqual(['heading', 'paragraph', 'bulletList', 'codeBlock']);
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
});
