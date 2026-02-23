/**
 * AsyncLocalStorage-based scoping for the active PMProvider.
 *
 * Same pattern as withTrelloCredentials() — webhook handlers call
 * withPMProvider(provider, fn) to make the provider available to
 * all downstream code via getPMProvider().
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { PMIntegration } from './integration.js';
import type { PMProvider } from './types.js';

const pmProviderStore = new AsyncLocalStorage<PMProvider>();

export function withPMProvider<T>(provider: PMProvider, fn: () => Promise<T>): Promise<T> {
	return pmProviderStore.run(provider, fn);
}

export function getPMProvider(): PMProvider {
	const provider = pmProviderStore.getStore();
	if (!provider) {
		throw new Error(
			'No PMProvider in scope. Wrap the call with withPMProvider() or ensure the webhook handler has established a PM context.',
		);
	}
	return provider;
}

export function getPMProviderOrNull(): PMProvider | null {
	return pmProviderStore.getStore() ?? null;
}

/**
 * Establish PM credential scope for a project.
 *
 * Uses the integration's withCredentials() for the correct PM type.
 * Falls through to running fn() directly if no PM type is configured
 * or the integration is unknown.
 */
export async function withPMCredentials<T>(
	projectId: string,
	pmType: string | undefined,
	getIntegration: (type: string) => PMIntegration | null,
	fn: () => Promise<T>,
): Promise<T> {
	if (!pmType) return fn();
	const integration = getIntegration(pmType);
	if (!integration) return fn();
	return integration.withCredentials(projectId, fn);
}
