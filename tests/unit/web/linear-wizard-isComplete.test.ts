/**
 * Linear wizard — isComplete predicates for optional steps.
 *
 * Guards that optional steps (labels, project-scope, webhook) only show
 * green check marks after the required steps (credentials + team + status
 * mapping) are all complete. Prevents the UI bug where a brand-new
 * unconfigured integration showed every step as green.
 */

import { describe, expect, it } from 'vitest';
import { linearProviderWizard } from '../../../web/src/components/projects/pm-providers/linear/wizard.js';
import { createInitialState } from '../../../web/src/components/projects/pm-wizard-state.js';

const getStep = (id: string) => {
	const step = linearProviderWizard.steps.find((s) => s.id === id);
	if (!step) throw new Error(`Step ${id} not found`);
	return step;
};

describe('Linear optional steps — isComplete gating', () => {
	describe('fresh state (createInitialState)', () => {
		const state = createInitialState();

		it('linear-labels is NOT complete on fresh state', () => {
			expect(getStep('linear-labels').isComplete(state)).toBe(false);
		});

		it('linear-project-scope is NOT complete on fresh state', () => {
			expect(getStep('linear-project-scope').isComplete(state)).toBe(false);
		});

		it('linear-webhook is NOT complete on fresh state', () => {
			expect(getStep('linear-webhook').isComplete(state)).toBe(false);
		});
	});

	describe('partially configured (credentials only, no team)', () => {
		const state = {
			...createInitialState(),
			linearApiKey: 'lin_api_123',
			verificationResult: { provider: 'linear' as const, display: 'user@example.com' },
		};

		it('linear-labels is NOT complete when team not selected', () => {
			expect(getStep('linear-labels').isComplete(state)).toBe(false);
		});

		it('linear-project-scope is NOT complete when team not selected', () => {
			expect(getStep('linear-project-scope').isComplete(state)).toBe(false);
		});

		it('linear-webhook is NOT complete when team not selected', () => {
			expect(getStep('linear-webhook').isComplete(state)).toBe(false);
		});
	});

	describe('credentials + team, but no status mapping', () => {
		const state = {
			...createInitialState(),
			linearApiKey: 'lin_api_123',
			verificationResult: { provider: 'linear' as const, display: 'user@example.com' },
			linearTeamId: 'team-1',
			linearStatusMappings: {},
		};

		it('linear-labels is NOT complete without status mapping', () => {
			expect(getStep('linear-labels').isComplete(state)).toBe(false);
		});

		it('linear-project-scope is NOT complete without status mapping', () => {
			expect(getStep('linear-project-scope').isComplete(state)).toBe(false);
		});

		it('linear-webhook is NOT complete without status mapping', () => {
			expect(getStep('linear-webhook').isComplete(state)).toBe(false);
		});
	});

	describe('fully configured (credentials + team + status mapping)', () => {
		const state = {
			...createInitialState(),
			linearApiKey: 'lin_api_123',
			verificationResult: { provider: 'linear' as const, display: 'user@example.com' },
			linearTeamId: 'team-1',
			linearStatusMappings: { todo: 'state-uuid-1', inProgress: 'state-uuid-2' },
		};

		it('linear-labels is complete when all required steps done', () => {
			expect(getStep('linear-labels').isComplete(state)).toBe(true);
		});

		it('linear-project-scope is complete when all required steps done', () => {
			expect(getStep('linear-project-scope').isComplete(state)).toBe(true);
		});

		it('linear-webhook is complete when all required steps done', () => {
			expect(getStep('linear-webhook').isComplete(state)).toBe(true);
		});
	});

	describe('edit mode with stored credentials (isEditing + hasStoredCredentials)', () => {
		const state = {
			...createInitialState(),
			isEditing: true,
			hasStoredCredentials: true,
			linearTeamId: 'team-1',
			linearStatusMappings: { todo: 'state-uuid-1' },
		};

		it('linear-labels is complete in edit mode with stored credentials', () => {
			expect(getStep('linear-labels').isComplete(state)).toBe(true);
		});

		it('linear-project-scope is complete in edit mode with stored credentials', () => {
			expect(getStep('linear-project-scope').isComplete(state)).toBe(true);
		});

		it('linear-webhook is complete in edit mode with stored credentials', () => {
			expect(getStep('linear-webhook').isComplete(state)).toBe(true);
		});
	});
});
