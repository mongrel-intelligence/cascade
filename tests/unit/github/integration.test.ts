import { describe, expect, it, vi } from 'vitest';

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

import { hasScmIntegration, hasScmPersonaToken } from '../../../src/github/integration.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hasScmIntegration', () => {
	it('returns false when no SCM integration provider configured', async () => {
		mockGetIntegrationProvider.mockResolvedValue(null);

		const result = await hasScmIntegration('proj-1');

		expect(result).toBe(false);
		expect(mockGetIntegrationCredentialOrNull).not.toHaveBeenCalled();
	});

	it('returns true when implementer_token is present (reviewer absent)', async () => {
		mockGetIntegrationProvider.mockResolvedValue('github');
		mockGetIntegrationCredentialOrNull
			.mockResolvedValueOnce('ghp_implementer_token') // implementer_token
			.mockResolvedValueOnce(null); // reviewer_token

		const result = await hasScmIntegration('proj-1');

		expect(result).toBe(true);
		expect(mockGetIntegrationCredentialOrNull).toHaveBeenCalledWith(
			'proj-1',
			'scm',
			'implementer_token',
		);
	});

	it('returns true when reviewer_token is present (implementer absent)', async () => {
		mockGetIntegrationProvider.mockResolvedValue('github');
		mockGetIntegrationCredentialOrNull
			.mockResolvedValueOnce(null) // implementer_token
			.mockResolvedValueOnce('ghp_reviewer_token'); // reviewer_token

		const result = await hasScmIntegration('proj-1');

		expect(result).toBe(true);
	});

	it('returns true when both tokens are present', async () => {
		mockGetIntegrationProvider.mockResolvedValue('github');
		mockGetIntegrationCredentialOrNull
			.mockResolvedValueOnce('ghp_impl')
			.mockResolvedValueOnce('ghp_rev');

		const result = await hasScmIntegration('proj-1');

		expect(result).toBe(true);
	});

	it('returns false when provider exists but both tokens are missing', async () => {
		mockGetIntegrationProvider.mockResolvedValue('github');
		mockGetIntegrationCredentialOrNull
			.mockResolvedValueOnce(null) // implementer_token
			.mockResolvedValueOnce(null); // reviewer_token

		const result = await hasScmIntegration('proj-1');

		expect(result).toBe(false);
	});

	it('passes correct projectId and category to getIntegrationProvider', async () => {
		mockGetIntegrationProvider.mockResolvedValue(null);

		await hasScmIntegration('my-project');

		expect(mockGetIntegrationProvider).toHaveBeenCalledWith('my-project', 'scm');
	});
});

describe('hasScmPersonaToken', () => {
	it('returns true when implementer token is present', async () => {
		mockGetIntegrationCredentialOrNull.mockResolvedValue('ghp_implementer');

		const result = await hasScmPersonaToken('proj-1', 'implementer');

		expect(result).toBe(true);
		expect(mockGetIntegrationCredentialOrNull).toHaveBeenCalledWith(
			'proj-1',
			'scm',
			'implementer_token',
		);
	});

	it('returns false when implementer token is absent', async () => {
		mockGetIntegrationCredentialOrNull.mockResolvedValue(null);

		const result = await hasScmPersonaToken('proj-1', 'implementer');

		expect(result).toBe(false);
	});

	it('returns true when reviewer token is present', async () => {
		mockGetIntegrationCredentialOrNull.mockResolvedValue('ghp_reviewer');

		const result = await hasScmPersonaToken('proj-1', 'reviewer');

		expect(result).toBe(true);
		expect(mockGetIntegrationCredentialOrNull).toHaveBeenCalledWith(
			'proj-1',
			'scm',
			'reviewer_token',
		);
	});

	it('returns false when reviewer token is absent', async () => {
		mockGetIntegrationCredentialOrNull.mockResolvedValue(null);

		const result = await hasScmPersonaToken('proj-1', 'reviewer');

		expect(result).toBe(false);
	});

	it('maps implementer persona to implementer_token role', async () => {
		mockGetIntegrationCredentialOrNull.mockResolvedValue('some-token');

		await hasScmPersonaToken('proj-2', 'implementer');

		expect(mockGetIntegrationCredentialOrNull).toHaveBeenCalledWith(
			'proj-2',
			'scm',
			'implementer_token',
		);
	});

	it('maps reviewer persona to reviewer_token role', async () => {
		mockGetIntegrationCredentialOrNull.mockResolvedValue('some-token');

		await hasScmPersonaToken('proj-2', 'reviewer');

		expect(mockGetIntegrationCredentialOrNull).toHaveBeenCalledWith(
			'proj-2',
			'scm',
			'reviewer_token',
		);
	});
});
