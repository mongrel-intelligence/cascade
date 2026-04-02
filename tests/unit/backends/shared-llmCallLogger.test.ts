import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LlmCallLogPayload } from '../../../src/backends/shared/llmCallLogger.js';
import { logLlmCall } from '../../../src/backends/shared/llmCallLogger.js';

// Mock the DB repository
vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	storeLlmCall: vi.fn(),
}));

// Mock the logger
vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		warn: vi.fn(),
	},
}));

import { storeLlmCall } from '../../../src/db/repositories/runsRepository.js';
import { logger } from '../../../src/utils/logging.js';

describe('logLlmCall (shared helper)', () => {
	const mockStoreLlmCall = vi.mocked(storeLlmCall);
	const mockLoggerWarn = vi.mocked(logger.warn);

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('guard on runId', () => {
		it('is a no-op when runId is undefined', () => {
			const payload: LlmCallLogPayload = {
				runId: undefined,
				callNumber: 1,
				model: 'claude-sonnet-4-5',
				engineLabel: 'Claude Code',
			};

			logLlmCall(payload);

			expect(mockStoreLlmCall).not.toHaveBeenCalled();
		});

		it('is a no-op when runId is an empty string', () => {
			const payload: LlmCallLogPayload = {
				runId: '',
				callNumber: 1,
				model: 'gpt-4o',
				engineLabel: 'Codex',
			};

			logLlmCall(payload);

			expect(mockStoreLlmCall).not.toHaveBeenCalled();
		});
	});

	describe('fire-and-forget behavior', () => {
		it('calls storeLlmCall with the expected fields when runId is present', async () => {
			mockStoreLlmCall.mockResolvedValueOnce(undefined);

			const payload: LlmCallLogPayload = {
				runId: 'run-abc-123',
				callNumber: 3,
				model: 'claude-sonnet-4-5',
				inputTokens: 500,
				outputTokens: 200,
				cachedTokens: undefined,
				costUsd: undefined,
				response: '["text block"]',
				engineLabel: 'Claude Code',
			};

			logLlmCall(payload);

			// Give the microtask queue time to settle
			await Promise.resolve();

			expect(mockStoreLlmCall).toHaveBeenCalledOnce();
			expect(mockStoreLlmCall).toHaveBeenCalledWith({
				runId: 'run-abc-123',
				callNumber: 3,
				request: undefined,
				response: '["text block"]',
				inputTokens: 500,
				outputTokens: 200,
				cachedTokens: undefined,
				costUsd: undefined,
				durationMs: undefined,
				model: 'claude-sonnet-4-5',
			});
		});

		it('passes cachedTokens and costUsd from OpenCode-style payloads', async () => {
			mockStoreLlmCall.mockResolvedValueOnce(undefined);

			const payload: LlmCallLogPayload = {
				runId: 'run-opencode-1',
				callNumber: 2,
				model: 'anthropic/claude-opus-4-5',
				inputTokens: 1000,
				outputTokens: 300,
				cachedTokens: 400,
				costUsd: 0.0045,
				response: '{"type":"step-finish"}',
				engineLabel: 'OpenCode',
			};

			logLlmCall(payload);

			await Promise.resolve();

			expect(mockStoreLlmCall).toHaveBeenCalledWith(
				expect.objectContaining({
					runId: 'run-opencode-1',
					cachedTokens: 400,
					costUsd: 0.0045,
				}),
			);
		});

		it('passes costUsd from Codex-style payloads', async () => {
			mockStoreLlmCall.mockResolvedValueOnce(undefined);

			const payload: LlmCallLogPayload = {
				runId: 'run-codex-1',
				callNumber: 5,
				model: 'codex-mini-latest',
				inputTokens: 800,
				outputTokens: 150,
				cachedTokens: 200,
				costUsd: 0.002,
				response: '{"total_cost_usd":0.002}',
				engineLabel: 'Codex',
			};

			logLlmCall(payload);

			await Promise.resolve();

			expect(mockStoreLlmCall).toHaveBeenCalledWith(
				expect.objectContaining({
					costUsd: 0.002,
					cachedTokens: 200,
				}),
			);
		});

		it('always passes request as undefined', async () => {
			mockStoreLlmCall.mockResolvedValueOnce(undefined);

			logLlmCall({
				runId: 'run-42',
				callNumber: 1,
				model: 'some-model',
				engineLabel: 'Test',
			});

			await Promise.resolve();

			expect(mockStoreLlmCall).toHaveBeenCalledWith(
				expect.objectContaining({ request: undefined }),
			);
		});
	});

	describe('error catch logging', () => {
		it('logs a warning with the engine label when storeLlmCall rejects', async () => {
			const storageError = new Error('DB connection failed');
			mockStoreLlmCall.mockRejectedValueOnce(storageError);

			logLlmCall({
				runId: 'run-err-1',
				callNumber: 7,
				model: 'claude-haiku',
				engineLabel: 'Claude Code',
			});

			// Let the rejection propagate through the microtask queue
			await Promise.resolve();
			await Promise.resolve();

			expect(mockLoggerWarn).toHaveBeenCalledOnce();
			expect(mockLoggerWarn).toHaveBeenCalledWith(
				'Failed to store Claude Code LLM call in real-time',
				expect.objectContaining({
					runId: 'run-err-1',
					call: 7,
					error: 'Error: DB connection failed',
				}),
			);
		});

		it('includes the engine label in the warning message for each engine', async () => {
			for (const engineLabel of ['Claude Code', 'Codex', 'OpenCode']) {
				mockStoreLlmCall.mockRejectedValueOnce(new Error('fail'));

				logLlmCall({
					runId: 'run-label-test',
					callNumber: 1,
					model: 'model',
					engineLabel,
				});

				await Promise.resolve();
				await Promise.resolve();
			}

			expect(mockLoggerWarn).toHaveBeenCalledTimes(3);
			expect(mockLoggerWarn.mock.calls[0][0]).toContain('Claude Code');
			expect(mockLoggerWarn.mock.calls[1][0]).toContain('Codex');
			expect(mockLoggerWarn.mock.calls[2][0]).toContain('OpenCode');
		});

		it('does not throw even when storeLlmCall rejects', () => {
			mockStoreLlmCall.mockRejectedValueOnce(new Error('boom'));

			expect(() => {
				logLlmCall({
					runId: 'run-no-throw',
					callNumber: 1,
					model: 'model',
					engineLabel: 'Test',
				});
			}).not.toThrow();
		});
	});
});
