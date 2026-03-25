import { describe, expect, it } from 'vitest';

import {
	extractDeltaText,
	extractItemText,
	extractTextFromContentParts,
	parseCodexEvent,
	parseFunctionCallItem,
	resolveUsageRecord,
} from '../../../src/backends/codex/jsonlParser.js';

// ─── extractTextFromContentParts ────────────────────────────────────────────

describe('extractTextFromContentParts', () => {
	it('returns empty array for non-array input', () => {
		expect(extractTextFromContentParts(null)).toEqual([]);
		expect(extractTextFromContentParts(undefined)).toEqual([]);
		expect(extractTextFromContentParts('hello')).toEqual([]);
		expect(extractTextFromContentParts({ type: 'text', text: 'hi' })).toEqual([]);
	});

	it('extracts text from plain string items', () => {
		expect(extractTextFromContentParts(['hello', 'world'])).toEqual(['hello', 'world']);
	});

	it('skips empty/whitespace-only plain strings', () => {
		expect(extractTextFromContentParts(['', '   ', 'valid'])).toEqual(['valid']);
	});

	it('extracts text from {type:"text", text:"..."} objects', () => {
		const content = [
			{ type: 'text', text: 'Planning step 1.' },
			{ type: 'text', text: 'Planning step 2.' },
		];
		expect(extractTextFromContentParts(content)).toEqual(['Planning step 1.', 'Planning step 2.']);
	});

	it('ignores items with non-text type even if they have a text field', () => {
		const content = [
			{ type: 'image', text: 'should be ignored' },
			{ type: 'text', text: 'should be included' },
		];
		expect(extractTextFromContentParts(content)).toEqual(['should be included']);
	});

	it('handles mixed array of strings and text objects', () => {
		const content = [
			'plain string',
			{ type: 'text', text: 'object text' },
			{ type: 'image', url: 'http://example.com/img.png' },
		];
		expect(extractTextFromContentParts(content)).toEqual(['plain string', 'object text']);
	});

	it('skips null and non-object items', () => {
		const content = [null, undefined, 42, { type: 'text', text: 'valid' }];
		expect(extractTextFromContentParts(content)).toEqual(['valid']);
	});

	it('skips text objects with empty/whitespace text', () => {
		const content = [
			{ type: 'text', text: '' },
			{ type: 'text', text: '   ' },
			{ type: 'text', text: 'non-empty' },
		];
		expect(extractTextFromContentParts(content)).toEqual(['non-empty']);
	});

	it('handles objects with no type field as text items', () => {
		// No 'type' field means it passes the type check (type !== 'text' is false)
		const content = [{ text: 'has no type field' }];
		expect(extractTextFromContentParts(content)).toEqual(['has no type field']);
	});
});

// ─── extractItemText ─────────────────────────────────────────────────────────

describe('extractItemText', () => {
	it('returns empty array for null or non-object input', () => {
		expect(extractItemText(null)).toEqual([]);
		expect(extractItemText(undefined)).toEqual([]);
		expect(extractItemText('string')).toEqual([]);
		expect(extractItemText(42)).toEqual([]);
	});

	it('extracts text from agent_message item with text field', () => {
		expect(extractItemText({ type: 'agent_message', text: 'Agent reply.' })).toEqual([
			'Agent reply.',
		]);
	});

	it('returns empty for agent_message with empty text', () => {
		expect(extractItemText({ type: 'agent_message', text: '' })).toEqual([]);
		expect(extractItemText({ type: 'agent_message', text: '   ' })).toEqual([]);
	});

	it('extracts text from message item with content array', () => {
		const item = {
			type: 'message',
			content: [{ type: 'text', text: 'Content text.' }],
		};
		expect(extractItemText(item)).toEqual(['Content text.']);
	});

	it('returns empty for message item with no content', () => {
		expect(extractItemText({ type: 'message' })).toEqual([]);
	});

	it('returns empty for command_execution item (no text field, no content)', () => {
		const item = {
			type: 'command_execution',
			command: 'ls -la',
			status: 'completed',
		};
		expect(extractItemText(item)).toEqual([]);
	});

	it('returns empty for function_call item (no text field, no content)', () => {
		const item = {
			type: 'function_call',
			name: 'bash',
			arguments: '{"command":"ls"}',
		};
		expect(extractItemText(item)).toEqual([]);
	});
});

