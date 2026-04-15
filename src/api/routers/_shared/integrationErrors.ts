import { TRPCError } from '@trpc/server';
import { logger } from '../../../utils/logging.js';

/**
 * Wraps an async callback in a try/catch that converts errors to TRPCError
 * with code 'BAD_REQUEST'. Re-throws existing TRPCErrors unchanged.
 *
 * Eliminates the repeated error-handling boilerplate across all
 * integrationsDiscovery handlers.
 */
export async function wrapIntegrationCall<T>(label: string, fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof TRPCError) throw err;
		const message = err instanceof Error ? err.message : String(err);
		logger.error(label, { error: message });
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `${label}: ${message}`,
		});
	}
}
