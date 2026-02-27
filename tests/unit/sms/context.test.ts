import { describe, expect, it, vi } from 'vitest';
import { getSmsProvider, getSmsProviderOrNull, withSmsProvider } from '../../../src/sms/context.js';
import type { SmsProvider } from '../../../src/sms/provider.js';

function makeMockProvider(type = 'twilio'): SmsProvider {
	return {
		type,
		sendSms: vi.fn().mockResolvedValue({ sid: 'SM1', status: 'queued' }),
	};
}

describe('SMS AsyncLocalStorage context', () => {
	describe('getSmsProvider', () => {
		it('throws when called outside a withSmsProvider scope', () => {
			expect(() => getSmsProvider()).toThrow('No SmsProvider in scope');
		});
	});

	describe('getSmsProviderOrNull', () => {
		it('returns null when called outside a withSmsProvider scope', () => {
			expect(getSmsProviderOrNull()).toBeNull();
		});
	});

	describe('withSmsProvider', () => {
		it('makes the provider available inside the callback', async () => {
			const provider = makeMockProvider();
			const result = await withSmsProvider(provider, async () => getSmsProvider());
			expect(result).toBe(provider);
		});

		it('getSmsProviderOrNull returns provider inside scope', async () => {
			const provider = makeMockProvider();
			const result = await withSmsProvider(provider, async () => getSmsProviderOrNull());
			expect(result).toBe(provider);
		});

		it('does not leak the provider outside the callback', async () => {
			const provider = makeMockProvider();
			await withSmsProvider(provider, async () => {
				// inside — provider is available
				expect(getSmsProvider()).toBe(provider);
			});
			// outside — provider is gone
			expect(getSmsProviderOrNull()).toBeNull();
		});

		it('scopes are independent (nested withSmsProvider uses inner provider)', async () => {
			const outer = makeMockProvider('outer-twilio');
			const inner = makeMockProvider('inner-twilio');

			await withSmsProvider(outer, async () => {
				expect(getSmsProvider().type).toBe('outer-twilio');
				await withSmsProvider(inner, async () => {
					expect(getSmsProvider().type).toBe('inner-twilio');
				});
				// Back to outer scope
				expect(getSmsProvider().type).toBe('outer-twilio');
			});
		});
	});
});
