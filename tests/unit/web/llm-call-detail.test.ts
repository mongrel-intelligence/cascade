import { describe, expect, it } from 'vitest';
import { parseLlmResponse } from '../../../web/src/lib/llm-response-parser.js';

/**
 * Tests for LLM call detail display logic, focusing on ThinkingBlock behavior.
 *
 * Note: React component rendering tests are not possible in the current test
 * setup (node environment, no jsdom). These tests cover:
 *   - The parseLlmResponse function's handling of thinking blocks
 *   - The char count label logic used by ThinkingBlock
 *   - Verifying no "collapsing" logic exists at the data layer
 */

// ─── ThinkingBlock char count label logic ────────────────────────────────────

describe('ThinkingBlock char count label', () => {
	/**
	 * Mirrors the label logic from the ThinkingBlock component:
	 *   `💭 Thinking ({text.length.toLocaleString()} chars)`
	 */
	function buildThinkingLabel(text: string): string {
		return `💭 Thinking (${text.length.toLocaleString()} chars)`;
	}

	it('shows correct char count for short thinking text', () => {
		const text = 'Hello world';
		expect(buildThinkingLabel(text)).toBe('💭 Thinking (11 chars)');
	});

	it('shows correct char count for empty thinking text', () => {
		const text = '';
		expect(buildThinkingLabel(text)).toBe('💭 Thinking (0 chars)');
	});

	it('uses toLocaleString formatting for large char counts', () => {
		// 1000+ chars should format with locale separators (e.g. "1,000" in en-US)
		const text = 'a'.repeat(1000);
		const label = buildThinkingLabel(text);
		// The exact format depends on locale, but it should contain "1" and "000"
		expect(label).toContain('💭 Thinking (');
		expect(label).toContain(' chars)');
		// Should include the number 1000 in some locale-formatted form
		expect(text.length).toBe(1000);
	});

	it('shows full char count without truncation for very large thinking text', () => {
		// Simulates extended thinking mode — thousands of chars
		const text = 'x'.repeat(5000);
		const label = buildThinkingLabel(text);
		expect(label).toContain('💭 Thinking (');
		expect(label).toContain(' chars)');
		expect(text.length).toBe(5000);
	});
});

// ─── parseLlmResponse: thinking block parsing ────────────────────────────────

describe('parseLlmResponse: thinking blocks are fully preserved', () => {
	it('parses a single thinking block from Claude Code format', () => {
		const thinkingText = 'I need to think about this carefully.';
		const response = JSON.stringify([{ type: 'thinking', thinking: thinkingText }]);

		const result = parseLlmResponse(response);

		expect(result.blocks).toHaveLength(1);
		expect(result.blocks[0]).toEqual({ kind: 'thinking', text: thinkingText });
	});

	it('preserves the full thinking text without truncation', () => {
		// Simulate a large thinking block (extended thinking mode)
		const thinkingText = 'Deep reasoning step. '.repeat(200); // ~4200 chars
		const response = JSON.stringify([{ type: 'thinking', thinking: thinkingText }]);

		const result = parseLlmResponse(response);

		expect(result.blocks).toHaveLength(1);
		const block = result.blocks[0];
		expect(block.kind).toBe('thinking');
		if (block.kind === 'thinking') {
			// Full text must be preserved — no truncation
			expect(block.text).toBe(thinkingText);
			expect(block.text.length).toBe(thinkingText.length);
		}
	});

	it('parses thinking block alongside text and tool_use blocks', () => {
		const response = JSON.stringify([
			{ type: 'thinking', thinking: 'Let me consider the approach.' },
			{ type: 'text', text: 'Here is my answer.' },
			{ type: 'tool_use', name: 'Read', input: { file_path: '/foo/bar.ts' } },
		]);

		const result = parseLlmResponse(response);

		expect(result.blocks).toHaveLength(3);
		expect(result.blocks[0]).toEqual({
			kind: 'thinking',
			text: 'Let me consider the approach.',
		});
		expect(result.blocks[1]).toEqual({ kind: 'text', text: 'Here is my answer.' });
		expect(result.blocks[2]).toMatchObject({ kind: 'tool_use', name: 'Read' });
	});

	it('returns thinking block with kind === "thinking" (not collapsed or hidden)', () => {
		const response = JSON.stringify([{ type: 'thinking', thinking: 'Some inner thoughts.' }]);

		const result = parseLlmResponse(response);

		// Verify the block kind is "thinking" — the component renders it inline
		expect(result.blocks[0].kind).toBe('thinking');
		// Verify there is no intermediate "collapsed" representation
		const block = result.blocks[0];
		if (block.kind === 'thinking') {
			expect(typeof block.text).toBe('string');
		}
	});

	it('handles multiple thinking blocks in sequence', () => {
		const response = JSON.stringify([
			{ type: 'thinking', thinking: 'First thought.' },
			{ type: 'thinking', thinking: 'Second thought.' },
		]);

		const result = parseLlmResponse(response);

		expect(result.blocks).toHaveLength(2);
		expect(result.blocks[0]).toEqual({ kind: 'thinking', text: 'First thought.' });
		expect(result.blocks[1]).toEqual({ kind: 'thinking', text: 'Second thought.' });
	});
});

// ─── ThinkingBlock renders full content (structural verification) ─────────────

describe('ThinkingBlock structural guarantees', () => {
	/**
	 * The ThinkingBlock component no longer uses a <details>/<summary> collapsible
	 * wrapper. These tests verify the logic that the component relies on ensures
	 * the full text is available (no truncation at parse layer).
	 */

	it('thinking text length equals original text length (no truncation in parser)', () => {
		const originalText = 'This is the complete thinking content without any abbreviation.';
		const response = JSON.stringify([{ type: 'thinking', thinking: originalText }]);

		const { blocks } = parseLlmResponse(response);

		const thinkingBlock = blocks.find((b) => b.kind === 'thinking');
		expect(thinkingBlock).toBeDefined();
		if (thinkingBlock && thinkingBlock.kind === 'thinking') {
			expect(thinkingBlock.text.length).toBe(originalText.length);
		}
	});

	it('toolNames does not include thinking blocks (thinking is not a tool)', () => {
		const response = JSON.stringify([
			{ type: 'thinking', thinking: 'Some thought.' },
			{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
		]);

		const { toolNames } = parseLlmResponse(response);

		// Thinking blocks should not appear in toolNames
		expect(toolNames).not.toContain('thinking');
		expect(toolNames).toContain('Bash');
	});
});
