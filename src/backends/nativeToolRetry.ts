import type { LogWriter } from './types.js';

const RETRYABLE_ERROR_CODES = new Set(['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET']);
const RETRYABLE_MESSAGE_FRAGMENTS = [
	'fetch failed',
	'terminated',
	'aborted',
	'socket hang up',
	'econnreset',
	'und_err_',
] as const;

export interface NativeToolRetryOptions {
	logWriter: LogWriter;
	operation: string;
	retries?: number;
	minDelayMs?: number;
	maxDelayMs?: number;
	factor?: number;
	randomize?: boolean;
	isRetryable?: (error: Error) => boolean;
}

export interface RetryableTransportError extends Error {
	code?: string;
	cause?: unknown;
}

export function isRetryableNativeToolError(error: unknown): error is RetryableTransportError {
	if (!(error instanceof Error)) return false;

	const queue: unknown[] = [error];
	while (queue.length > 0) {
		const current = queue.shift();
		if (!(current instanceof Error)) continue;

		const code =
			'code' in current && typeof current.code === 'string'
				? current.code.toUpperCase()
				: undefined;
		if (code && RETRYABLE_ERROR_CODES.has(code)) {
			return true;
		}

		const message = current.message.toLowerCase();
		if (RETRYABLE_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment))) {
			return true;
		}

		if ('cause' in current && current.cause) {
			queue.push(current.cause);
		}
	}

	return false;
}

function computeDelayMs(
	attempt: number,
	options: Required<
		Pick<NativeToolRetryOptions, 'minDelayMs' | 'maxDelayMs' | 'factor' | 'randomize'>
	>,
): number {
	const baseDelay = Math.min(
		options.minDelayMs * options.factor ** (attempt - 1),
		options.maxDelayMs,
	);
	if (!options.randomize) return baseDelay;
	const jitter = 0.5 + Math.random();
	return Math.round(baseDelay * jitter);
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryAttempt(
	error: Error,
	attempt: number,
	retries: number,
	isRetryable: (error: Error) => boolean,
): { retryable: boolean; hasAttemptsRemaining: boolean } {
	const retryable = isRetryable(error);
	return {
		retryable,
		hasAttemptsRemaining: attempt <= retries,
	};
}

function logRetryExhausted(
	logWriter: LogWriter,
	operation: string,
	attempt: number,
	maxAttempts: number,
	retryable: boolean,
	error: Error,
): void {
	logWriter('ERROR', 'Native tool transport failed', {
		operation,
		attempt,
		maxAttempts,
		retryable,
		error: error.message,
	});
}

async function handleRetryFailure(
	error: Error,
	attempt: number,
	retries: number,
	options: NativeToolRetryOptions,
	isRetryable: (error: Error) => boolean,
	backoff: Required<
		Pick<NativeToolRetryOptions, 'minDelayMs' | 'maxDelayMs' | 'factor' | 'randomize'>
	>,
): Promise<void> {
	const { retryable, hasAttemptsRemaining } = shouldRetryAttempt(
		error,
		attempt,
		retries,
		isRetryable,
	);

	if (!retryable || !hasAttemptsRemaining) {
		logRetryExhausted(options.logWriter, options.operation, attempt, retries + 1, retryable, error);
		throw error;
	}

	const delayMs = computeDelayMs(attempt, backoff);
	options.logWriter('WARN', 'Retrying native tool transport operation', {
		operation: options.operation,
		attempt,
		maxAttempts: retries + 1,
		delayMs,
		error: error.message,
	});
	await sleep(delayMs);
}

export async function retryNativeToolOperation<T>(
	operationFn: () => Promise<T>,
	options: NativeToolRetryOptions,
): Promise<T> {
	const retries = options.retries ?? 3;
	const minDelayMs = options.minDelayMs ?? 500;
	const maxDelayMs = options.maxDelayMs ?? 5_000;
	const factor = options.factor ?? 2;
	const randomize = options.randomize ?? true;
	const isRetryable = options.isRetryable ?? isRetryableNativeToolError;
	const backoff = { minDelayMs, maxDelayMs, factor, randomize };

	for (let attempt = 1; ; attempt++) {
		try {
			return await operationFn();
		} catch (error) {
			const normalized = error instanceof Error ? error : new Error(String(error));
			await handleRetryFailure(normalized, attempt, retries, options, isRetryable, backoff);
		}
	}
}

export function formatNativeToolTransportError(prefix: string, error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return `${prefix}: ${message}`;
}
