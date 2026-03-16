import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetIntegrationProvider = vi.fn();
vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	getIntegrationProvider: (...args: unknown[]) => mockGetIntegrationProvider(...args),
}));

const mockGetIntegrationCredentialOrNull = vi.fn();
vi.mock('../../../src/config/provider.js', () => ({
	getIntegrationCredentialOrNull: (...args: unknown[]) =>
		mockGetIntegrationCredentialOrNull(...args),
}));

import { hasPmIntegration } from '../../../src/pm/integration.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hasPmIntegration', () => {
	it('returns false when no PM integration provider configured', async () => {
		mockGetIntegrationProvider.mockResolvedValue(null);

		const result = await hasPmIntegration('proj-1');

		expect(result).toBe(false);
		expect(mockGetIntegrationCredentialOrNull).not.toHaveBeenCalled();
	});

	it('returns false when provider is unknown (not in PROVIDER_CREDENTIAL_ROLES)', async () => {
		mockGetIntegrationProvider.mockResolvedValue('unknown-provider');

		const result = await hasPmIntegration('proj-1');

		expect(result).toBe(false);
	});

	it('passes projectId and "pm" category to getIntegrationProvider', async () => {
		mockGetIntegrationProvider.mockResolvedValue(null);

		await hasPmIntegration('my-project');

		expect(mockGetIntegrationProvider).toHaveBeenCalledWith('my-project', 'pm');
	});

	// =========================================================================
	// Trello
	// =========================================================================
	describe('trello provider', () => {
		beforeEach(() => {
			mockGetIntegrationProvider.mockResolvedValue('trello');
		});

		it('returns true when all required trello credentials are present', async () => {
			// Trello required roles: api_key, token (api_secret is optional)
			mockGetIntegrationCredentialOrNull
				.mockResolvedValueOnce('my-api-key') // api_key
				.mockResolvedValueOnce('my-token'); // token

			const result = await hasPmIntegration('proj-1');

			expect(result).toBe(true);
		});

		it('returns false when trello api_key is missing', async () => {
			mockGetIntegrationCredentialOrNull
				.mockResolvedValueOnce(null) // api_key missing
				.mockResolvedValueOnce('my-token'); // token present

			const result = await hasPmIntegration('proj-1');

			expect(result).toBe(false);
		});

		it('returns false when trello token is missing', async () => {
			mockGetIntegrationCredentialOrNull
				.mockResolvedValueOnce('my-api-key') // api_key present
				.mockResolvedValueOnce(null); // token missing

			const result = await hasPmIntegration('proj-1');

			expect(result).toBe(false);
		});

		it('returns false when both required trello credentials are missing', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValue(null);

			const result = await hasPmIntegration('proj-1');

			expect(result).toBe(false);
		});

		it('checks required roles (api_key, token) — not optional api_secret', async () => {
			// Required: api_key, token. Optional: api_secret
			// If api_key and token present → true, regardless of api_secret
			mockGetIntegrationCredentialOrNull
				.mockResolvedValueOnce('my-api-key')
				.mockResolvedValueOnce('my-token');

			const result = await hasPmIntegration('proj-1');

			expect(result).toBe(true);
			// Should only have checked 2 required credentials (not 3)
			expect(mockGetIntegrationCredentialOrNull).toHaveBeenCalledTimes(2);
		});
	});

	// =========================================================================
	// JIRA
	// =========================================================================
	describe('jira provider', () => {
		beforeEach(() => {
			mockGetIntegrationProvider.mockResolvedValue('jira');
		});

		it('returns true when all required jira credentials are present', async () => {
			// JIRA required roles: email, api_token
			mockGetIntegrationCredentialOrNull
				.mockResolvedValueOnce('bot@example.com') // email
				.mockResolvedValueOnce('api-token-xxx'); // api_token

			const result = await hasPmIntegration('proj-1');

			expect(result).toBe(true);
		});

		it('returns false when jira email is missing', async () => {
			mockGetIntegrationCredentialOrNull
				.mockResolvedValueOnce(null) // email missing
				.mockResolvedValueOnce('api-token-xxx');

			const result = await hasPmIntegration('proj-1');

			expect(result).toBe(false);
		});

		it('returns false when jira api_token is missing', async () => {
			mockGetIntegrationCredentialOrNull
				.mockResolvedValueOnce('bot@example.com')
				.mockResolvedValueOnce(null); // api_token missing

			const result = await hasPmIntegration('proj-1');

			expect(result).toBe(false);
		});

		it('checks for pm category credentials for jira', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValue('value');

			await hasPmIntegration('proj-1');

			expect(mockGetIntegrationCredentialOrNull).toHaveBeenCalledWith('proj-1', 'pm', 'email');
			expect(mockGetIntegrationCredentialOrNull).toHaveBeenCalledWith('proj-1', 'pm', 'api_token');
		});
	});
});
