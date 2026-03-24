import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetIntegrationCredential = vi.fn();
const mockGetIntegrationCredentialOrNull = vi.fn();

vi.mock('../../../src/config/provider.js', () => ({
	getIntegrationCredential: (...args: unknown[]) => mockGetIntegrationCredential(...args),
	getIntegrationCredentialOrNull: (...args: unknown[]) =>
		mockGetIntegrationCredentialOrNull(...args),
}));

const mockGetIntegrationProvider = vi.fn();
vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	getIntegrationProvider: (...args: unknown[]) => mockGetIntegrationProvider(...args),
}));

const mockWithGitHubToken = vi.fn().mockImplementation((_token, fn) => fn());
vi.mock('../../../src/github/client.js', () => ({
	withGitHubToken: (...args: unknown[]) => mockWithGitHubToken(...args),
}));

import { GitHubSCMIntegration } from '../../../src/github/scm-integration.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitHubSCMIntegration', () => {
	let integration: GitHubSCMIntegration;

	beforeEach(() => {
		integration = new GitHubSCMIntegration();
		vi.clearAllMocks();
	});

	// =========================================================================
	// Metadata
	// =========================================================================
	describe('metadata', () => {
		it('has type "github"', () => {
			expect(integration.type).toBe('github');
		});

		it('has category "scm"', () => {
			expect(integration.category).toBe('scm');
		});
	});

	// =========================================================================
	// hasIntegration
	// =========================================================================
	describe('hasIntegration', () => {
		it('returns false when no SCM integration provider configured', async () => {
			mockGetIntegrationProvider.mockResolvedValue(null);

			const result = await integration.hasIntegration('proj-1');

			expect(result).toBe(false);
			expect(mockGetIntegrationCredentialOrNull).not.toHaveBeenCalled();
		});

		it('returns true when implementer_token is present (reviewer absent)', async () => {
			mockGetIntegrationProvider.mockResolvedValue('github');
			mockGetIntegrationCredentialOrNull
				.mockResolvedValueOnce('ghp_implementer_token') // implementer_token
				.mockResolvedValueOnce(null); // reviewer_token

			const result = await integration.hasIntegration('proj-1');

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

			const result = await integration.hasIntegration('proj-1');

			expect(result).toBe(true);
		});

		it('returns true when both tokens are present', async () => {
			mockGetIntegrationProvider.mockResolvedValue('github');
			mockGetIntegrationCredentialOrNull
				.mockResolvedValueOnce('ghp_impl')
				.mockResolvedValueOnce('ghp_rev');

			const result = await integration.hasIntegration('proj-1');

			expect(result).toBe(true);
		});

		it('returns false when provider exists but both tokens are missing', async () => {
			mockGetIntegrationProvider.mockResolvedValue('github');
			mockGetIntegrationCredentialOrNull
				.mockResolvedValueOnce(null) // implementer_token
				.mockResolvedValueOnce(null); // reviewer_token

			const result = await integration.hasIntegration('proj-1');

			expect(result).toBe(false);
		});

		it('passes correct projectId and category to getIntegrationProvider', async () => {
			mockGetIntegrationProvider.mockResolvedValue(null);

			await integration.hasIntegration('my-project');

			expect(mockGetIntegrationProvider).toHaveBeenCalledWith('my-project', 'scm');
		});
	});

	// =========================================================================
	// hasPersonaToken
	// =========================================================================
	describe('hasPersonaToken', () => {
		it('returns true when implementer token is present', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValue('ghp_implementer');

			const result = await integration.hasPersonaToken('proj-1', 'implementer');

			expect(result).toBe(true);
			expect(mockGetIntegrationCredentialOrNull).toHaveBeenCalledWith(
				'proj-1',
				'scm',
				'implementer_token',
			);
		});

		it('returns false when implementer token is absent', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValue(null);

			const result = await integration.hasPersonaToken('proj-1', 'implementer');

			expect(result).toBe(false);
		});

		it('returns true when reviewer token is present', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValue('ghp_reviewer');

			const result = await integration.hasPersonaToken('proj-1', 'reviewer');

			expect(result).toBe(true);
			expect(mockGetIntegrationCredentialOrNull).toHaveBeenCalledWith(
				'proj-1',
				'scm',
				'reviewer_token',
			);
		});

		it('returns false when reviewer token is absent', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValue(null);

			const result = await integration.hasPersonaToken('proj-1', 'reviewer');

			expect(result).toBe(false);
		});

		it('maps implementer persona to implementer_token role', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValue('some-token');

			await integration.hasPersonaToken('proj-2', 'implementer');

			expect(mockGetIntegrationCredentialOrNull).toHaveBeenCalledWith(
				'proj-2',
				'scm',
				'implementer_token',
			);
		});

		it('maps reviewer persona to reviewer_token role', async () => {
			mockGetIntegrationCredentialOrNull.mockResolvedValue('some-token');

			await integration.hasPersonaToken('proj-2', 'reviewer');

			expect(mockGetIntegrationCredentialOrNull).toHaveBeenCalledWith(
				'proj-2',
				'scm',
				'reviewer_token',
			);
		});
	});

	// =========================================================================
	// withCredentials
	// =========================================================================
	describe('withCredentials', () => {
		it('resolves the implementer_token and calls withGitHubToken', async () => {
			mockGetIntegrationCredential.mockResolvedValue('ghp_implementer_123');
			const fn = vi.fn().mockResolvedValue('result');

			const result = await integration.withCredentials('proj-1', fn);

			expect(mockGetIntegrationCredential).toHaveBeenCalledWith(
				'proj-1',
				'scm',
				'implementer_token',
			);
			expect(mockWithGitHubToken).toHaveBeenCalledWith('ghp_implementer_123', fn);
			expect(result).toBe('result');
		});

		it('returns the value returned by fn', async () => {
			mockGetIntegrationCredential.mockResolvedValue('ghp_token');
			const fn = vi.fn().mockResolvedValue({ data: 42 });

			const result = await integration.withCredentials('proj-1', fn);

			expect(result).toEqual({ data: 42 });
		});

		it('propagates errors from fn', async () => {
			mockGetIntegrationCredential.mockResolvedValue('ghp_token');
			mockWithGitHubToken.mockImplementation((_token, fn) => fn());
			const fn = vi.fn().mockRejectedValue(new Error('API error'));

			await expect(integration.withCredentials('proj-1', fn)).rejects.toThrow('API error');
		});

		it('propagates errors from credential resolution', async () => {
			mockGetIntegrationCredential.mockRejectedValue(new Error('Credential not found'));

			const fn = vi.fn();

			await expect(integration.withCredentials('proj-1', fn)).rejects.toThrow(
				'Credential not found',
			);
			expect(fn).not.toHaveBeenCalled();
		});
	});
});
