/**
 * SMS integration — credential resolution and scoping via the registry.
 *
 * Delegates to the registered SmsIntegration for the project's configured
 * SMS provider. Adding a new provider requires only a new class + one registry
 * line in index.ts — no changes here.
 */

import { getIntegrationProvider } from '../db/repositories/credentialsRepository.js';
import { logger } from '../utils/logging.js';
import { smsRegistry } from './registry.js';

/**
 * Run a function with an SmsProvider in scope for the given project.
 *
 * If no SMS integration is configured (or the provider is unknown), runs
 * fn() without establishing a provider scope — gadgets will fail with a clear
 * error if they try to call getSmsProvider().
 */
export async function withSmsIntegration<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
	try {
		const providerType = await getIntegrationProvider(projectId, 'sms');
		if (!providerType) return fn();
		const integration = smsRegistry.getOrNull(providerType);
		if (!integration) return fn();
		return integration.withCredentials(projectId, fn);
	} catch (error) {
		logger.warn('Failed to resolve SMS integration, running without SMS credentials', {
			projectId,
			error: error instanceof Error ? error.message : String(error),
		});
		return fn();
	}
}

/**
 * Check if SMS integration is configured and credentials are present.
 */
export async function hasSmsIntegration(projectId: string): Promise<boolean> {
	try {
		const providerType = await getIntegrationProvider(projectId, 'sms');
		if (!providerType) return false;
		const integration = smsRegistry.getOrNull(providerType);
		if (!integration) return false;
		return integration.hasCredentials(projectId);
	} catch {
		return false;
	}
}
