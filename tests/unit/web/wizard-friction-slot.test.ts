/**
 * Regression pin: every PM provider wizard exposes an optional `friction`
 * status-mapping slot.
 *
 * Tests cover:
 *   1. Slot-array membership — the UI will render the input if the slot is present.
 *   2. Round-trip through buildIntegrationConfig — the value persists to config.
 *   3. Optionality — wizard completes without the friction slot being mapped.
 */

import { describe, expect, it } from 'vitest';
import { JIRA_STATUS_SLOTS } from '../../../web/src/components/projects/pm-providers/jira/wizard.js';
import { LINEAR_STATUS_SLOTS } from '../../../web/src/components/projects/pm-providers/linear/wizard.js';
import { TRELLO_LIST_SLOTS } from '../../../web/src/components/projects/pm-providers/trello/wizard.js';
import {
	buildJiraIntegrationConfig,
	buildLinearIntegrationConfig,
	buildTrelloIntegrationConfig,
	createInitialState,
} from '../../../web/src/components/projects/pm-wizard-state.js';

// ============================================================================
// 1. Slot-array membership
// ============================================================================

describe('status-mapping slot arrays include a friction entry', () => {
	it('TRELLO_LIST_SLOTS contains a friction entry', () => {
		expect(TRELLO_LIST_SLOTS).toContainEqual({ key: 'friction', label: 'Friction' });
	});

	it('JIRA_STATUS_SLOTS contains a friction entry', () => {
		expect(JIRA_STATUS_SLOTS).toContainEqual({ key: 'friction', label: 'Friction' });
	});

	it('LINEAR_STATUS_SLOTS contains a friction entry', () => {
		expect(LINEAR_STATUS_SLOTS).toContainEqual({ key: 'friction', label: 'Friction' });
	});
});

// ============================================================================
// 2. Round-trip through buildIntegrationConfig
// ============================================================================

describe('friction status slot round-trips through buildIntegrationConfig', () => {
	it('Trello: lists.friction propagates from trelloListMappings', () => {
		const state = {
			...createInitialState(),
			trelloListMappings: { friction: 'list-id-friction-123' },
		};
		const config = buildTrelloIntegrationConfig(state);
		expect((config.lists as Record<string, string>).friction).toBe('list-id-friction-123');
	});

	it('JIRA: statuses.friction propagates from jiraStatusMappings', () => {
		const state = {
			...createInitialState(),
			jiraStatusMappings: { friction: 'Friction Status' },
		};
		const config = buildJiraIntegrationConfig(state);
		expect((config.statuses as Record<string, string>).friction).toBe('Friction Status');
	});

	it('Linear: statuses.friction propagates from linearStatusMappings', () => {
		const state = {
			...createInitialState(),
			linearStatusMappings: { friction: 'state-uuid-friction' },
		};
		const config = buildLinearIntegrationConfig(state);
		expect((config.statuses as Record<string, string>).friction).toBe('state-uuid-friction');
	});
});

// ============================================================================
// 3. Optionality — wizard completes without friction slot
// ============================================================================

describe('friction slot is optional — wizard does not require it', () => {
	it('Trello: buildTrelloIntegrationConfig produces no friction entry when not mapped', () => {
		const state = {
			...createInitialState(),
			trelloListMappings: { todo: 'list-id-todo' },
		};
		const config = buildTrelloIntegrationConfig(state);
		expect((config.lists as Record<string, string>).friction).toBeUndefined();
	});

	it('JIRA: buildJiraIntegrationConfig produces no friction entry when not mapped', () => {
		const state = {
			...createInitialState(),
			jiraStatusMappings: { todo: 'To Do' },
		};
		const config = buildJiraIntegrationConfig(state);
		expect((config.statuses as Record<string, string>).friction).toBeUndefined();
	});

	it('Linear: buildLinearIntegrationConfig produces no friction entry when not mapped', () => {
		const state = {
			...createInitialState(),
			linearStatusMappings: { todo: 'state-uuid-todo' },
		};
		const config = buildLinearIntegrationConfig(state);
		expect((config.statuses as Record<string, string>).friction).toBeUndefined();
	});
});