// ─── extractDeltaText ────────────────────────────────────────────────────────

describe('extractDeltaText', () => {
	it('extracts plain string delta', () => {
		expect(extractDeltaText('streamed chunk')).toEqual(['streamed chunk']);
	});

	it('returns empty for empty string delta', () => {
		expect(extractDeltaText('')).toEqual([]);
		expect(extractDeltaText('   ')).toEqual([]);
	});

	it('extracts text from text_delta object', () => {
		expect(extractDeltaText({ type: 'text_delta', text: 'Step 1:' })).toEqual(['Step 1:']);
	});

	it('returns empty for text_delta object with empty text', () => {
		expect(extractDeltaText({ type: 'text_delta', text: '' })).toEqual([]);
		expect(extractDeltaText({ type: 'text_delta', text: '  ' })).toEqual([]);
	});

	it('returns empty for null and undefined', () => {
		expect(extractDeltaText(null)).toEqual([]);
		expect(extractDeltaText(undefined)).toEqual([]);
	});

	it('returns empty for delta object with no text field', () => {
		expect(extractDeltaText({ type: 'input_json_delta', partial_json: '{"key":' })).toEqual([]);
	});

	it('returns empty for array input (not a plain object or string)', () => {
		expect(extractDeltaText(['text'])).toEqual([]);
	});
});

// ─── parseFunctionCallItem ───────────────────────────────────────────────────

describe('parseFunctionCallItem', () => {
	it('returns null for null or non-object input', () => {
		expect(parseFunctionCallItem(null)).toBeNull();
		expect(parseFunctionCallItem(undefined)).toBeNull();
		expect(parseFunctionCallItem('string')).toBeNull();
		expect(parseFunctionCallItem(42)).toBeNull();
	});

	it('parses function_call item with string arguments', () => {
		const item = { type: 'function_call', name: 'bash', arguments: '{"command":"ls -la"}' };
		expect(parseFunctionCallItem(item)).toEqual({ name: 'bash', input: { command: 'ls -la' } });
	});

	it('handles malformed JSON arguments gracefully (returns tool call without input)', () => {
		const item = { type: 'function_call', name: 'bash', arguments: '{invalid-json' };
		expect(parseFunctionCallItem(item)).toEqual({ name: 'bash', input: undefined });
	});

	it('handles function_call item with no arguments', () => {
		const item = { type: 'function_call', name: 'finish' };
		expect(parseFunctionCallItem(item)).toEqual({ name: 'finish', input: undefined });
	});

	it('handles function_call item with object arguments (not string)', () => {
		const item = { type: 'function_call', name: 'bash', arguments: { command: 'pwd' } };
		expect(parseFunctionCallItem(item)).toEqual({ name: 'bash', input: { command: 'pwd' } });
	});

	it('parses command_execution item as bash tool call', () => {
		const item = { type: 'command_execution', command: 'git status', status: 'completed' };
		expect(parseFunctionCallItem(item)).toEqual({ name: 'bash', input: { command: 'git status' } });
	});

	it('returns null for command_execution without command string', () => {
		expect(parseFunctionCallItem({ type: 'command_execution' })).toBeNull();
		expect(parseFunctionCallItem({ type: 'command_execution', command: 42 })).toBeNull();
	});

	it('returns null for non-function_call item types', () => {
		expect(parseFunctionCallItem({ type: 'message', content: [] })).toBeNull();
		expect(parseFunctionCallItem({ type: 'agent_message', text: 'hi' })).toBeNull();
	});

	it('returns null for function_call with empty name', () => {
		expect(parseFunctionCallItem({ type: 'function_call', name: '' })).toBeNull();
		expect(parseFunctionCallItem({ type: 'function_call', name: null })).toBeNull();
	});

	it('handles complex nested arguments', () => {
		const item = {
			type: 'function_call',
			name: 'FileSearchAndReplace',
			arguments: JSON.stringify({ file_path: '/src/app.ts', old_string: 'foo', new_string: 'bar' }),
		};
		expect(parseFunctionCallItem(item)).toEqual({
			name: 'FileSearchAndReplace',
			input: { file_path: '/src/app.ts', old_string: 'foo', new_string: 'bar' },
		});
	});
});

