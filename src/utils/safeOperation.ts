import { logger } from './logging.js';

/**
 * Wraps an async operation with error handling that logs warnings instead of throwing.
 * Returns undefined if the operation fails.
 */
export async function safeOperation<T>(
	operation: () => Promise<T>,
	context: { action: string; [key: string]: unknown },
): Promise<T | undefined> {
	try {
		return await operation();
	} catch (err) {
		logger.warn(`Failed to ${context.action}`, { error: String(err), ...context });
		return undefined;
	}
}

/**
 * Wraps an async operation with silent error handling (no logging).
 * Returns undefined if the operation fails.
 */
export async function silentOperation<T>(operation: () => Promise<T>): Promise<T | undefined> {
	try {
		return await operation();
	} catch {
		return undefined;
	}
}
