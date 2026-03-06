import { describe, expect, it } from 'vitest';
import {
	getEmailProvider,
	getEmailProviderOrNull,
	withEmailProvider,
} from '../../../src/email/context.js';
import type { EmailProvider } from '../../../src/email/provider.js';

function makeProvider(type = 'imap'): EmailProvider {
	return {
		type,
		searchEmails: async () => [],
		readEmail: async () => ({
			uid: 0,
			messageId: '',
			date: new Date(),
			from: '',
			to: [],
			cc: [],
			subject: '',
			textBody: '',
			attachments: [],
			references: [],
		}),
		sendEmail: async () => ({ messageId: '', accepted: [], rejected: [] }),
		replyToEmail: async () => ({ messageId: '', accepted: [], rejected: [] }),
		markEmailAsSeen: async () => {},
	};
}

describe('email provider scoping', () => {
	describe('withEmailProvider', () => {
		it('makes provider available inside the callback', async () => {
			const provider = makeProvider();

			let captured: EmailProvider | undefined;
			await withEmailProvider(provider, async () => {
				captured = getEmailProvider();
			});

			expect(captured).toBe(provider);
		});

		it('returns the result of the callback', async () => {
			const provider = makeProvider();
			const result = await withEmailProvider(provider, async () => 'test-result');
			expect(result).toBe('test-result');
		});

		it('provider is not available outside the callback', async () => {
			const provider = makeProvider();
			await withEmailProvider(provider, async () => {});

			expect(() => getEmailProvider()).toThrow('No EmailProvider in scope.');
		});
	});

	describe('getEmailProvider', () => {
		it('throws when no provider is in scope', () => {
			expect(() => getEmailProvider()).toThrow('No EmailProvider in scope.');
		});
	});

	describe('getEmailProviderOrNull', () => {
		it('returns null when no provider is in scope', () => {
			expect(getEmailProviderOrNull()).toBeNull();
		});

		it('returns the provider when in scope', async () => {
			const provider = makeProvider();
			let result: EmailProvider | null = null;
			await withEmailProvider(provider, async () => {
				result = getEmailProviderOrNull();
			});
			expect(result).toBe(provider);
		});
	});
});
