/**
 * AlertingIntegration — the category-specific interface all alerting integrations implement.
 *
 * Extends IntegrationModule with alerting-specific capabilities:
 * - `category` is narrowed to 'alerting'
 * - `getConfig()` retrieves the alerting provider config for a project
 */

import type { SentryIntegrationConfig } from '../sentry/integration.js';
import type { IntegrationModule } from './types.js';

/**
 * AlertingIntegration — extends IntegrationModule with alerting-specific capabilities.
 *
 * All alerting integrations (e.g. Sentry) must implement this interface.
 * The `category` is narrowed to 'alerting' to allow type-safe filtering.
 */
export interface AlertingIntegration extends IntegrationModule {
	/** Narrowed category — always 'alerting' for alerting integrations */
	readonly category: 'alerting';

	/**
	 * Get the alerting provider config for a project.
	 * Returns null if no alerting integration is configured.
	 *
	 * @param projectId - The project to retrieve config for
	 * @returns The alerting config or null if not configured
	 */
	getConfig(projectId: string): Promise<SentryIntegrationConfig | null>;
}
