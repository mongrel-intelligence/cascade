/**
 * Sentry alerting integration helpers.
 *
 * Provides typed access to the Sentry integration config stored in
 * project_integrations where category='alerting' and provider='sentry'.
 */

import { getIntegrationByProjectAndCategory } from '../db/repositories/integrationsRepository.js';

// ============================================================================
// Config interface
// ============================================================================

export interface SentryIntegrationConfig {
	/** Sentry organization slug (e.g. "my-company") */
	organizationSlug: string;
	/**
	 * PM container ID where the alerting agent creates investigation work items.
	 * Maps to the prompt creation container when no PM backlog is configured.
	 */
	resultsContainerId?: string;
}

// ============================================================================
// Config resolution
// ============================================================================

/**
 * Get the Sentry integration config for a project.
 * Returns null if no Sentry alerting integration is configured.
 */
export async function getSentryIntegrationConfig(
	projectId: string,
): Promise<SentryIntegrationConfig | null> {
	const row = await getIntegrationByProjectAndCategory(projectId, 'alerting');
	if (!row || row.provider !== 'sentry') return null;

	const config = row.config as Record<string, unknown> | null;
	if (!config?.organizationSlug || typeof config.organizationSlug !== 'string') return null;

	return {
		organizationSlug: config.organizationSlug,
		...(typeof config.resultsContainerId === 'string'
			? { resultsContainerId: config.resultsContainerId }
			: {}),
	};
}
