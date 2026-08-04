/**
 * MNG-1768: JIRA status mappings persist locale-invariant status IDs, and
 * legacy name-valued configs auto-upgrade to IDs when project details load.
 */

import { describe, expect, it } from 'vitest';
import {
	createInitialJiraState,
	type JiraProjectDetails,
	jiraWizardReducer,
	normalizeJiraStatusMappingsToIds,
} from '../../../web/src/components/projects/pm-providers/jira/state.js';

const DISCOVERED_STATUSES = [
	{ id: '10000', name: 'Backlog' },
	{ id: '10005', name: 'Splitting' },
	{ id: '10010', name: 'To Do' },
	{ id: '10011', name: 'Done' },
];

function makeDetails(overrides?: Partial<JiraProjectDetails>): JiraProjectDetails {
	return {
		statuses: DISCOVERED_STATUSES,
		issueTypes: [],
		fields: [],
		...overrides,
	};
}

function baseState() {
	return {
		...createInitialJiraState(),
		verificationResult: null as { provider: string; display: string } | null,
		verifyError: null as string | null,
	};
}

describe('normalizeJiraStatusMappingsToIds (MNG-1768)', () => {
	it('rewrites name-valued mappings to their status ID (case-insensitive)', () => {
		const result = normalizeJiraStatusMappingsToIds(
			{ todo: 'To Do', done: 'done' },
			DISCOVERED_STATUSES,
		);
		expect(result).toEqual({ todo: '10010', done: '10011' });
	});

	it('leaves values that are already IDs untouched', () => {
		const mappings = { todo: '10010', done: '10011' };
		const result = normalizeJiraStatusMappingsToIds(mappings, DISCOVERED_STATUSES);
		expect(result).toEqual(mappings);
		// Unchanged → same reference (no needless re-render churn).
		expect(result).toBe(mappings);
	});

	it('leaves unknown custom names untouched', () => {
		const result = normalizeJiraStatusMappingsToIds(
			{ prd: 'Some Custom Status', todo: 'To Do' },
			DISCOVERED_STATUSES,
		);
		expect(result).toEqual({ prd: 'Some Custom Status', todo: '10010' });
	});

	it('returns the input unchanged when no statuses are discovered yet', () => {
		const mappings = { todo: 'To Do' };
		expect(normalizeJiraStatusMappingsToIds(mappings, [])).toBe(mappings);
	});
});

describe('SET_JIRA_STATUS_MAPPING persists the selected value (status ID)', () => {
	it('stores the value passed by the select (the status ID)', () => {
		const next = jiraWizardReducer(baseState(), {
			type: 'SET_JIRA_STATUS_MAPPING',
			key: 'todo',
			value: '10010',
		});
		expect(next.jiraStatusMappings.todo).toBe('10010');
	});
});

describe('SET_JIRA_PROJECT_DETAILS auto-migrates legacy name mappings to IDs', () => {
	it('upgrades a legacy name-valued mapping to its ID when details load', () => {
		const state = {
			...baseState(),
			jiraStatusMappings: { todo: 'To Do', done: 'Done' },
		};

		const next = jiraWizardReducer(state, {
			type: 'SET_JIRA_PROJECT_DETAILS',
			details: makeDetails(),
		});

		expect(next.jiraStatusMappings).toEqual({ todo: '10010', done: '10011' });
	});

	it('leaves already-id and unknown-custom mappings untouched on details load', () => {
		const state = {
			...baseState(),
			jiraStatusMappings: { todo: '10010', prd: 'Custom Thing' },
		};

		const next = jiraWizardReducer(state, {
			type: 'SET_JIRA_PROJECT_DETAILS',
			details: makeDetails(),
		});

		expect(next.jiraStatusMappings).toEqual({ todo: '10010', prd: 'Custom Thing' });
	});

	it('still stores the loaded project details', () => {
		const details = makeDetails();
		const next = jiraWizardReducer(baseState(), {
			type: 'SET_JIRA_PROJECT_DETAILS',
			details,
		});
		expect(next.jiraProjectDetails).toBe(details);
	});
});
