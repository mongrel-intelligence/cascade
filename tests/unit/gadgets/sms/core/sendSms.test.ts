import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks before imports
const { mockGetSmsProvider } = vi.hoisted(() => ({
	mockGetSmsProvider: vi.fn(),
}));

vi.mock('../../../../../src/sms/context.js', () => ({
	getSmsProvider: mockGetSmsProvider,
}));

import { sendSms } from '../../../../../src/gadgets/sms/core/sendSms.js';

describe('sendSms core function', () => {
	const mockSendSms = vi.fn();

	beforeEach(() => {
		vi.resetAllMocks();
		mockGetSmsProvider.mockReturnValue({ sendSms: mockSendSms });
	});

	it('returns success message on successful send', async () => {
		mockSendSms.mockResolvedValue({ sid: 'SM123abc', status: 'queued' });

		const result = await sendSms({ to: '+15551234567', body: 'Hello' });

		expect(result).toContain('+15551234567');
		expect(result).toContain('SM123abc');
		expect(result).toContain('queued');
		expect(result).toContain('successfully');
	});

	it('returns error message on failure', async () => {
		mockSendSms.mockRejectedValue(new Error('Twilio error: invalid number'));

		const result = await sendSms({ to: 'bad', body: 'test' });

		expect(result).toContain('Error sending SMS');
		expect(result).toContain('Twilio error: invalid number');
	});

	it('calls getSmsProvider().sendSms with correct options', async () => {
		mockSendSms.mockResolvedValue({ sid: 'SM999', status: 'sent' });

		await sendSms({ to: '+15550000001', body: 'Test message' });

		expect(mockSendSms).toHaveBeenCalledWith({
			to: '+15550000001',
			body: 'Test message',
		});
	});
});
