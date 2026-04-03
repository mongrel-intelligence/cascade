/**
 * PMIntegrationRegistry — singleton that holds all registered PM integrations.
 *
 * Populated at bootstrap time by `src/integrations/bootstrap.ts`. The router,
 * worker, and shared infrastructure use `pmRegistry.get(type)` to obtain the
 * integration instance without provider-specific branching.
 */

import type { ProjectConfig } from '../types/index.js';
import type { PMIntegration } from './integration.js';
import type { ProjectPMConfig } from './lifecycle.js';
import type { PMProvider } from './types.js';

class PMIntegrationRegistry {
	private integrations = new Map<string, PMIntegration>();

	register(integration: PMIntegration): void {
		this.integrations.set(integration.type, integration);
	}

	get(type: string): PMIntegration {
		const integration = this.integrations.get(type);
		if (!integration) {
			throw new Error(
				`Unknown PM integration type: '${type}'. Registered: ${[...this.integrations.keys()].join(', ')}`,
			);
		}
		return integration;
	}

	getOrNull(type: string): PMIntegration | null {
		return this.integrations.get(type) ?? null;
	}

	all(): PMIntegration[] {
		return [...this.integrations.values()];
	}

	/** Convenience: get the integration for a project and create its PMProvider */
	createProvider(project: ProjectConfig): PMProvider {
		const type = project.pm?.type ?? 'trello';
		return this.get(type).createProvider(project);
	}

	/** Convenience: resolve lifecycle config from project */
	resolveLifecycleConfig(project: ProjectConfig): ProjectPMConfig {
		const type = project.pm?.type ?? 'trello';
		return this.get(type).resolveLifecycleConfig(project);
	}
}

/** Singleton registry, populated at bootstrap time by `src/integrations/bootstrap.ts` */
export const pmRegistry = new PMIntegrationRegistry();
