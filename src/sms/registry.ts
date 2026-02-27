/**
 * SmsIntegrationRegistry — singleton that holds all registered SMS integrations.
 *
 * Populated at import time by each integration module. Gadgets and webhook
 * handlers use `smsRegistry.getOrNull(type)` to obtain the integration instance
 * without provider-specific branching.
 */

import type { SmsIntegration } from './provider.js';

class SmsIntegrationRegistry {
	private integrations = new Map<string, SmsIntegration>();

	register(integration: SmsIntegration): void {
		this.integrations.set(integration.type, integration);
	}

	get(type: string): SmsIntegration {
		const integration = this.integrations.get(type);
		if (!integration) {
			throw new Error(
				`Unknown SMS integration type: '${type}'. Registered: ${[...this.integrations.keys()].join(', ')}`,
			);
		}
		return integration;
	}

	getOrNull(type: string): SmsIntegration | null {
		return this.integrations.get(type) ?? null;
	}
}

/** Singleton registry, populated at import time */
export const smsRegistry = new SmsIntegrationRegistry();
