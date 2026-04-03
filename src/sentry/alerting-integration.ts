/**
 * SentryAlertingIntegration — implements AlertingIntegration for Sentry.
 *
 * Encapsulates Sentry alerting credential resolution and validation
 * into a unified integration class following the IntegrationModule pattern.
 *
 * Inlines the hasIntegration logic directly (calls getSentryIntegrationConfig)
 * rather than delegating to the now-deleted hasAlertingIntegration() standalone function.
 */

import { getIntegrationCredential } from '../config/provider.js';
import type { AlertingIntegration } from '../integrations/alerting.js';
import { getSentryIntegrationConfig, type SentryIntegrationConfig } from './integration.js';

export class SentryAlertingIntegration implements AlertingIntegration {
	readonly type = 'sentry';
	readonly category = 'alerting' as const;

	/**
	 * Check if Sentry alerting integration is configured for a project.
	 * Returns true if getSentryIntegrationConfig returns a valid config.
	 */
	async hasIntegration(projectId: string): Promise<boolean> {
		const config = await getSentryIntegrationConfig(projectId);
		return config !== null;
	}

	/**
	 * Get the Sentry integration config for a project.
	 */
	async getConfig(projectId: string): Promise<SentryIntegrationConfig | null> {
		return getSentryIntegrationConfig(projectId);
	}

	/**
	 * Resolve SENTRY_API_TOKEN from credentials and run `fn` within that
	 * credential scope. Sets process.env.SENTRY_API_TOKEN before calling fn
	 * and restores the previous value afterwards.
	 */
	async withCredentials<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
		const token = await getIntegrationCredential(projectId, 'alerting', 'api_token');
		const previous = process.env.SENTRY_API_TOKEN;
		process.env.SENTRY_API_TOKEN = token;
		try {
			return await fn();
		} finally {
			if (previous === undefined) {
				process.env.SENTRY_API_TOKEN = undefined;
			} else {
				process.env.SENTRY_API_TOKEN = previous;
			}
		}
	}
}
