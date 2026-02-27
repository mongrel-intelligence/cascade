import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks before imports
const { mockCreate, mockTwilio } = vi.hoisted(() => {
	const mockCreate = vi.fn();
	const mockTwilio = vi.fn(() => ({
		messages: { create: mockCreate },
	}));
	return { mockCreate, mockTwilio };
});

vi.mock('twilio', () => ({
	default: mockTwilio,
}));

import { TwilioSmsProvider } from '../../../../src/sms/twilio/adapter.js';

describe('TwilioSmsProvider', () => {
	const creds = {
		accountSid: 'ACtest123',
		authToken: 'token456',
		phoneNumber: '+15550000001',
	};

	let provider: TwilioSmsProvider;

	beforeEach(() => {
		vi.resetAllMocks();
		// Re-configure the factory mock after reset
		mockTwilio.mockReturnValue({ messages: { create: mockCreate } });
		provider = new TwilioSmsProvider(creds);
	});

	it('has type "twilio"', () => {
		expect(provider.type).toBe('twilio');
	});

	it('creates a Twilio client with the provided credentials', () => {
		expect(mockTwilio).toHaveBeenCalledWith('ACtest123', 'token456');
	});

	describe('sendSms', () => {
		it('calls messages.create with correct params and returns sid/status', async () => {
			mockCreate.mockResolvedValue({ sid: 'SM123', status: 'queued' });

			const result = await provider.sendSms({ to: '+15551234567', body: 'Hello world' });

			expect(mockCreate).toHaveBeenCalledWith({
				to: '+15551234567',
				from: '+15550000001',
				body: 'Hello world',
			});
			expect(result).toEqual({ sid: 'SM123', status: 'queued' });
		});

		it('propagates errors from the Twilio client', async () => {
			mockCreate.mockRejectedValue(new Error('Invalid phone number'));

			await expect(provider.sendSms({ to: 'bad-number', body: 'Hi' })).rejects.toThrow(
				'Invalid phone number',
			);
		});
	});
});
