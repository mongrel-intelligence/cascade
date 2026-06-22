/**
 * PMIntegrationRegistry — **compatibility adapter** over `pmProviderRegistry`.
 *
 * @deprecated Prefer `getPMProvider(id)` / `listPMProviders()` from
 * `src/integrations/pm/registry.ts` in new code. This file exists solely
 * so the ~9 unmigrated call sites from before spec 006 keep working
 * (webhook handlers, manual runner, credential scope, lifecycle, GitHub
 * adapter). As of plan 006/5 those callers transparently read from the
 * manifest registry — there is no divergent registration any more.
 *
 * Removed when the downstream callers migrate to `pmProviderRegistry`
 * directly. Until then: single source of truth is `pmProviderRegistry`;
 * this adapter is read-only.
 */

import type { PMProviderManifest } from '../integrations/pm/manifest.js';
import { getPMProvider as getManifest, listPMProviders } from '../integrations/pm/registry.js';
import type { ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';
import type { PMIntegration } from './integration.js';
import type { ProjectPMConfig } from './lifecycle.js';
import { NO_PM_PROVIDER } from './no-pm-provider.js';
import type { PMProvider } from './types.js';

class PMIntegrationRegistry {
	/**
	 * @deprecated No-op. Providers register via their manifest barrel
	 * (`src/integrations/pm/<provider>/index.js`). Calling this only emits
	 * a warn; the manifest registry remains authoritative.
	 */
	register(integration: PMIntegration): void {
		logger.warn(
			'[pmRegistry.register] Deprecated no-op — providers now register via the manifest barrel. Ignoring call.',
			{ type: integration.type },
		);
	}

	/** Returns the PMIntegration for a provider type. Throws on unknown type. */
	get(type: string): PMIntegration {
		const manifest = getManifest(type);
		if (!manifest) {
			const registered = listPMProviders()
				.map((m) => m.id)
				.join(', ');
			throw new Error(`Unknown PM integration type: '${type}'. Registered: ${registered}`);
		}
		return manifest.pmIntegration;
	}

	/** Returns the PMIntegration for a provider type, or null if not registered. */
	getOrNull(type: string): PMIntegration | null {
		return getManifest(type)?.pmIntegration ?? null;
	}

	/** Returns every registered PMIntegration in registration order. */
	all(): PMIntegration[] {
		return listPMProviders().map((m: PMProviderManifest) => m.pmIntegration);
	}

	/**
	 * Convenience: resolve the project's PM provider and create its PMProvider.
	 * SCM-only projects (no `pm`) get the no-op {@link NO_PM_PROVIDER} sentinel —
	 * never a phantom Trello provider.
	 */
	createProvider(project: ProjectConfig): PMProvider {
		const type = project.pm?.type;
		if (!type) return NO_PM_PROVIDER;
		return this.get(type).createProvider(project);
	}

	/** Convenience: resolve lifecycle config from project. SCM-only → empty config. */
	resolveLifecycleConfig(project: ProjectConfig): ProjectPMConfig {
		const type = project.pm?.type;
		if (!type) return { labels: {}, statuses: {} };
		return this.get(type).resolveLifecycleConfig(project);
	}
}

/**
 * Singleton adapter.
 *
 * @deprecated Prefer `getPMProvider` / `listPMProviders` from
 * `src/integrations/pm/registry.ts` in new code. Existing call sites
 * continue to work unchanged — this adapter delegates every lookup to
 * the manifest registry.
 */
export const pmRegistry = new PMIntegrationRegistry();
