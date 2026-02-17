import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies before importing
vi.mock('../../../src/config/provider.js', () => ({
	getAgentCredential: vi.fn(),
}));

vi.mock('../../../src/github/client.js', () => ({
	getGitHubUserForToken: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { getAgentCredential } from '../../../src/config/provider.js';
import { getGitHubUserForToken } from '../../../src/github/client.js';
import {
	getPersonaForAgentType,
	getPersonaForLogin,
	getPersonaToken,
	getTokenKeyForPersona,
	isCascadeBot,
	resolvePersonaIdentities,
} from '../../../src/github/personas.js';
import type { PersonaIdentities } from '../../../src/github/personas.js';

describe('personas', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ========================================================================
	// getPersonaForAgentType
	// ========================================================================

	describe('getPersonaForAgentType', () => {
		it('maps implementation agents to implementer', () => {
			expect(getPersonaForAgentType('implementation')).toBe('implementer');
			expect(getPersonaForAgentType('briefing')).toBe('implementer');
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
			expect(getPersonaForAgentType('')).toBe('implementer');
		});
	});

	// ========================================================================
	// getTokenKeyForPersona
	// ========================================================================

	describe('getTokenKeyForPersona', () => {
		it('returns GITHUB_TOKEN_IMPLEMENTER for implementer', () => {
			expect(getTokenKeyForPersona('implementer')).toBe('GITHUB_TOKEN_IMPLEMENTER');
		});

		it('returns GITHUB_TOKEN_REVIEWER for reviewer', () => {
			expect(getTokenKeyForPersona('reviewer')).toBe('GITHUB_TOKEN_REVIEWER');
		});
	});

	// ========================================================================
	// getPersonaToken
	// ========================================================================

	describe('getPersonaToken', () => {
		it('resolves implementer token for implementation agent', async () => {
			vi.mocked(getAgentCredential).mockResolvedValue('ghp_impl_token');

			const token = await getPersonaToken('project1', 'implementation');

			expect(token).toBe('ghp_impl_token');
			expect(getAgentCredential).toHaveBeenCalledWith(
				'project1',
				'implementation',
				'GITHUB_TOKEN_IMPLEMENTER',
			);
		});

		it('resolves reviewer token for review agent', async () => {
			vi.mocked(getAgentCredential).mockResolvedValue('ghp_review_token');

			const token = await getPersonaToken('project1', 'review');

			expect(token).toBe('ghp_review_token');
			expect(getAgentCredential).toHaveBeenCalledWith(
				'project1',
				'review',
				'GITHUB_TOKEN_REVIEWER',
			);
		});

		it('resolves implementer token for respond-to-review agent', async () => {
			vi.mocked(getAgentCredential).mockResolvedValue('ghp_impl_token');

			const token = await getPersonaToken('project1', 'respond-to-review');

			expect(token).toBe('ghp_impl_token');
			expect(getAgentCredential).toHaveBeenCalledWith(
				'project1',
				'respond-to-review',
				'GITHUB_TOKEN_IMPLEMENTER',
			);
		});

		it('throws when no token is found', async () => {
			vi.mocked(getAgentCredential).mockResolvedValue(null);

			await expect(getPersonaToken('project1', 'implementation')).rejects.toThrow(
				'Missing GITHUB_TOKEN_IMPLEMENTER',
			);
		});

		it('throws with descriptive error including project, agent, and persona', async () => {
			vi.mocked(getAgentCredential).mockResolvedValue(null);

			await expect(getPersonaToken('my-project', 'review')).rejects.toThrow(
				"Missing GITHUB_TOKEN_REVIEWER for project 'my-project' (agent: review, persona: reviewer)",
			);
		});

		it('defaults unknown agent types to implementer persona', async () => {
			vi.mocked(getAgentCredential).mockResolvedValue('ghp_token');

			await getPersonaToken('project1', 'some-new-agent');

			expect(getAgentCredential).toHaveBeenCalledWith(
				'project1',
				'some-new-agent',
				'GITHUB_TOKEN_IMPLEMENTER',
			);
		});
	});

	// ========================================================================
	// resolvePersonaIdentities
	// ========================================================================

	describe('resolvePersonaIdentities', () => {
		it('resolves both persona identities', async () => {
			vi.mocked(getAgentCredential)
				.mockResolvedValueOnce('ghp_impl') // implementer token
				.mockResolvedValueOnce('ghp_review'); // reviewer token
			vi.mocked(getGitHubUserForToken)
				.mockResolvedValueOnce('cascade-impl-bot') // implementer login
				.mockResolvedValueOnce('cascade-review-bot'); // reviewer login

			const identities = await resolvePersonaIdentities('project1');

			expect(identities).toEqual({
				implementer: 'cascade-impl-bot',
				reviewer: 'cascade-review-bot',
			});
		});

		it('fetches fresh data on each call', async () => {
			vi.mocked(getAgentCredential)
				.mockResolvedValueOnce('ghp_impl')
				.mockResolvedValueOnce('ghp_review')
				.mockResolvedValueOnce('ghp_impl')
				.mockResolvedValueOnce('ghp_review');
			vi.mocked(getGitHubUserForToken)
				.mockResolvedValueOnce('cascade-impl-bot')
				.mockResolvedValueOnce('cascade-review-bot')
				.mockResolvedValueOnce('cascade-impl-bot')
				.mockResolvedValueOnce('cascade-review-bot');

			const first = await resolvePersonaIdentities('project1');
			const second = await resolvePersonaIdentities('project1');

			expect(first).toEqual(second);
			expect(getAgentCredential).toHaveBeenCalledTimes(4); // Called on every invocation
		});

		it('resolves separately for different projects', async () => {
			vi.mocked(getAgentCredential)
				.mockResolvedValueOnce('ghp_impl_1')
				.mockResolvedValueOnce('ghp_review_1')
				.mockResolvedValueOnce('ghp_impl_2')
				.mockResolvedValueOnce('ghp_review_2');
			vi.mocked(getGitHubUserForToken)
				.mockResolvedValueOnce('bot-impl-1')
				.mockResolvedValueOnce('bot-review-1')
				.mockResolvedValueOnce('bot-impl-2')
				.mockResolvedValueOnce('bot-review-2');

			const id1 = await resolvePersonaIdentities('project1');
			const id2 = await resolvePersonaIdentities('project2');

			expect(id1.implementer).toBe('bot-impl-1');
			expect(id2.implementer).toBe('bot-impl-2');
		});

		it('throws when implementer token is missing', async () => {
			vi.mocked(getAgentCredential).mockResolvedValue(null);

			await expect(resolvePersonaIdentities('project1')).rejects.toThrow(
				"Missing GITHUB_TOKEN_IMPLEMENTER for project 'project1'",
			);
		});

		it('throws when reviewer token is missing', async () => {
			vi.mocked(getAgentCredential)
				.mockResolvedValueOnce('ghp_impl') // implementer OK
				.mockResolvedValueOnce(null); // reviewer missing

			await expect(resolvePersonaIdentities('project1')).rejects.toThrow(
				"Missing GITHUB_TOKEN_REVIEWER for project 'project1'",
			);
		});

		it('throws when implementer identity cannot be resolved', async () => {
			vi.mocked(getAgentCredential)
				.mockResolvedValueOnce('ghp_impl')
				.mockResolvedValueOnce('ghp_review');
			vi.mocked(getGitHubUserForToken)
				.mockResolvedValueOnce(null) // implementer resolution fails
				.mockResolvedValueOnce('review-bot');

			await expect(resolvePersonaIdentities('project1')).rejects.toThrow(
				'Failed to resolve GitHub identity for GITHUB_TOKEN_IMPLEMENTER',
			);
		});

		it('throws when reviewer identity cannot be resolved', async () => {
			vi.mocked(getAgentCredential)
				.mockResolvedValueOnce('ghp_impl')
				.mockResolvedValueOnce('ghp_review');
			vi.mocked(getGitHubUserForToken)
				.mockResolvedValueOnce('impl-bot')
				.mockResolvedValueOnce(null); // reviewer resolution fails

			await expect(resolvePersonaIdentities('project1')).rejects.toThrow(
				'Failed to resolve GitHub identity for GITHUB_TOKEN_REVIEWER',
			);
		});
	});

	// ========================================================================
	// isCascadeBot
	// ========================================================================

	describe('isCascadeBot', () => {
		const identities: PersonaIdentities = {
			implementer: 'cascade-impl',
			reviewer: 'cascade-review',
		};

		it('detects implementer login', () => {
			expect(isCascadeBot('cascade-impl', identities)).toBe(true);
		});

		it('detects reviewer login', () => {
			expect(isCascadeBot('cascade-review', identities)).toBe(true);
		});

		it('detects implementer [bot] suffix', () => {
			expect(isCascadeBot('cascade-impl[bot]', identities)).toBe(true);
		});

		it('detects reviewer [bot] suffix', () => {
			expect(isCascadeBot('cascade-review[bot]', identities)).toBe(true);
		});

		it('rejects unrelated users', () => {
			expect(isCascadeBot('human-user', identities)).toBe(false);
			expect(isCascadeBot('some-other-bot', identities)).toBe(false);
		});

		it('is case-sensitive', () => {
			expect(isCascadeBot('CASCADE-IMPL', identities)).toBe(false);
			expect(isCascadeBot('Cascade-Review', identities)).toBe(false);
		});
	});

	// ========================================================================
	// getPersonaForLogin
	// ========================================================================

	describe('getPersonaForLogin', () => {
		const identities: PersonaIdentities = {
			implementer: 'cascade-impl',
			reviewer: 'cascade-review',
		};

		it('returns implementer for implementer login', () => {
			expect(getPersonaForLogin('cascade-impl', identities)).toBe('implementer');
		});

		it('returns reviewer for reviewer login', () => {
			expect(getPersonaForLogin('cascade-review', identities)).toBe('reviewer');
		});

		it('returns implementer for implementer [bot] login', () => {
			expect(getPersonaForLogin('cascade-impl[bot]', identities)).toBe('implementer');
		});

		it('returns reviewer for reviewer [bot] login', () => {
			expect(getPersonaForLogin('cascade-review[bot]', identities)).toBe('reviewer');
		});

		it('returns null for unknown login', () => {
			expect(getPersonaForLogin('human-user', identities)).toBeNull();
		});

		it('returns null for empty string', () => {
			expect(getPersonaForLogin('', identities)).toBeNull();
		});
	});
});