// ─── resolveUsageRecord ──────────────────────────────────────────────────────

describe('resolveUsageRecord', () => {
	it('returns usage object from flat event.usage', () => {
		const event = { usage: { input_tokens: 100, output_tokens: 50 } };
		expect(resolveUsageRecord(event)).toEqual({ input_tokens: 100, output_tokens: 50 });
	});

	it('returns token_usage object from flat event.token_usage', () => {
		const event = { token_usage: { inputTokens: 200, outputTokens: 80 } };
		expect(resolveUsageRecord(event)).toEqual({ inputTokens: 200, outputTokens: 80 });
	});

	it('returns nested response.usage for Responses API events', () => {
		const event = {
			type: 'response.completed',
			response: { usage: { input_tokens: 42, output_tokens: 17 } },
		};
		expect(resolveUsageRecord(event)).toEqual({ input_tokens: 42, output_tokens: 17 });
	});

	it('returns undefined when no usage-related fields present', () => {
		expect(resolveUsageRecord({ type: 'item.started' })).toBeUndefined();
		expect(resolveUsageRecord({ type: 'turn.started' })).toBeUndefined();
		expect(resolveUsageRecord({})).toBeUndefined();
	});

	it('prefers flat event.usage over nested response.usage', () => {
		const event = {
			usage: { input_tokens: 10, output_tokens: 5 },
			response: { usage: { input_tokens: 999, output_tokens: 999 } },
		};
		expect(resolveUsageRecord(event)).toEqual({ input_tokens: 10, output_tokens: 5 });
	});

	it('returns undefined when response exists but has no usage field', () => {
		const event = { response: { id: 'resp_001', status: 'completed' } };
		expect(resolveUsageRecord(event)).toBeUndefined();
	});

	it('returns undefined when response.usage is not an object', () => {
		const event = { response: { usage: 'not-an-object' } };
		expect(resolveUsageRecord(event)).toBeUndefined();
	});
});

// ─── parseCodexEvent ─────────────────────────────────────────────────────────

