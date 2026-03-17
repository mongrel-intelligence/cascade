import { describe, expect, it, vi } from 'vitest';

import { getRetryConfig } from '../../../src/config/retryConfig.js';

// Create a mock logger
const createMockLogger = () => ({
	warn: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	debug: vi.fn(),
	trace: vi.fn(),
});

describe.concurrent('config/retryConfig', () => {
	describe('getRetryConfig', () => {
		it('returns retry configuration with correct structure', () => {
			const logger = createMockLogger();
			const config = getRetryConfig(logger);

			expect(config).toEqual({
				enabled: true,
				retries: 5,
				minTimeout: 1000,
				maxTimeout: 60000,
				factor: 2,
				randomize: true,
				respectRetryAfter: true,
				maxRetryAfterMs: 120000,
				shouldRetry: expect.any(Function),
				onRetry: expect.any(Function),
				onRetriesExhausted: expect.any(Function),
			});
		});

		it('has aggressive retry settings for long-running agents', () => {
			const logger = createMockLogger();
			const config = getRetryConfig(logger);

			expect(config.retries).toBe(5);
			expect(config.minTimeout).toBe(1000);
			expect(config.maxTimeout).toBe(60000);
			expect(config.factor).toBe(2); // Exponential backoff
		});

		it('enables jitter to prevent thundering herd', () => {
			const logger = createMockLogger();
			const config = getRetryConfig(logger);

			expect(config.randomize).toBe(true);
		});

		it('respects Retry-After headers with cap', () => {
			const logger = createMockLogger();
			const config = getRetryConfig(logger);

			expect(config.respectRetryAfter).toBe(true);
			expect(config.maxRetryAfterMs).toBe(120000); // 2 minutes cap
		});
	});

	describe('shouldRetry', () => {
		it('returns true for rate limit errors (429)', () => {
			const logger = createMockLogger();
			const config = getRetryConfig(logger);

			const rateLimitError = new Error('Rate limit exceeded');
			Object.assign(rateLimitError, { status: 429 });

			expect(config.shouldRetry?.(rateLimitError)).toBe(true);
		});

		it('returns true for 5xx server errors', () => {
			const logger = createMockLogger();
			const config = getRetryConfig(logger);

			const serverError = new Error('Internal server error');
			Object.assign(serverError, { status: 500 });

			expect(config.shouldRetry?.(serverError)).toBe(true);
		});

		it('returns true for stream termination errors', () => {
			const logger = createMockLogger();
			const config = getRetryConfig(logger);

			const terminatedError = new Error('stream terminated');
			expect(config.shouldRetry?.(terminatedError)).toBe(true);

			const abortedError = new Error('request aborted');
			expect(config.shouldRetry?.(abortedError)).toBe(true);

			const hangUpError = new Error('socket hang up');
			expect(config.shouldRetry?.(hangUpError)).toBe(true);

			const fetchFailedError = new Error('fetch failed due to network error');
			expect(config.shouldRetry?.(fetchFailedError)).toBe(true);
		});

		it('returns true for stream errors case-insensitive', () => {
			const logger = createMockLogger();
			const config = getRetryConfig(logger);

			const upperCaseError = new Error('STREAM TERMINATED');
			expect(config.shouldRetry?.(upperCaseError)).toBe(true);

			const mixedCaseError = new Error('Fetch Failed');
			expect(config.shouldRetry?.(mixedCaseError)).toBe(true);
		});

		it('returns false for non-retryable errors (4xx except 429)', () => {
			const logger = createMockLogger();
			const config = getRetryConfig(logger);

			const badRequestError = new Error('Bad request');
			Object.assign(badRequestError, { status: 400 });

			expect(config.shouldRetry?.(badRequestError)).toBe(false);
		});

		it('returns false for authentication errors (401)', () => {
			const logger = createMockLogger();
			const config = getRetryConfig(logger);

			const authError = new Error('Unauthorized');
			Object.assign(authError, { status: 401 });

			expect(config.shouldRetry?.(authError)).toBe(false);
		});

		it('returns false for non-stream generic errors', () => {
			const logger = createMockLogger();
			const config = getRetryConfig(logger);

			const genericError = new Error('Something went wrong');
			expect(config.shouldRetry?.(genericError)).toBe(false);
		});
	});

	describe('onRetry callback', () => {
		it('logs retry attempts with attempt number', () => {
			const logger = createMockLogger();
			const config = getRetryConfig(logger);

			const error = new Error('Rate limit exceeded');
			config.onRetry?.(error, 2);

			expect(logger.warn).toHaveBeenCalledWith('LLM call retry', {
				attempt: 2,
				maxAttempts: 5,
				error: 'Rate limit exceeded',
				isStreamError: false,
				nextRetryDelayMs: expect.any(Number),
			});
		});

		it('calculates exponential backoff delay correctly', () => {
			const logger = createMockLogger();
			const config = getRetryConfig(logger);

			const error = new Error('Timeout');
			config.onRetry?.(error, 1);

			// Attempt 1: 1000 * 2^0 = 1000ms
			expect(logger.warn).toHaveBeenCalledWith(
				'LLM call retry',
				expect.objectContaining({ nextRetryDelayMs: 1000 }),
			);

			logger.warn.mockClear();
			config.onRetry?.(error, 2);

			// Attempt 2: 1000 * 2^1 = 2000ms
			expect(logger.warn).toHaveBeenCalledWith(
				'LLM call retry',
				expect.objectContaining({ nextRetryDelayMs: 2000 }),
			);

			logger.warn.mockClear();
			config.onRetry?.(error, 3);

			// Attempt 3: 1000 * 2^2 = 4000ms
			expect(logger.warn).toHaveBeenCalledWith(
				'LLM call retry',
				expect.objectContaining({ nextRetryDelayMs: 4000 }),
			);
		});

		it('caps delay at maxTimeout (60s)', () => {
			const logger = createMockLogger();
			const config = getRetryConfig(logger);

			const error = new Error('Timeout');
			config.onRetry?.(error, 10); // Very high attempt

			// Should be capped at 60000ms
			expect(logger.warn).toHaveBeenCalledWith(
				'LLM call retry',
				expect.objectContaining({ nextRetryDelayMs: 60000 }),
			);
		});

		it('flags stream termination errors correctly', () => {
			const logger = createMockLogger();
			const config = getRetryConfig(logger);

			const streamError = new Error('stream terminated');
			config.onRetry?.(streamError, 1);

			expect(logger.warn).toHaveBeenCalledWith(
				'LLM call retry',
				expect.objectContaining({ isStreamError: true }),
			);

			logger.warn.mockClear();

			const normalError = new Error('Rate limit');
			config.onRetry?.(normalError, 1);

			expect(logger.warn).toHaveBeenCalledWith(
				'LLM call retry',
				expect.objectContaining({ isStreamError: false }),
			);
		});
	});

	describe('onRetriesExhausted callback', () => {
		it('logs failure after all retries exhausted', () => {
			const logger = createMockLogger();
			const config = getRetryConfig(logger);

			const error = new Error('Persistent failure');
			config.onRetriesExhausted?.(error, 5);

			expect(logger.error).toHaveBeenCalledWith('LLM call failed after all retries exhausted', {
				attempts: 5,
				error: 'Persistent failure',
				totalWaitTimeMs: '~31000', // 1s + 2s + 4s + 8s + 16s
			});
		});

		it('includes total approximate wait time', () => {
			const logger = createMockLogger();
			const config = getRetryConfig(logger);

			const error = new Error('Failed');
			config.onRetriesExhausted?.(error, 5);

			const call = logger.error.mock.calls[0];
			expect(call[1]).toHaveProperty('totalWaitTimeMs');
			expect(call[1].totalWaitTimeMs).toBe('~31000');
		});
	});
});
