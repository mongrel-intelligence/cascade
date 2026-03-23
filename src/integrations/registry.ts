/**
 * IntegrationRegistry — singleton that holds all registered integration modules.
 *
 * Populated at import time by each integration module. Infrastructure
 * (router, worker, webhook handler) uses `integrationRegistry.get(type)` to
 * obtain the integration instance without provider-specific branching.
 *
 * Supports lookup by both provider type and integration category.
 */

import type { IntegrationCategory } from '../config/integrationRoles.js';
import type { IntegrationModule } from './types.js';

export class IntegrationRegistry {
	private integrations = new Map<string, IntegrationModule>();

	/**
	 * Register an integration module.
	 * Throws if an integration with the same type is already registered.
	 */
	register(integration: IntegrationModule): void {
		if (this.integrations.has(integration.type)) {
			throw new Error(
				`Integration type '${integration.type}' is already registered. Each provider type must be unique.`,
			);
		}
		this.integrations.set(integration.type, integration);
	}

	/**
	 * Get an integration by provider type.
	 * Throws if the type is not registered.
	 */
	get(type: string): IntegrationModule {
		const integration = this.integrations.get(type);
		if (!integration) {
			throw new Error(
				`Unknown integration type: '${type}'. Registered: ${[...this.integrations.keys()].join(', ')}`,
			);
		}
		return integration;
	}

	/**
	 * Get an integration by provider type, or null if not registered.
	 */
	getOrNull(type: string): IntegrationModule | null {
		return this.integrations.get(type) ?? null;
	}

	/**
	 * Get all integrations belonging to a specific category.
	 * Returns an empty array if no integrations are registered for that category.
	 */
	getByCategory(category: IntegrationCategory): IntegrationModule[] {
		return [...this.integrations.values()].filter((i) => i.category === category);
	}

	/**
	 * Get all registered integration modules.
	 */
	all(): IntegrationModule[] {
		return [...this.integrations.values()];
	}

	/**
	 * Check if any integration registered for the given project has this integration configured.
	 * Delegates to the integration module's `hasIntegration()` method.
	 */
	async hasIntegration(type: string, projectId: string): Promise<boolean> {
		const integration = this.getOrNull(type);
		if (!integration) return false;
		return integration.hasIntegration(projectId);
	}
}

/** Singleton registry, populated at import time by each integration module */
export const integrationRegistry = new IntegrationRegistry();
