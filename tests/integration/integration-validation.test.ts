/**
 * Integration tests for the integration validation system.
 *
 * Tests the full validation pipeline against a real database:
 * - PM integration validation (Trello, JIRA)
 * - SCM integration validation (GitHub)
 * - Persona-specific token validation (implementer vs reviewer)
 * - Partial credential scenarios
 * - Error message formatting
 *
 * Unit tests (mocked) are in tests/unit/triggers/shared/integration-validation.test.ts
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasScmIntegration, hasScmPersonaToken } from '../../src/github/integration.js';
import { hasPmIntegration } from '../../src/pm/integration.js';
import {
	formatValidationErrors,
	getIntegrationRequirements,
	validateIntegrations,
} from '../../src/triggers/shared/integration-validation.js';
import { truncateAll } from './helpers/db.js';
import {
	seedCredential,
	seedGitHubIntegration,
	seedIntegration,
	seedIntegrationCredential,
	seedJiraIntegration,
	seedOrg,
	seedProject,
	seedTrelloIntegration,
} from './helpers/seed.js';

// Suppress logging during tests
vi.mock('../../src/utils/logging.js', () => ({
	logger: {
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
	},
}));

beforeAll(async () => {
	await truncateAll();
});

describe('Integration Validation (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// PM Integration Validation
	// =========================================================================

	describe('PM integration validation', () => {
		describe('Trello', () => {
			it('passes when Trello has complete credentials', async () => {
				await seedTrelloIntegration();

				const hasPM = await hasPmIntegration('test-project');
				expect(hasPM).toBe(true);

				// splitting requires only PM
				const result = await validateIntegrations('test-project', 'splitting');
				expect(result.valid).toBe(true);
				expect(result.errors).toEqual([]);
			});

			it('fails when Trello is missing api_key', async () => {
				await seedTrelloIntegration('test-project', { skipApiKey: true });

				const hasPM = await hasPmIntegration('test-project');
				expect(hasPM).toBe(false);

				const result = await validateIntegrations('test-project', 'splitting');
				expect(result.valid).toBe(false);
				expect(result.errors).toHaveLength(1);
				expect(result.errors[0].category).toBe('pm');
				expect(result.errors[0].message).toContain('PM integration');
			});

			it('fails when Trello is missing token', async () => {
				await seedTrelloIntegration('test-project', { skipToken: true });

				const hasPM = await hasPmIntegration('test-project');
				expect(hasPM).toBe(false);

				const result = await validateIntegrations('test-project', 'splitting');
				expect(result.valid).toBe(false);
				expect(result.errors).toHaveLength(1);
				expect(result.errors[0].category).toBe('pm');
			});
		});

		describe('JIRA', () => {
			it('passes when JIRA has complete credentials', async () => {
				await seedJiraIntegration();

				const hasPM = await hasPmIntegration('test-project');
				expect(hasPM).toBe(true);

				const result = await validateIntegrations('test-project', 'splitting');
				expect(result.valid).toBe(true);
			});

			it('fails when JIRA is missing email', async () => {
				await seedJiraIntegration('test-project', { skipEmail: true });

				const hasPM = await hasPmIntegration('test-project');
				expect(hasPM).toBe(false);

				const result = await validateIntegrations('test-project', 'splitting');
				expect(result.errors).toHaveLength(1);
				expect(result.valid).toBe(false);
				expect(result.errors[0].category).toBe('pm');
			});

			it('fails when JIRA is missing api_token', async () => {
				await seedJiraIntegration('test-project', { skipApiToken: true });

				const hasPM = await hasPmIntegration('test-project');
				expect(hasPM).toBe(false);

				const result = await validateIntegrations('test-project', 'splitting');
				expect(result.valid).toBe(false);
				expect(result.errors[0].category).toBe('pm');
				expect(result.errors).toHaveLength(1);
			});
		});

		it('fails when no PM integration at all', async () => {
			// Only seed SCM, no PM
			await seedGitHubIntegration();

			const hasPM = await hasPmIntegration('test-project');
			expect(hasPM).toBe(false);

			// implementation requires both PM and SCM
			const result = await validateIntegrations('test-project', 'implementation');
			expect(result.valid).toBe(false);
			const pmErrors = result.errors.filter((e) => e.category === 'pm');
			expect(pmErrors).toHaveLength(1);
		});
	});

	// =========================================================================
	// SCM Integration Validation
	// =========================================================================

	describe('SCM integration validation', () => {
		it('passes with both persona tokens configured', async () => {
			await seedTrelloIntegration();
			await seedGitHubIntegration();

			const hasSCM = await hasScmIntegration('test-project');
			expect(hasSCM).toBe(true);

			// implementation requires SCM + PM
			const result = await validateIntegrations('test-project', 'implementation');
			expect(result.valid).toBe(true);
		});

		it('passes with only implementer token (for hasScmIntegration check)', async () => {
			await seedGitHubIntegration('test-project', { skipReviewer: true });

			// hasScmIntegration returns true if at least one token exists
			const hasSCM = await hasScmIntegration('test-project');
			expect(hasSCM).toBe(true);
		});

		it('passes with only reviewer token (for hasScmIntegration check)', async () => {
			await seedGitHubIntegration('test-project', { skipImplementer: true });

			const hasSCM = await hasScmIntegration('test-project');
			expect(hasSCM).toBe(true);
		});

		it('fails when no SCM integration exists', async () => {
			// Only PM, no SCM
			await seedTrelloIntegration();

			const hasSCM = await hasScmIntegration('test-project');
			expect(hasSCM).toBe(false);

			// review agent requires SCM
			const result = await validateIntegrations('test-project', 'review');
			expect(result.valid).toBe(false);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].category).toBe('scm');
			expect(result.errors[0].message).toContain('SCM integration');
		});

		it('fails when SCM integration exists but no tokens linked', async () => {
			await seedIntegration({
				category: 'scm',
				provider: 'github',
			});

			const hasSCM = await hasScmIntegration('test-project');
			expect(hasSCM).toBe(false);
		});
	});

	// =========================================================================
	// Persona-Specific Token Validation
	// =========================================================================

	describe('persona-specific token validation', () => {
		describe('implementer persona agents', () => {
			// Agents that need implementer token:
			// splitting, planning, implementation, respond-to-review,
			// respond-to-ci, respond-to-pr-comment, respond-to-planning-comment, debug

			it('implementation agent passes with implementer token', async () => {
				await seedTrelloIntegration();
				await seedGitHubIntegration('test-project', { skipReviewer: true });

				const hasImpl = await hasScmPersonaToken('test-project', 'implementer');
				expect(hasImpl).toBe(true);

				const result = await validateIntegrations('test-project', 'implementation');
				expect(result.valid).toBe(true);
			});

			it('implementation agent fails without implementer token', async () => {
				await seedTrelloIntegration();
				await seedGitHubIntegration('test-project', { skipImplementer: true });

				const hasImpl = await hasScmPersonaToken('test-project', 'implementer');
				expect(hasImpl).toBe(false);

				const result = await validateIntegrations('test-project', 'implementation');
				expect(result.valid).toBe(false);
				expect(result.errors).toHaveLength(1);
				expect(result.errors[0].message).toContain('Implementer token');
			});

			// Use it.each() for the remaining implementer agents that require SCM
			// Note: splitting, planning, respond-to-planning-comment only need PM, not SCM
			const implementerAgents = ['respond-to-review', 'respond-to-ci', 'respond-to-pr-comment'];

			it.each(implementerAgents)('%s agent needs implementer token', async (agentType) => {
				await seedTrelloIntegration();
				await seedGitHubIntegration('test-project', { skipImplementer: true });

				const result = await validateIntegrations('test-project', agentType);
				expect(result.valid).toBe(false);
				expect(result.errors).toHaveLength(1);
				expect(result.errors[0].message).toContain('Implementer token');
			});
		});

		describe('reviewer persona agents', () => {
			it('review agent passes with reviewer token', async () => {
				await seedGitHubIntegration('test-project', { skipImplementer: true });

				const hasRev = await hasScmPersonaToken('test-project', 'reviewer');
				expect(hasRev).toBe(true);

				// review agent only requires SCM
				const result = await validateIntegrations('test-project', 'review');
				expect(result.valid).toBe(true);
			});

			it('review agent fails without reviewer token', async () => {
				await seedGitHubIntegration('test-project', { skipReviewer: true });

				const hasRev = await hasScmPersonaToken('test-project', 'reviewer');
				expect(hasRev).toBe(false);

				const result = await validateIntegrations('test-project', 'review');
				expect(result.valid).toBe(false);
				expect(result.errors).toHaveLength(1);
				expect(result.errors[0].message).toContain('Reviewer token');
			});
		});
	});

	// =========================================================================
	// Partial Credential Scenarios
	// =========================================================================

	describe('partial credential scenarios', () => {
		it('provider exists but no credentials are linked', async () => {
			// Create PM integration without linking any credentials
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-1', lists: {}, labels: {} },
			});

			const hasPM = await hasPmIntegration('test-project');
			expect(hasPM).toBe(false);
		});

		it('credential row exists but not linked to integration', async () => {
			// Create integration without linking credentials
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-1', lists: {}, labels: {} },
			});

			// Create credential rows but don't link them
			await seedCredential({ envVarKey: 'TRELLO_API_KEY', value: 'orphan-key' });
			await seedCredential({ envVarKey: 'TRELLO_TOKEN', value: 'orphan-token' });

			const hasPM = await hasPmIntegration('test-project');
			expect(hasPM).toBe(false);
		});

		it('only one of two required credentials is linked', async () => {
			const integ = await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-1', lists: {}, labels: {} },
			});

			// Link only api_key, not token
			const apiKey = await seedCredential({ envVarKey: 'TRELLO_API_KEY', value: 'key' });
			await seedIntegrationCredential({
				integrationId: integ.id,
				role: 'api_key',
				credentialId: apiKey.id,
			});

			const hasPM = await hasPmIntegration('test-project');
			expect(hasPM).toBe(false);
		});

		it('SCM integration exists but both tokens are missing', async () => {
			await seedGitHubIntegration('test-project', { skipImplementer: true, skipReviewer: true });

			const hasSCM = await hasScmIntegration('test-project');
			expect(hasSCM).toBe(false);
		});

		it('empty credential value is accepted (not treated as missing)', async () => {
			// Note: Current implementation does NOT treat empty strings as missing.
			// This test documents the actual behavior. If empty values should fail,
			// the credential resolution logic would need to be updated.
			const integ = await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-1', lists: {}, labels: {} },
			});

			// Link credentials but with empty value for api_key
			const apiKey = await seedCredential({ envVarKey: 'TRELLO_API_KEY', value: '' });
			const token = await seedCredential({ envVarKey: 'TRELLO_TOKEN', value: 'valid-token' });
			await seedIntegrationCredential({
				integrationId: integ.id,
				role: 'api_key',
				credentialId: apiKey.id,
			});
			await seedIntegrationCredential({
				integrationId: integ.id,
				role: 'token',
				credentialId: token.id,
			});

			// Empty credential value is currently accepted (both credentials linked)
			const hasPM = await hasPmIntegration('test-project');
			expect(hasPM).toBe(true);
		});
	});

	// =========================================================================
	// Error Message Verification
	// =========================================================================

	describe('error message format', () => {
		it('PM errors contain provider reference', async () => {
			const result = await validateIntegrations('test-project', 'splitting');
			expect(result.valid).toBe(false);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].message).toContain('PM integration (Trello/JIRA)');
		});

		it('SCM errors contain provider reference', async () => {
			const result = await validateIntegrations('test-project', 'review');
			expect(result.valid).toBe(false);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].message).toContain('SCM integration (GitHub)');
		});

		it('formatValidationErrors includes dashboard link', async () => {
			const result = await validateIntegrations('test-project', 'splitting');
			const formatted = formatValidationErrors(result);
			expect(formatted).toContain('Project Settings > Integrations');
		});

		it('formatValidationErrors lists all errors', async () => {
			// implementation needs both PM and SCM
			const result = await validateIntegrations('test-project', 'implementation');
			expect(result.errors.length).toBeGreaterThanOrEqual(2);

			const formatted = formatValidationErrors(result);
			expect(formatted).toContain('PM integration');
			expect(formatted).toContain('SCM integration');
		});

		it('token errors name the specific token', async () => {
			// SCM exists but only reviewer token (implementation needs implementer)
			await seedTrelloIntegration();
			await seedGitHubIntegration('test-project', { skipImplementer: true });

			const result = await validateIntegrations('test-project', 'implementation');
			expect(result.valid).toBe(false);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].message).toContain('Implementer token');
		});
	});

	// =========================================================================
	// Integration Requirements
	// =========================================================================

	describe('integration requirements', () => {
		it('implementation requires both scm and pm', async () => {
			const reqs = await getIntegrationRequirements('implementation');
			expect(reqs.required).toContain('scm');
			expect(reqs.required).toContain('pm');
		});

		it('review requires only scm with optional pm', async () => {
			const reqs = await getIntegrationRequirements('review');
			expect(reqs.required).toEqual(['scm']);
			expect(reqs.optional).toContain('pm');
		});

		it('debug has pm as optional (no required integrations)', async () => {
			const reqs = await getIntegrationRequirements('debug');
			expect(reqs.required).toEqual([]);
			expect(reqs.optional).toContain('pm');
		});
	});

	// =========================================================================
	// Multiple Missing Integrations
	// =========================================================================

	describe('multiple missing integrations', () => {
		it('reports all missing integrations for implementation agent', async () => {
			// No integrations at all
			const result = await validateIntegrations('test-project', 'implementation');
			expect(result.valid).toBe(false);

			const categories = result.errors.map((e) => e.category);
			expect(categories).toContain('pm');
			expect(categories).toContain('scm');
		});
	});

	// =========================================================================
	// Cross-Project Isolation
	// =========================================================================

	describe('cross-project isolation', () => {
		it('validates integrations per-project', async () => {
			// Create two projects
			await seedProject({ id: 'project-a', name: 'Project A', repo: 'owner/repo-a' });
			await seedProject({ id: 'project-b', name: 'Project B', repo: 'owner/repo-b' });

			// Only project-a has integrations
			await seedTrelloIntegration('project-a');
			await seedGitHubIntegration('project-a');

			const resultA = await validateIntegrations('project-a', 'implementation');
			expect(resultA.valid).toBe(true);

			const resultB = await validateIntegrations('project-b', 'implementation');
			expect(resultB.valid).toBe(false);
		});
	});
});
