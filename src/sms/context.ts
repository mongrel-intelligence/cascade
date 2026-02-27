/**
 * AsyncLocalStorage-based scoping for the active SmsProvider.
 *
 * Webhook handlers / integration wrappers call withSmsProvider(provider, fn)
 * to make the provider available to all downstream gadget code via getSmsProvider().
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { SmsProvider } from './provider.js';

const smsProviderStore = new AsyncLocalStorage<SmsProvider>();

export function withSmsProvider<T>(provider: SmsProvider, fn: () => Promise<T>): Promise<T> {
	return smsProviderStore.run(provider, fn);
}

export function getSmsProvider(): SmsProvider {
	const provider = smsProviderStore.getStore();
	if (!provider) {
		throw new Error(
			'No SmsProvider in scope. Wrap the call with withSmsProvider() or ensure per-project SMS credentials are set in the database.',
		);
	}
	return provider;
}

export function getSmsProviderOrNull(): SmsProvider | null {
	return smsProviderStore.getStore() ?? null;
}
