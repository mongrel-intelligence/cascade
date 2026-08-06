import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies before importing
vi.mock('../../../src/config/provider.js', () => ({
	getIntegrationCredential: vi.fn(),
}));

vi.mock('../../../src/gitlab/client.js', () => ({
	getGitLabUserForToken: vi.fn(),
	withGitLabToken: vi.fn(),
	gitlabClient: {},
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { getIntegrationCredential } from '../../../src/config/provider.js';
import { getGitLabUserForToken } from '../../../src/gitlab/client.js';
import type { PersonaIdentities } from '../../../src/gitlab/personas.js';
import {
	_resetPersonaIdentityCache,
	getPersonaForAgentType,
	getPersonaForLogin,
	getPersonaToken,
	isCascadeBot,
	resolvePersonaIdentities,
} from '../../../src/gitlab/personas.js';

describe('GitLab personas', () => {
	beforeEach(() => {
		_resetPersonaIdentityCache();
	});

	afterEach(() => {
		_resetPersonaIdentityCache();
	});

	// ========================================================================
	// getPersonaForAgentType
	// ========================================================================

	describe('getPersonaForAgentType', () => {
		it('maps implementation agents to implementer', () => {
			expect(getPersonaForAgentType('implementation')).toBe('implementer');
			expect(getPersonaForAgentType('splitting')).toBe('implementer');
			expect(getPersonaForAgentType('planning')).toBe('implementer');
			expect(getPersonaForAgentType('respond-to-review')).toBe('implementer');
			expect(getPersonaForAgentType('respond-to-ci')).toBe('implementer');
			expect(getPersonaForAgentType('respond-to-pr-comment')).toBe('implementer');
			expect(getPersonaForAgentType('respond-to-planning-comment')).toBe('implementer');
			expect(getPersonaForAgentType('debug')).toBe('implementer');
		});

		it('maps review agent to reviewer', () => {
			expect(getPersonaForAgentType('review')).toBe('reviewer');
		});

		it('defaults unknown agent types to implementer', () => {
			expect(getPersonaForAgentType('unknown-agent')).toBe('implementer');
			expect(getPersonaForAgentType('custom-agent')).toBe('implementer');
		});
	});

	// ========================================================================
	// getPersonaToken
	// ========================================================================

	describe('getPersonaToken', () => {
		it('resolves implementer_token for implementer agents', async () => {
			vi.mocked(getIntegrationCredential).mockResolvedValue('glpat-impl-token');

			const token = await getPersonaToken('proj-1', 'implementation');

			expect(getIntegrationCredential).toHaveBeenCalledWith(
				'proj-1',
				'scm',
				'gitlab',
				'implementer_token',
			);
			expect(token).toBe('glpat-impl-token');
		});

		it('resolves reviewer_token for review agent', async () => {
			vi.mocked(getIntegrationCredential).mockResolvedValue('glpat-review-token');

			const token = await getPersonaToken('proj-1', 'review');

			expect(getIntegrationCredential).toHaveBeenCalledWith(
				'proj-1',
				'scm',
				'gitlab',
				'reviewer_token',
			);
			expect(token).toBe('glpat-review-token');
		});
	});

	// ========================================================================
	// isCascadeBot
	// ========================================================================

	describe('isCascadeBot', () => {
		const identities: PersonaIdentities = {
			implementer: 'gl-cascade-impl',
			reviewer: 'gl-cascade-review',
		};

		it('returns true for implementer username', () => {
			expect(isCascadeBot('gl-cascade-impl', identities)).toBe(true);
		});

		it('returns true for reviewer username', () => {
			expect(isCascadeBot('gl-cascade-review', identities)).toBe(true);
		});

		it('returns false for unrelated username', () => {
			expect(isCascadeBot('random-user', identities)).toBe(false);
		});

		it('returns false for username with [bot] suffix (GitLab does not use this)', () => {
			expect(isCascadeBot('gl-cascade-impl[bot]', identities)).toBe(false);
		});
	});

	// ========================================================================
	// getPersonaForLogin
	// ========================================================================

	describe('getPersonaForLogin', () => {
		const identities: PersonaIdentities = {
			implementer: 'gl-cascade-impl',
			reviewer: 'gl-cascade-review',
		};

		it('returns implementer for implementer username', () => {
			expect(getPersonaForLogin('gl-cascade-impl', identities)).toBe('implementer');
		});

		it('returns reviewer for reviewer username', () => {
			expect(getPersonaForLogin('gl-cascade-review', identities)).toBe('reviewer');
		});

		it('returns null for unknown username', () => {
			expect(getPersonaForLogin('random-user', identities)).toBeNull();
		});
	});

	// ========================================================================
	// resolvePersonaIdentities
	// ========================================================================

	describe('resolvePersonaIdentities', () => {
		it('resolves both persona usernames from tokens', async () => {
			vi.mocked(getIntegrationCredential)
				.mockResolvedValueOnce('glpat-impl-token')
				.mockResolvedValueOnce('glpat-review-token');
			vi.mocked(getGitLabUserForToken)
				.mockResolvedValueOnce('gl-impl-user')
				.mockResolvedValueOnce('gl-review-user');

			const result = await resolvePersonaIdentities('proj-1');

			expect(result).toEqual({
				implementer: 'gl-impl-user',
				reviewer: 'gl-review-user',
			});
		});

		it('caches results per project', async () => {
			vi.mocked(getIntegrationCredential)
				.mockResolvedValueOnce('glpat-impl-token')
				.mockResolvedValueOnce('glpat-review-token');
			vi.mocked(getGitLabUserForToken)
				.mockResolvedValueOnce('gl-impl-user')
				.mockResolvedValueOnce('gl-review-user');

			const result1 = await resolvePersonaIdentities('proj-1');
			const result2 = await resolvePersonaIdentities('proj-1');

			expect(result1).toEqual(result2);
			// Only called once due to caching
			expect(getIntegrationCredential).toHaveBeenCalledTimes(2); // 2 calls for the first resolution
		});

		it('throws when implementer login cannot be resolved', async () => {
			vi.mocked(getIntegrationCredential)
				.mockResolvedValueOnce('glpat-impl-token')
				.mockResolvedValueOnce('glpat-review-token');
			vi.mocked(getGitLabUserForToken)
				.mockResolvedValueOnce(null) // implementer fails
				.mockResolvedValueOnce('gl-review-user');

			await expect(resolvePersonaIdentities('proj-1')).rejects.toThrow(
				/Failed to resolve GitLab identity for implementer token/,
			);
		});

		it('throws when reviewer login cannot be resolved', async () => {
			vi.mocked(getIntegrationCredential)
				.mockResolvedValueOnce('glpat-impl-token')
				.mockResolvedValueOnce('glpat-review-token');
			vi.mocked(getGitLabUserForToken)
				.mockResolvedValueOnce('gl-impl-user')
				.mockResolvedValueOnce(null); // reviewer fails

			await expect(resolvePersonaIdentities('proj-1')).rejects.toThrow(
				/Failed to resolve GitLab identity for reviewer token/,
			);
		});
	});
});
