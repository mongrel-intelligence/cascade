/**
 * EmailIntegrationRegistry — singleton that holds all registered email integrations.
 *
 * Populated at import time by each integration module. The gadgets and webhook
 * handlers use `emailRegistry.getOrNull(type)` to obtain the integration instance
 * without provider-specific branching.
 */

import type { EmailIntegration } from './provider.js';

class EmailIntegrationRegistry {
	private integrations = new Map<string, EmailIntegration>();

	register(integration: EmailIntegration): void {
		this.integrations.set(integration.type, integration);
	}

	get(type: string): EmailIntegration {
		const integration = this.integrations.get(type);
		if (!integration) {
			throw new Error(
				`Unknown email integration type: '${type}'. Registered: ${[...this.integrations.keys()].join(', ')}`,
			);
		}
		return integration;
	}

	getOrNull(type: string): EmailIntegration | null {
		return this.integrations.get(type) ?? null;
	}
}

/** Singleton registry, populated at import time */
export const emailRegistry = new EmailIntegrationRegistry();
