import { describe, expect, it } from 'vitest';
import { parseLlmResponse } from '../../../src/utils/llmResponseParser.js';

describe.concurrent('parseLlmResponse', () => {
	describe('null / empty input', () => {
		it('returns empty result for null', () => {
			const result = parseLlmResponse(null);
			expect(result).toEqual({ blocks: [], toolNames: [], textPreview: '' });
		});

		it('returns empty result for undefined', () => {
			const result = parseLlmResponse(undefined);
			expect(result).toEqual({ blocks: [], toolNames: [], textPreview: '' });
		});

		it('returns empty result for empty string', () => {
			const result = parseLlmResponse('');
			expect(result).toEqual({ blocks: [], toolNames: [], textPreview: '' });
		});

		it('returns fresh objects (not a shared singleton)', () => {
			const a = parseLlmResponse(null);
			const b = parseLlmResponse(null);
			expect(a).not.toBe(b);
			expect(a.toolNames).not.toBe(b.toolNames);
		});
	});

	describe('Claude Code / OpenCode format (JSON array)', () => {
		it('parses text block', () => {
			const response = JSON.stringify([{ type: 'text', text: 'Hello world' }]);
			const result = parseLlmResponse(response);
			expect(result.blocks).toEqual([{ kind: 'text', text: 'Hello world' }]);
			expect(result.textPreview).toBe('Hello world');
			expect(result.toolNames).toEqual([]);
		});

		it('parses tool_use block with inputSummary for Read', () => {
			const response = JSON.stringify([
				{ type: 'tool_use', name: 'Read', input: { file_path: '/src/foo.ts' } },
			]);
			const result = parseLlmResponse(response);
			expect(result.blocks).toEqual([
				{ kind: 'tool_use', name: 'Read', inputSummary: '/src/foo.ts' },
			]);
			expect(result.toolNames).toEqual(['Read']);
		});

		it('parses tool_use block with inputSummary for Bash', () => {
			const response = JSON.stringify([
				{ type: 'tool_use', name: 'Bash', input: { command: 'npm test\nnpm run build' } },
			]);
			const result = parseLlmResponse(response);
			expect(result.blocks[0]).toMatchObject({ kind: 'tool_use', name: 'Bash' });
			expect((result.blocks[0] as { inputSummary: string }).inputSummary).toBe(
				'npm test npm run build',
			);
		});

		it('parses thinking block', () => {
			const response = JSON.stringify([{ type: 'thinking', thinking: 'Let me think...' }]);
			const result = parseLlmResponse(response);
			expect(result.blocks).toEqual([{ kind: 'thinking', text: 'Let me think...' }]);
			expect(result.toolNames).toEqual([]);
		});

		it('preserves duplicate tool names (not deduplicated)', () => {
			const response = JSON.stringify([
				{ type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' } },
				{ type: 'tool_use', name: 'Read', input: { file_path: '/b.ts' } },
				{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
			]);
			const result = parseLlmResponse(response);
			expect(result.toolNames).toEqual(['Read', 'Read', 'Bash']);
		});

		it('sets textPreview from first text block only', () => {
			const response = JSON.stringify([
				{ type: 'text', text: 'First' },
				{ type: 'text', text: 'Second' },
			]);
			const result = parseLlmResponse(response);
			expect(result.textPreview).toBe('First');
		});

		it('truncates textPreview at 120 chars', () => {
			const longText = 'A'.repeat(200);
			const response = JSON.stringify([{ type: 'text', text: longText }]);
			const result = parseLlmResponse(response);
			expect(result.textPreview).toBe(`${'A'.repeat(120)}…`);
		});

		it('truncates long file_path inputSummary at 100 chars', () => {
			const longPath = `/very/deep/${'a'.repeat(200)}`;
			const response = JSON.stringify([
				{ type: 'tool_use', name: 'Read', input: { file_path: longPath } },
			]);
			const result = parseLlmResponse(response);
			const block = result.blocks[0] as { inputSummary: string };
			expect(block.inputSummary.length).toBe(101); // 100 chars + '…'
			expect(block.inputSummary.endsWith('…')).toBe(true);
		});

		it('skips unknown block types', () => {
			const response = JSON.stringify([
				{ type: 'unknown', data: 'ignored' },
				{ type: 'text', text: 'visible' },
			]);
			const result = parseLlmResponse(response);
			expect(result.blocks).toHaveLength(1);
			expect(result.blocks[0]).toMatchObject({ kind: 'text', text: 'visible' });
		});

		it('falls back to JSON.stringify for unknown tool input', () => {
			const response = JSON.stringify([
				{ type: 'tool_use', name: 'CustomTool', input: { foo: 'bar' } },
			]);
			const result = parseLlmResponse(response);
			expect(result.blocks[0]).toMatchObject({
				kind: 'tool_use',
				name: 'CustomTool',
				inputSummary: '{"foo":"bar"}',
			});
		});
	});

	describe('Codex format (JSON object)', () => {
		it('parses text and tools', () => {
			const response = JSON.stringify({ turn: 1, text: 'Done', tools: ['Read', 'Bash'] });
			const result = parseLlmResponse(response);
			expect(result.blocks).toEqual([
				{ kind: 'text', text: 'Done' },
				{ kind: 'tool_use', name: 'Read', inputSummary: '' },
				{ kind: 'tool_use', name: 'Bash', inputSummary: '' },
			]);
			expect(result.toolNames).toEqual(['Read', 'Bash']);
			expect(result.textPreview).toBe('Done');
		});

		it('handles missing text field', () => {
			const response = JSON.stringify({ turn: 1, tools: ['Write'] });
			const result = parseLlmResponse(response);
			expect(result.blocks).toEqual([{ kind: 'tool_use', name: 'Write', inputSummary: '' }]);
			expect(result.textPreview).toBe('');
		});

		it('handles missing tools field', () => {
			const response = JSON.stringify({ turn: 1, text: 'Summary only' });
			const result = parseLlmResponse(response);
			expect(result.blocks).toEqual([{ kind: 'text', text: 'Summary only' }]);
			expect(result.toolNames).toEqual([]);
		});
	});

	describe('LLMist format (gadget markup)', () => {
		const gadget = (name: string, args: Record<string, string>) => {
			const argLines = Object.entries(args)
				.map(([k, v]) => `!!!ARG:${k}\n${v}`)
				.join('\n');
			return `!!!GADGET_START:${name}\n${argLines}\n!!!GADGET_END`;
		};

		it('parses a single gadget call', () => {
			const response = gadget('Read', { file_path: '/src/index.ts' });
			const result = parseLlmResponse(response);
			expect(result.blocks).toEqual([
				{ kind: 'tool_use', name: 'Read', inputSummary: '/src/index.ts' },
			]);
			expect(result.toolNames).toEqual(['Read']);
		});

		it('parses pre-gadget text as textPreview', () => {
			const response = `I will read the file now.\n${gadget('Read', { file_path: '/a.ts' })}`;
			const result = parseLlmResponse(response);
			expect(result.blocks[0]).toMatchObject({ kind: 'text', text: 'I will read the file now.' });
			expect(result.textPreview).toBe('I will read the file now.');
			expect(result.blocks[1]).toMatchObject({ kind: 'tool_use', name: 'Read' });
		});

		it('preserves duplicate tool names (not deduplicated)', () => {
			const response = [
				gadget('Read', { file_path: '/a.ts' }),
				gadget('Read', { file_path: '/b.ts' }),
				gadget('Bash', { command: 'ls' }),
			].join('\n');
			const result = parseLlmResponse(response);
			expect(result.toolNames).toEqual(['Read', 'Read', 'Bash']);
		});

		it('prefers priority args for inputSummary', () => {
			const response = gadget('CustomTool', { some_other: 'ignored', command: 'npm test' });
			const result = parseLlmResponse(response);
			expect((result.blocks[0] as { inputSummary: string }).inputSummary).toBe('npm test');
		});

		it('falls back to first arg when no priority arg present', () => {
			const response = gadget('CustomTool', { custom_arg: 'some value' });
			const result = parseLlmResponse(response);
			expect((result.blocks[0] as { inputSummary: string }).inputSummary).toBe('some value');
		});

		it('handles multi-line arg values', () => {
			const response =
				'!!!GADGET_START:Write\n!!!ARG:file_path\n/a.ts\n!!!ARG:content\nline1\nline2\n!!!GADGET_END';
			const result = parseLlmResponse(response);
			expect(result.blocks[0]).toMatchObject({
				kind: 'tool_use',
				name: 'Write',
				inputSummary: '/a.ts',
			});
		});

		it('truncates long inputSummary at 100 chars', () => {
			const longPath = `/very/deep/${'x'.repeat(200)}`;
			const response = gadget('Read', { file_path: longPath });
			const block = result_inputSummary(parseLlmResponse(response));
			expect(block.length).toBe(101);
			expect(block.endsWith('…')).toBe(true);
		});
	});

	describe('fallback for unparseable input', () => {
		it('treats plain text as a text block', () => {
			const response = 'This is just plain text, not JSON.';
			const result = parseLlmResponse(response);
			expect(result.blocks).toEqual([{ kind: 'text', text: response }]);
			expect(result.toolNames).toEqual([]);
			expect(result.textPreview).toBe(response);
		});

		it('truncates long plain text preview', () => {
			const response = 'X'.repeat(200);
			const result = parseLlmResponse(response);
			expect(result.textPreview).toBe(`${'X'.repeat(120)}…`);
		});
	});

	describe('edge cases', () => {
		it('ignores non-object items in JSON array', () => {
			const response = JSON.stringify([null, 'string', 42, { type: 'text', text: 'ok' }]);
			const result = parseLlmResponse(response);
			expect(result.blocks).toEqual([{ kind: 'text', text: 'ok' }]);
		});

		it('returns empty for JSON object without text or tools keys', () => {
			const response = JSON.stringify({ turn: 1, usage: { total: 100 } });
			const result = parseLlmResponse(response);
			expect(result).toEqual({ blocks: [], toolNames: [], textPreview: '' });
		});
	});
});

// Helper to extract inputSummary from first block
function result_inputSummary(result: ReturnType<typeof parseLlmResponse>): string {
	const block = result.blocks[0];
	if (block?.kind === 'tool_use') return block.inputSummary;
	return '';
}
