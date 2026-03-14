import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	formatNativeToolTransportError,
	isRetryableNativeToolError,
	retryNativeToolOperation,
} from '../../../src/backends/nativeToolRetry.js';

describe('nativeToolRetry', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('classifies fetch and socket errors as retryable', () => {
		expect(isRetryableNativeToolError(new TypeError('fetch failed'))).toBe(true);
		expect(isRetryableNativeToolError(new Error('socket hang up'))).toBe(true);

		const error = new Error('request failed') as Error & { cause?: unknown };
		error.cause = Object.assign(new Error('terminated'), { code: 'ECONNRESET' });
		expect(isRetryableNativeToolError(error)).toBe(true);
	});

	it('does not classify unrelated errors as retryable', () => {
		expect(isRetryableNativeToolError(new Error('bad auth'))).toBe(false);
	});

	it('retries retryable operations until success', async () => {
		vi.useFakeTimers();
		const logWriter = vi.fn();
		const operation = vi
			.fn()
			.mockRejectedValueOnce(new TypeError('fetch failed'))
			.mockResolvedValue('ok');

		const resultPromise = retryNativeToolOperation(operation, {
			logWriter,
			operation: 'test.operation',
		});
		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result).toBe('ok');
		expect(operation).toHaveBeenCalledTimes(2);
		expect(logWriter).toHaveBeenCalledWith(
			'WARN',
			'Retrying native tool transport operation',
			expect.objectContaining({ operation: 'test.operation', attempt: 1 }),
		);
	});

	it('throws after retries are exhausted', async () => {
		vi.useFakeTimers();
		const logWriter = vi.fn();
		const operation = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

		const resultPromise = retryNativeToolOperation(operation, {
			logWriter,
			operation: 'test.operation',
			retries: 1,
		});
		const assertion = expect(resultPromise).rejects.toThrow('fetch failed');
		await vi.runAllTimersAsync();
		await assertion;
		expect(operation).toHaveBeenCalledTimes(2);
		expect(logWriter).toHaveBeenCalledWith(
			'ERROR',
			'Native tool transport failed',
			expect.objectContaining({ operation: 'test.operation', retryable: true }),
		);
	});

	it('formats normalized transport errors', () => {
		expect(
			formatNativeToolTransportError(
				'OpenCode transport failed after retries',
				new Error('fetch failed'),
			),
		).toBe('OpenCode transport failed after retries: fetch failed');
	});
});
