/**
 * AsyncLocalStorage-based scoping for the active EmailProvider.
 *
 * Webhook handlers / integration wrappers call withEmailProvider(provider, fn)
 * to make the provider available to all downstream gadget code via getEmailProvider().
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { EmailProvider } from './provider.js';

const emailProviderStore = new AsyncLocalStorage<EmailProvider>();

export function withEmailProvider<T>(provider: EmailProvider, fn: () => Promise<T>): Promise<T> {
	return emailProviderStore.run(provider, fn);
}

export function getEmailProvider(): EmailProvider {
	const provider = emailProviderStore.getStore();
	if (!provider) {
		throw new Error(
			'No EmailProvider in scope. Wrap the call with withEmailProvider() or ensure per-project email credentials are set in the database.',
		);
	}
	return provider;
}

export function getEmailProviderOrNull(): EmailProvider | null {
	return emailProviderStore.getStore() ?? null;
}
