/**
 * Shared Redis utility functions.
 *
 * Provides a single implementation of Redis URL parsing used by BullMQ
 * consumers across the codebase (router queues, dashboard queue, worker manager).
 */

import type { ConnectionOptions } from 'bullmq';

/**
 * Parse a Redis URL string into BullMQ ConnectionOptions.
 */
export function parseRedisUrl(url: string): ConnectionOptions {
	const parsed = new URL(url);
	return {
		host: parsed.hostname,
		port: Number(parsed.port) || 6379,
		password: parsed.password || undefined,
	};
}
