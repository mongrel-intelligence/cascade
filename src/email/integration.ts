/**
 * Email integration — credential resolution and scoping via the registry.
 *
 * Delegates to the registered EmailIntegration for the project's configured
 * email provider. Adding a new provider requires only a new class + one registry
 * line in index.ts — no changes here.
 */

import { getIntegrationProvider } from '../db/repositories/credentialsRepository.js';
import { logger } from '../utils/logging.js';
import { emailRegistry } from './registry.js';

/**
 * Run a function with an EmailProvider in scope for the given project.
 *
 * If no email integration is configured (or the provider is unknown), runs
 * fn() without establishing a provider scope — gadgets will fail with a clear
 * error if they try to call getEmailProvider().
 */
export async function withEmailIntegration<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
	try {
		const providerType = await getIntegrationProvider(projectId, 'email');
		if (!providerType) return fn();
		const integration = emailRegistry.getOrNull(providerType);
		if (!integration) return fn();
		return integration.withCredentials(projectId, fn);
	} catch (error) {
		logger.warn('Failed to resolve email integration, running without email credentials', {
			projectId,
			error: error instanceof Error ? error.message : String(error),
		});
		return fn();
	}
}

/**
 * Check if email integration is configured and credentials are present.
 */
export async function hasEmailIntegration(projectId: string): Promise<boolean> {
	try {
		const providerType = await getIntegrationProvider(projectId, 'email');
		if (!providerType) return false;
		const integration = emailRegistry.getOrNull(providerType);
		if (!integration) return false;
		return integration.hasCredentials(projectId);
	} catch {
		return false;
	}
}
