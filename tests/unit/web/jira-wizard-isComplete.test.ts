/**
 * JIRA wizard — isComplete predicates for optional steps.
 *
 * Guards that optional steps (labels, custom-fields, issue-types, webhook)
 * only show green check marks after the required steps (credentials +
 * project + status mapping) are all complete. Prevents the UI bug where a
 * brand-new unconfigured integration showed every step as green.
 */

import { describe, expect, it } from 'vitest';
import { jiraProviderWizard } from '../../../web/src/components/projects/pm-providers/jira/wizard.js';
import { createInitialState } from '../../../web/src/components/projects/pm-wizard-state.js';

const getStep = (id: string) => {
	const step = jiraProviderWizard.steps.find((s) => s.id === id);
	if (!step) throw new Error(`Step ${id} not found`);
	return step;
};

describe('JIRA optional steps — isComplete gating', () => {
	describe('fresh state (createInitialState)', () => {
		const state = createInitialState();

		it('jira-labels is NOT complete on fresh state', () => {
			expect(getStep('jira-labels').isComplete(state)).toBe(false);
		});

		it('jira-custom-fields is NOT complete on fresh state', () => {
			expect(getStep('jira-custom-fields').isComplete(state)).toBe(false);
		});

		it('jira-issue-types is NOT complete on fresh state', () => {
			expect(getStep('jira-issue-types').isComplete(state)).toBe(false);
		});

		it('jira-webhook is NOT complete on fresh state', () => {
			expect(getStep('jira-webhook').isComplete(state)).toBe(false);
		});
	});

	describe('partially configured (credentials only, no project)', () => {
		const state = {
			...createInitialState(),
			jiraEmail: 'user@example.com',
			jiraApiToken: 'token123',
			jiraBaseUrl: 'https://example.atlassian.net',
			verificationResult: { provider: 'jira' as const, display: 'user@example.com' },
		};

		it('jira-labels is NOT complete when project not selected', () => {
			expect(getStep('jira-labels').isComplete(state)).toBe(false);
		});

		it('jira-custom-fields is NOT complete when project not selected', () => {
			expect(getStep('jira-custom-fields').isComplete(state)).toBe(false);
		});

		it('jira-issue-types is NOT complete when project not selected', () => {
			expect(getStep('jira-issue-types').isComplete(state)).toBe(false);
		});

		it('jira-webhook is NOT complete when project not selected', () => {
			expect(getStep('jira-webhook').isComplete(state)).toBe(false);
		});
	});

	describe('credentials + project, but no status mapping', () => {
		const state = {
			...createInitialState(),
			jiraEmail: 'user@example.com',
			jiraApiToken: 'token123',
			jiraBaseUrl: 'https://example.atlassian.net',
			verificationResult: { provider: 'jira' as const, display: 'user@example.com' },
			jiraProjectKey: 'PROJ',
			jiraStatusMappings: {},
		};

		it('jira-labels is NOT complete without status mapping', () => {
			expect(getStep('jira-labels').isComplete(state)).toBe(false);
		});

		it('jira-webhook is NOT complete without status mapping', () => {
			expect(getStep('jira-webhook').isComplete(state)).toBe(false);
		});
	});

	describe('fully configured (credentials + project + status mapping)', () => {
		const state = {
			...createInitialState(),
			jiraEmail: 'user@example.com',
			jiraApiToken: 'token123',
			jiraBaseUrl: 'https://example.atlassian.net',
			verificationResult: { provider: 'jira' as const, display: 'user@example.com' },
			jiraProjectKey: 'PROJ',
			jiraStatusMappings: { todo: 'To Do', inProgress: 'In Progress' },
		};

		it('jira-labels is complete when all required steps done', () => {
			expect(getStep('jira-labels').isComplete(state)).toBe(true);
		});

		it('jira-custom-fields is complete when all required steps done', () => {
			expect(getStep('jira-custom-fields').isComplete(state)).toBe(true);
		});

		it('jira-issue-types is complete when all required steps done', () => {
			expect(getStep('jira-issue-types').isComplete(state)).toBe(true);
		});

		it('jira-webhook is complete when all required steps done', () => {
			expect(getStep('jira-webhook').isComplete(state)).toBe(true);
		});
	});

	describe('edit mode with stored credentials (isEditing + hasStoredCredentials)', () => {
		const state = {
			...createInitialState(),
			isEditing: true,
			hasStoredCredentials: true,
			jiraProjectKey: 'PROJ',
			jiraStatusMappings: { todo: 'To Do' },
		};

		it('jira-labels is complete in edit mode with stored credentials', () => {
			expect(getStep('jira-labels').isComplete(state)).toBe(true);
		});

		it('jira-custom-fields is complete in edit mode with stored credentials', () => {
			expect(getStep('jira-custom-fields').isComplete(state)).toBe(true);
		});

		it('jira-issue-types is complete in edit mode with stored credentials', () => {
			expect(getStep('jira-issue-types').isComplete(state)).toBe(true);
		});

		it('jira-webhook is complete in edit mode with stored credentials', () => {
			expect(getStep('jira-webhook').isComplete(state)).toBe(true);
		});
	});
});
