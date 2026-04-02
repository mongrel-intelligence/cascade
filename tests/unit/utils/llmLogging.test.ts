import { describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
	default: {
		mkdirSync: vi.fn(),
		writeFileSync: vi.fn(),
		readdirSync: vi.fn(),
	},
}));

vi.mock('llmist', () => ({
	extractMessageText: vi.fn((content: unknown) => {
		if (typeof content === 'string') return content;
		return JSON.stringify(content);
	}),
}));

import fs from 'node:fs';
import {
	createLLMCallLogger,
	formatCallNumber,
	formatLlmRequest,
} from '../../../src/utils/llmLogging.js';

describe('llmLogging', () => {
	describe('formatCallNumber', () => {
		it('pads single digit', () => {
			expect(formatCallNumber(1)).toBe('0001');
		});

		it('pads double digit', () => {
			expect(formatCallNumber(42)).toBe('0042');
		});

		it('pads triple digit', () => {
			expect(formatCallNumber(123)).toBe('0123');
		});

		it('does not pad 4+ digits', () => {
			expect(formatCallNumber(9999)).toBe('9999');
			expect(formatCallNumber(10000)).toBe('10000');
		});
	});

	describe('formatLlmRequest', () => {
		it('formats messages with role headers', () => {
			const messages = [
				{ role: 'system', content: 'You are helpful' },
				{ role: 'user', content: 'Hello' },
			];

			const result = formatLlmRequest(messages);

			expect(result).toContain('=== SYSTEM ===');
			expect(result).toContain('You are helpful');
			expect(result).toContain('=== USER ===');
			expect(result).toContain('Hello');
		});

		it('handles undefined content', () => {
			const messages = [{ role: 'user', content: undefined }];

			const result = formatLlmRequest(messages);

			expect(result).toContain('=== USER ===');
			// Should not throw
		});

		it('handles empty messages array', () => {
			const result = formatLlmRequest([]);
			expect(result).toBe('');
		});
	});

	describe('createLLMCallLogger', () => {
		it('creates log directory', () => {
			createLLMCallLogger('/tmp/base', 'test-agent');

			expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('test-agent-llm-calls'), {
				recursive: true,
			});
		});

		it('logRequest writes request file', () => {
			const logger = createLLMCallLogger('/tmp/base', 'agent');

			logger.logRequest(1, [{ role: 'user', content: 'test' }]);

			expect(fs.writeFileSync).toHaveBeenCalledWith(
				expect.stringContaining('0001.request'),
				expect.any(String),
				'utf-8',
			);
		});

		it('logResponse writes response file', () => {
			const logger = createLLMCallLogger('/tmp/base', 'agent');

			logger.logResponse(1, 'Response text');

			expect(fs.writeFileSync).toHaveBeenCalledWith(
				expect.stringContaining('0001.response'),
				'Response text',
				'utf-8',
			);
		});

		it('getLogFiles returns file paths', () => {
			vi.mocked(fs.readdirSync).mockReturnValue([
				'0001.request',
				'0001.response',
			] as unknown as ReturnType<typeof fs.readdirSync>);

			const logger = createLLMCallLogger('/tmp/base', 'agent');
			const files = logger.getLogFiles();

			expect(files).toHaveLength(2);
			expect(files[0]).toContain('0001.request');
		});

		it('getLogFiles returns empty array on error', () => {
			vi.mocked(fs.readdirSync).mockImplementation(() => {
				throw new Error('ENOENT');
			});

			const logger = createLLMCallLogger('/tmp/base', 'agent');
			const files = logger.getLogFiles();

			expect(files).toEqual([]);
		});

		it('exposes logDir', () => {
			const logger = createLLMCallLogger('/tmp/base', 'agent');

			expect(logger.logDir).toContain('agent-llm-calls');
		});
	});
});
