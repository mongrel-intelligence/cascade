import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	formatValidationErrors,
	getIntegrationRequirements,
	validateIntegrations,
} from '../../../../src/triggers/shared/integration-validation.js';

// Mock the integration check functions
vi.mock('../../../../src/pm/integration.js', () => ({
	hasPmIntegration: vi.fn(),
}));

vi.mock('../../../../src/github/integration.js', () => ({
	hasScmIntegration: vi.fn(),
	hasScmPersonaToken: vi.fn(),
}));

vi.mock('../../../../src/github/personas.js', () => ({
	getPersonaForAgentType: vi.fn().mockReturnValue('implementer'),
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
	},
}));

import { hasScmIntegration, hasScmPersonaToken } from '../../../../src/github/integration.js';
import { getPersonaForAgentType } from '../../../../src/github/personas.js';
import { hasPmIntegration } from '../../../../src/pm/integration.js';

describe('integration-validation', () => {
	describe('getIntegrationRequirements', () => {
		it('returns integration requirements for implementation agent', async () => {
			const reqs = await getIntegrationRequirements('implementation');
			// Order may vary - check using set comparison
			expect(new Set(reqs.required)).toEqual(new Set(['pm', 'scm']));
			expect(reqs.optional).toEqual([]);
		});

		it('returns integration requirements for review agent', async () => {
			const reqs = await getIntegrationRequirements('review');
			expect(reqs.required).toEqual(['scm']);
			expect(reqs.optional).toEqual(['pm']);
		});

		it('returns integration requirements for debug agent', async () => {
			const reqs = await getIntegrationRequirements('debug');
			expect(reqs.required).toEqual([]);
			expect(reqs.optional).toEqual(['pm']);
		});

		it('rejects for unknown agent type', async () => {
			await expect(getIntegrationRequirements('nonexistent-agent')).rejects.toThrow(
				'Agent definition not found',
			);
		});
	});

	describe('validateIntegrations', () => {
		describe('PM integration validation', () => {
			it('passes when PM integration is configured for agents requiring it', async () => {
				vi.mocked(hasPmIntegration).mockResolvedValue(true);
				vi.mocked(hasScmIntegration).mockResolvedValue(true);
				vi.mocked(hasScmPersonaToken).mockResolvedValue(true);

				const result = await validateIntegrations('test-project', 'implementation');
				expect(result.valid).toBe(true);
				expect(result.errors).toEqual([]);
			});

			it('fails when PM integration is missing for agents requiring it', async () => {
				vi.mocked(hasPmIntegration).mockResolvedValue(false);
				vi.mocked(hasScmIntegration).mockResolvedValue(true);
				vi.mocked(hasScmPersonaToken).mockResolvedValue(true);

				const result = await validateIntegrations('test-project', 'implementation');
				expect(result.valid).toBe(false);
				expect(result.errors).toHaveLength(1);
				expect(result.errors[0].category).toBe('pm');
				expect(result.errors[0].message).toContain('requires a PM integration');
			});

			it('passes for debug agent when only PM is configured', async () => {
				vi.mocked(hasPmIntegration).mockResolvedValue(true);

				const result = await validateIntegrations('test-project', 'debug');
				expect(result.valid).toBe(true);
				expect(result.errors).toEqual([]);
			});
		});

		describe('SCM integration validation', () => {
			it('passes when SCM integration and persona token are configured', async () => {
				vi.mocked(hasScmIntegration).mockResolvedValue(true);
				vi.mocked(hasScmPersonaToken).mockResolvedValue(true);

				const result = await validateIntegrations('test-project', 'review');
				expect(result.valid).toBe(true);
				expect(result.errors).toEqual([]);
			});

			it('fails when SCM integration is missing', async () => {
				vi.mocked(hasScmIntegration).mockResolvedValue(false);

				const result = await validateIntegrations('test-project', 'review');
				expect(result.valid).toBe(false);
				expect(result.errors).toHaveLength(1);
				expect(result.errors[0].category).toBe('scm');
				expect(result.errors[0].message).toContain('requires SCM integration');
			});

			it('fails when persona token is missing', async () => {
				vi.mocked(hasScmIntegration).mockResolvedValue(true);
				vi.mocked(hasScmPersonaToken).mockResolvedValue(false);

				const result = await validateIntegrations('test-project', 'review');
				expect(result.valid).toBe(false);
				expect(result.errors).toHaveLength(1);
				expect(result.errors[0].category).toBe('scm');
				expect(result.errors[0].message).toContain('token');
			});

			it('checks reviewer token for review agent', async () => {
				vi.mocked(getPersonaForAgentType).mockReturnValue('reviewer');
				vi.mocked(hasScmIntegration).mockResolvedValue(true);
				vi.mocked(hasScmPersonaToken).mockResolvedValue(false);

				const result = await validateIntegrations('test-project', 'review');
				expect(result.valid).toBe(false);
				expect(result.errors[0].message).toContain('Reviewer token');
			});
		});

		describe('multiple missing integrations', () => {
			it('reports all missing integrations', async () => {
				vi.mocked(hasPmIntegration).mockResolvedValue(false);
				vi.mocked(hasScmIntegration).mockResolvedValue(false);

				const result = await validateIntegrations('test-project', 'implementation');
				expect(result.valid).toBe(false);
				expect(result.errors.length).toBeGreaterThanOrEqual(2);
				const categories = result.errors.map((e) => e.category);
				expect(categories).toContain('pm');
				expect(categories).toContain('scm');
			});
		});
	});

	describe('formatValidationErrors', () => {
		it('returns empty string for valid result', () => {
			const result = { valid: true, errors: [] };
			expect(formatValidationErrors(result)).toBe('');
		});

		it('formats single error correctly', () => {
			const result = {
				valid: false,
				errors: [{ category: 'pm' as const, message: 'PM integration missing' }],
			};
			const formatted = formatValidationErrors(result);
			expect(formatted).toContain('Integration validation failed');
			expect(formatted).toContain('PM integration missing');
			expect(formatted).toContain('Project Settings > Integrations');
		});

		it('formats multiple errors correctly', () => {
			const result = {
				valid: false,
				errors: [
					{ category: 'pm' as const, message: 'PM integration missing' },
					{ category: 'scm' as const, message: 'GitHub integration missing' },
				],
			};
			const formatted = formatValidationErrors(result);
			expect(formatted).toContain('PM integration missing');
			expect(formatted).toContain('GitHub integration missing');
		});
	});
});
