import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	formatValidationErrors,
	getIntegrationRequirements,
	validateIntegrations,
} from '../../../../src/triggers/shared/integration-validation.js';

// Mock the integration registry
vi.mock('../../../../src/integrations/registry.js', () => ({
	integrationRegistry: {
		getByCategory: vi.fn(),
		getOrNull: vi.fn().mockReturnValue(null),
		register: vi.fn(),
		get: vi.fn(),
		all: vi.fn().mockReturnValue([]),
		hasIntegration: vi.fn().mockResolvedValue(false),
	},
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

import { getPersonaForAgentType } from '../../../../src/github/personas.js';
import { integrationRegistry } from '../../../../src/integrations/registry.js';

// Helper to create a mock integration module
function mockIntegration(opts: {
	type: string;
	category: string;
	hasIntegration?: boolean;
	hasPersonaToken?: boolean;
}) {
	const integration: {
		type: string;
		category: string;
		hasIntegration: ReturnType<typeof vi.fn>;
		hasPersonaToken?: ReturnType<typeof vi.fn>;
		withCredentials: ReturnType<typeof vi.fn>;
	} = {
		type: opts.type,
		category: opts.category,
		hasIntegration: vi.fn().mockResolvedValue(opts.hasIntegration ?? true),
		withCredentials: vi.fn(),
	};

	if (opts.category === 'scm') {
		integration.hasPersonaToken = vi.fn().mockResolvedValue(opts.hasPersonaToken ?? true);
	}

	return integration;
}

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
		beforeEach(() => {
			vi.mocked(getPersonaForAgentType).mockReturnValue('implementer');
		});

		describe('PM integration validation', () => {
			it('passes when PM integration is configured for agents requiring it', async () => {
				const pmIntegration = mockIntegration({
					type: 'trello',
					category: 'pm',
					hasIntegration: true,
				});
				const scmIntegration = mockIntegration({
					type: 'github',
					category: 'scm',
					hasIntegration: true,
					hasPersonaToken: true,
				});

				vi.mocked(integrationRegistry.getByCategory).mockImplementation((category) => {
					if (category === 'pm') return [pmIntegration as never];
					if (category === 'scm') return [scmIntegration as never];
					return [];
				});

				const result = await validateIntegrations('test-project', 'implementation');
				expect(result.valid).toBe(true);
				expect(result.errors).toEqual([]);
			});

			it('fails when PM integration is missing for agents requiring it', async () => {
				const pmIntegration = mockIntegration({
					type: 'trello',
					category: 'pm',
					hasIntegration: false,
				});
				const scmIntegration = mockIntegration({
					type: 'github',
					category: 'scm',
					hasIntegration: true,
					hasPersonaToken: true,
				});

				vi.mocked(integrationRegistry.getByCategory).mockImplementation((category) => {
					if (category === 'pm') return [pmIntegration as never];
					if (category === 'scm') return [scmIntegration as never];
					return [];
				});

				const result = await validateIntegrations('test-project', 'implementation');
				expect(result.valid).toBe(false);
				expect(result.errors).toHaveLength(1);
				expect(result.errors[0].category).toBe('pm');
				expect(result.errors[0].message).toContain('requires a PM integration');
			});

			it('passes for debug agent when only PM is configured', async () => {
				vi.mocked(integrationRegistry.getByCategory).mockReturnValue([]);

				const result = await validateIntegrations('test-project', 'debug');
				expect(result.valid).toBe(true);
				expect(result.errors).toEqual([]);
			});
		});

		describe('SCM integration validation', () => {
			it('passes when SCM integration and persona token are configured', async () => {
				const scmIntegration = mockIntegration({
					type: 'github',
					category: 'scm',
					hasIntegration: true,
					hasPersonaToken: true,
				});

				vi.mocked(integrationRegistry.getByCategory).mockImplementation((category) => {
					if (category === 'scm') return [scmIntegration as never];
					return [];
				});

				const result = await validateIntegrations('test-project', 'review');
				expect(result.valid).toBe(true);
				expect(result.errors).toEqual([]);
			});

			it('fails when SCM integration is missing', async () => {
				const scmIntegration = mockIntegration({
					type: 'github',
					category: 'scm',
					hasIntegration: false,
					hasPersonaToken: true,
				});

				vi.mocked(integrationRegistry.getByCategory).mockImplementation((category) => {
					if (category === 'scm') return [scmIntegration as never];
					return [];
				});

				const result = await validateIntegrations('test-project', 'review');
				expect(result.valid).toBe(false);
				expect(result.errors).toHaveLength(1);
				expect(result.errors[0].category).toBe('scm');
				expect(result.errors[0].message).toContain('requires SCM integration');
			});

			it('fails when persona token is missing', async () => {
				const scmIntegration = mockIntegration({
					type: 'github',
					category: 'scm',
					hasIntegration: true,
					hasPersonaToken: false,
				});

				vi.mocked(integrationRegistry.getByCategory).mockImplementation((category) => {
					if (category === 'scm') return [scmIntegration as never];
					return [];
				});

				const result = await validateIntegrations('test-project', 'review');
				expect(result.valid).toBe(false);
				expect(result.errors).toHaveLength(1);
				expect(result.errors[0].category).toBe('scm');
				expect(result.errors[0].message).toContain('token');
			});

			it('checks reviewer token for review agent', async () => {
				vi.mocked(getPersonaForAgentType).mockReturnValue('reviewer');

				const scmIntegration = mockIntegration({
					type: 'github',
					category: 'scm',
					hasIntegration: true,
					hasPersonaToken: false,
				});

				vi.mocked(integrationRegistry.getByCategory).mockImplementation((category) => {
					if (category === 'scm') return [scmIntegration as never];
					return [];
				});

				const result = await validateIntegrations('test-project', 'review');
				expect(result.valid).toBe(false);
				expect(result.errors[0].message).toContain('Reviewer token');
			});
		});

		describe('alerting integration validation', () => {
			it('fails when alerting integration is required but not configured', async () => {
				const alertingIntegration = mockIntegration({
					type: 'sentry',
					category: 'alerting',
					hasIntegration: false,
				});

				vi.mocked(integrationRegistry.getByCategory).mockImplementation((category) => {
					if (category === 'alerting') return [alertingIntegration as never];
					return [];
				});

				// Simulate an agent that requires alerting
				// We mock getIntegrationRequirements indirectly by using the alerting agent
				// For this test, we mock validateIntegrations to require alerting
				// by overriding getByCategory for the alerting category
				const result = await validateIntegrations('test-project', 'alerting');
				expect(result.valid).toBe(false);
				expect(result.errors).toHaveLength(1);
				expect(result.errors[0].category).toBe('alerting');
				expect(result.errors[0].message).toContain('alerting integration (Sentry)');
			});

			it('passes when alerting integration is required and configured', async () => {
				const alertingIntegration = mockIntegration({
					type: 'sentry',
					category: 'alerting',
					hasIntegration: true,
				});
				const scmIntegration = mockIntegration({
					type: 'github',
					category: 'scm',
					hasIntegration: true,
					hasPersonaToken: true,
				});
				const pmIntegration = mockIntegration({
					type: 'trello',
					category: 'pm',
					hasIntegration: true,
				});

				vi.mocked(integrationRegistry.getByCategory).mockImplementation((category) => {
					if (category === 'alerting') return [alertingIntegration as never];
					if (category === 'scm') return [scmIntegration as never];
					if (category === 'pm') return [pmIntegration as never];
					return [];
				});

				const result = await validateIntegrations('test-project', 'alerting');
				expect(result.valid).toBe(true);
				expect(result.errors).toEqual([]);
			});
		});

		describe('multiple missing integrations', () => {
			it('reports all missing integrations', async () => {
				const pmIntegration = mockIntegration({
					type: 'trello',
					category: 'pm',
					hasIntegration: false,
				});
				const scmIntegration = mockIntegration({
					type: 'github',
					category: 'scm',
					hasIntegration: false,
					hasPersonaToken: false,
				});

				vi.mocked(integrationRegistry.getByCategory).mockImplementation((category) => {
					if (category === 'pm') return [pmIntegration as never];
					if (category === 'scm') return [scmIntegration as never];
					return [];
				});

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
