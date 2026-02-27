import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks before imports
const { mockGetIntegrationCredentialOrNull, mockValidateRequest } = vi.hoisted(() => ({
	mockGetIntegrationCredentialOrNull: vi.fn(),
	mockValidateRequest: vi.fn(),
}));

vi.mock('../../../../src/config/provider.js', () => ({
	getIntegrationCredentialOrNull: mockGetIntegrationCredentialOrNull,
}));

vi.mock('twilio', () => ({
	default: Object.assign(vi.fn(), {
		validateRequest: mockValidateRequest,
	}),
}));

import { handleTwilioWebhook } from '../../../../src/router/adapters/twilio.js';

function buildApp() {
	const app = new Hono();
	app.post('/twilio/webhook/:projectId', handleTwilioWebhook);
	return app;
}

function makeFormBody(fields: Record<string, string>): string {
	return new URLSearchParams(fields).toString();
}

const VALID_BODY = {
	MessageSid: 'SM123',
	From: '+15551234567',
	To: '+15550000001',
	Body: 'Hello!',
};

describe('handleTwilioWebhook', () => {
	let app: ReturnType<typeof buildApp>;

	beforeEach(() => {
		vi.resetAllMocks();
		app = buildApp();
	});

	it('returns 403 when no auth_token is configured', async () => {
		mockGetIntegrationCredentialOrNull.mockResolvedValue(null);

		const res = await app.request('/twilio/webhook/project-1', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'X-Twilio-Signature': 'sig',
			},
			body: makeFormBody(VALID_BODY),
		});

		expect(res.status).toBe(403);
		expect(await res.text()).toBe('Forbidden');
	});

	it('returns 403 when signature validation fails', async () => {
		mockGetIntegrationCredentialOrNull.mockResolvedValue('auth-token-secret');
		mockValidateRequest.mockReturnValue(false);

		const res = await app.request('/twilio/webhook/project-1', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'X-Twilio-Signature': 'bad-sig',
			},
			body: makeFormBody(VALID_BODY),
		});

		expect(res.status).toBe(403);
		expect(await res.text()).toBe('Forbidden');
	});

	it('returns 200 with empty TwiML when signature is valid', async () => {
		mockGetIntegrationCredentialOrNull.mockResolvedValue('auth-token-secret');
		mockValidateRequest.mockReturnValue(true);

		const res = await app.request('/twilio/webhook/project-1', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'X-Twilio-Signature': 'valid-sig',
			},
			body: makeFormBody(VALID_BODY),
		});

		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain('<Response/>');
		expect(text).toContain('<?xml');
	});

	it('passes auth_token, signature, and url to validateRequest', async () => {
		mockGetIntegrationCredentialOrNull.mockResolvedValue('my-auth-token');
		mockValidateRequest.mockReturnValue(true);

		await app.request('http://localhost/twilio/webhook/project-2', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'X-Twilio-Signature': 'expected-sig',
			},
			body: makeFormBody(VALID_BODY),
		});

		expect(mockValidateRequest).toHaveBeenCalledWith(
			'my-auth-token',
			'expected-sig',
			expect.stringContaining('/twilio/webhook/project-2'),
			expect.objectContaining({ MessageSid: 'SM123' }),
		);
	});
});
