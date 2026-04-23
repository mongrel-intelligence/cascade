/**
 * Trello wizard — isComplete predicates for optional steps.
 *
 * Guards that optional steps (labels, custom-fields, webhook) only show
 * green check marks after the required steps (credentials + board + status
 * mapping) are all complete. Prevents the UI bug where a brand-new
 * unconfigured integration showed every step as green.
 */

import { describe, expect, it } from 'vitest';
import { trelloProviderWizard } from '../../../web/src/components/projects/pm-providers/trello/wizard.js';
import { createInitialState } from '../../../web/src/components/projects/pm-wizard-state.js';

// Grab the optional steps by id
const getStep = (id: string) => {
	const step = trelloProviderWizard.steps.find((s) => s.id === id);
	if (!step) throw new Error(`Step ${id} not found`);
	return step;
};

describe('Trello optional steps — isComplete gating', () => {
	describe('fresh state (createInitialState)', () => {
		const state = createInitialState();

		it('trello-labels is NOT complete on fresh state', () => {
			expect(getStep('trello-labels').isComplete(state)).toBe(false);
		});

		it('trello-custom-fields is NOT complete on fresh state', () => {
			expect(getStep('trello-custom-fields').isComplete(state)).toBe(false);
		});

		it('trello-webhook is NOT complete on fresh state', () => {
			expect(getStep('trello-webhook').isComplete(state)).toBe(false);
		});
	});

	describe('partially configured (credentials only, no board)', () => {
		const state = {
			...createInitialState(),
			trelloApiKey: 'key123',
			trelloToken: 'token123',
			verificationResult: { provider: 'trello' as const, display: 'user@example.com' },
		};

		it('trello-labels is NOT complete when board not selected', () => {
			expect(getStep('trello-labels').isComplete(state)).toBe(false);
		});

		it('trello-custom-fields is NOT complete when board not selected', () => {
			expect(getStep('trello-custom-fields').isComplete(state)).toBe(false);
		});

		it('trello-webhook is NOT complete when board not selected', () => {
			expect(getStep('trello-webhook').isComplete(state)).toBe(false);
		});
	});

	describe('credentials + board, but no status mapping', () => {
		const state = {
			...createInitialState(),
			trelloApiKey: 'key123',
			trelloToken: 'token123',
			verificationResult: { provider: 'trello' as const, display: 'user@example.com' },
			trelloBoardId: 'board-1',
			trelloListMappings: {},
		};

		it('trello-labels is NOT complete without status mapping', () => {
			expect(getStep('trello-labels').isComplete(state)).toBe(false);
		});

		it('trello-webhook is NOT complete without status mapping', () => {
			expect(getStep('trello-webhook').isComplete(state)).toBe(false);
		});
	});

	describe('fully configured (credentials + board + status mapping)', () => {
		const state = {
			...createInitialState(),
			trelloApiKey: 'key123',
			trelloToken: 'token123',
			verificationResult: { provider: 'trello' as const, display: 'user@example.com' },
			trelloBoardId: 'board-1',
			trelloListMappings: { todo: 'list-1', inProgress: 'list-2' },
		};

		it('trello-labels is complete when all required steps done', () => {
			expect(getStep('trello-labels').isComplete(state)).toBe(true);
		});

		it('trello-custom-fields is complete when all required steps done', () => {
			expect(getStep('trello-custom-fields').isComplete(state)).toBe(true);
		});

		it('trello-webhook is complete when all required steps done', () => {
			expect(getStep('trello-webhook').isComplete(state)).toBe(true);
		});
	});

	describe('edit mode with stored credentials (isEditing + hasStoredCredentials)', () => {
		const state = {
			...createInitialState(),
			isEditing: true,
			hasStoredCredentials: true,
			trelloBoardId: 'board-1',
			trelloListMappings: { todo: 'list-1' },
		};

		it('trello-labels is complete in edit mode with stored credentials', () => {
			expect(getStep('trello-labels').isComplete(state)).toBe(true);
		});

		it('trello-custom-fields is complete in edit mode with stored credentials', () => {
			expect(getStep('trello-custom-fields').isComplete(state)).toBe(true);
		});

		it('trello-webhook is complete in edit mode with stored credentials', () => {
			expect(getStep('trello-webhook').isComplete(state)).toBe(true);
		});
	});
});