describe('parseCodexEvent', () => {
	it('parses a complete text event correctly', () => {
		const result = parseCodexEvent({ type: 'text', text: 'Hello, world!' });
		expect(result.textParts).toContain('Hello, world!');
		expect(result.toolCall).toBeNull();
		expect(result.usage).toBeNull();
		expect(result.error).toBeUndefined();
	});

	it('parses a tool_use event correctly', () => {
		const result = parseCodexEvent({ type: 'tool_use', name: 'bash', input: { cmd: 'ls' } });
		expect(result.toolCall).toEqual({ name: 'bash', input: { cmd: 'ls' } });
		expect(result.textParts).toEqual([]);
		expect(result.usage).toBeNull();
		expect(result.error).toBeUndefined();
	});

	it('parses a turn.completed event with usage', () => {
		const result = parseCodexEvent({
			type: 'turn.completed',
			usage: { input_tokens: 100, output_tokens: 50, cached_input_tokens: 80 },
		});
		expect(result.usage).toEqual({
			inputTokens: 100,
			outputTokens: 50,
			cachedTokens: 80,
			costUsd: undefined,
		});
		expect(result.textParts).toEqual([]);
		expect(result.toolCall).toBeNull();
		expect(result.error).toBeUndefined();
	});

	it('parses a response.completed event with nested usage', () => {
		const result = parseCodexEvent({
			type: 'response.completed',
			response: { usage: { input_tokens: 42, output_tokens: 7 } },
		});
		expect(result.usage).toEqual({
			inputTokens: 42,
			outputTokens: 7,
			cachedTokens: undefined,
			costUsd: undefined,
		});
	});

	it('parses an item.completed agent_message event', () => {
		const result = parseCodexEvent({
			type: 'item.completed',
			item: { type: 'agent_message', text: 'Here is my plan.' },
		});
		expect(result.textParts).toContain('Here is my plan.');
		expect(result.toolCall).toBeNull();
	});

	it('parses an item.completed function_call event with string arguments', () => {
		const result = parseCodexEvent({
			type: 'item.completed',
			item: { type: 'function_call', name: 'bash', arguments: '{"command":"ls -la"}' },
		});
		expect(result.toolCall).toEqual({ name: 'bash', input: { command: 'ls -la' } });
		expect(result.textParts).toEqual([]);
	});

	it('handles item.completed function_call with malformed JSON arguments', () => {
		const result = parseCodexEvent({
			type: 'item.completed',
			item: { type: 'function_call', name: 'bash', arguments: '{bad json' },
		});
		expect(result.toolCall).toEqual({ name: 'bash', input: undefined });
		expect(result.error).toBeUndefined();
	});

	it('parses a command_execution item as bash tool call', () => {
		const result = parseCodexEvent({
			type: 'item.completed',
			item: { type: 'command_execution', command: 'git diff HEAD', status: 'completed' },
		});
		expect(result.toolCall).toEqual({ name: 'bash', input: { command: 'git diff HEAD' } });
	});

	it('parses an item.delta text delta event', () => {
		const result = parseCodexEvent({
			type: 'item.delta',
			delta: { type: 'text_delta', text: 'partial text' },
		});
		expect(result.textParts).toContain('partial text');
		expect(result.toolCall).toBeNull();
	});

	it('parses a string error field', () => {
		const result = parseCodexEvent({ type: 'error', error: 'something failed' });
		expect(result.error).toBe('something failed');
	});

	it('parses an error event with top-level message', () => {
		const result = parseCodexEvent({ type: 'error', message: 'Reconnecting...' });
		expect(result.error).toBe('Reconnecting...');
	});

	it('parses a turn.failed event with object error', () => {
		const result = parseCodexEvent({
			type: 'turn.failed',
			error: { message: 'unexpected status 401 Unauthorized' },
		});
		expect(result.error).toBe('unexpected status 401 Unauthorized');
	});

	it('returns empty textParts and null toolCall for unrecognized event', () => {
		const result = parseCodexEvent({ type: 'thinking', metadata: { id: 'rs_001' } });
		expect(result.textParts).toEqual([]);
		expect(result.toolCall).toBeNull();
		expect(result.usage).toBeNull();
		expect(result.error).toBeUndefined();
	});

	it('handles event with mixed content array', () => {
		const result = parseCodexEvent({
			type: 'item.completed',
			item: {
				type: 'message',
				content: [
					{ type: 'text', text: 'First part.' },
					{ type: 'image', url: 'http://example.com/img.png' },
					{ type: 'text', text: 'Second part.' },
				],
			},
		});
		expect(result.textParts).toEqual(['First part.', 'Second part.']);
		expect(result.toolCall).toBeNull();
	});

	it('parses event with total_cost_usd', () => {
		const result = parseCodexEvent({
			usage: { input_tokens: 10, output_tokens: 5 },
			total_cost_usd: 0.0042,
		});
		expect(result.usage).toEqual({
			inputTokens: 10,
			outputTokens: 5,
			cachedTokens: undefined,
			costUsd: 0.0042,
		});
	});

	it('parses event with camelCase usage fields (inputTokens/outputTokens)', () => {
		const result = parseCodexEvent({
			token_usage: { inputTokens: 200, outputTokens: 80 },
		});
		expect(result.usage).toEqual({
			inputTokens: 200,
			outputTokens: 80,
			cachedTokens: undefined,
			costUsd: undefined,
		});
	});
});
