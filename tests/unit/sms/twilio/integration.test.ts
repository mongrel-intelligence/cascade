import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks before imports
const { mockGetIntegrationCredentialOrNull } = vi.hoisted(() => ({
	mockGetIntegrationCredentialOrNull: vi.fn(),
}));

vi.mock('../../../../src/config/provider.js', () => ({
	getIntegrationCredentialOrNull: mockGetIntegrationCredentialOrNull,
}));

vi.mock('twilio', () => ({
	default: vi.fn(() => ({
		messages: { create: vi.fn() },
	})),
}));

import { TwilioIntegration } from '../../../../src/sms/twilio/integration.js';

describe('TwilioIntegration', () => {
	let integration: TwilioIntegration;

	beforeEach(() => {
		vi.resetAllMocks();
		integration = new TwilioIntegration();
	});

	it('has type "twilio"', () => {
		expect(integration.type).toBe('twilio');
	});

	describe('hasCredentials', () => {
		it('returns true when all three credentials are present', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce('ACtest123');
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce('token456');
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce('+15550000001');

			const result = await integration.hasCredentials('project-1');
			expect(result).toBe(true);
		});

		it('returns false when account_sid is missing', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce(null);
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce('token456');
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce('+15550000001');

			const result = await integration.hasCredentials('project-1');
			expect(result).toBe(false);
		});

		it('returns false when auth_token is missing', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce('ACtest123');
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce(null);
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce('+15550000001');

			const result = await integration.hasCredentials('project-1');
			expect(result).toBe(false);
		});

		it('returns false when phone_number is missing', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce('ACtest123');
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce('token456');
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce(null);

			const result = await integration.hasCredentials('project-1');
			expect(result).toBe(false);
		});
	});

	describe('withCredentials', () => {
		it('calls fn() directly when credentials are missing', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValue(null);

			const fn = vi.fn().mockResolvedValue('result');
			const result = await integration.withCredentials('project-1', fn);

			expect(fn).toHaveBeenCalledOnce();
			expect(result).toBe('result');
		});

		it('scopes provider and calls fn() when credentials are present', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce('ACtest123');
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce('token456');
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce('+15550000001');

			const fn = vi.fn().mockResolvedValue('ok');
			const result = await integration.withCredentials('project-1', fn);

			expect(fn).toHaveBeenCalledOnce();
			expect(result).toBe('ok');
		});
	});
});
