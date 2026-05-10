/**
 * Regression pin: every PM provider wizard exposes an `alerts` status-mapping
 * slot and a `cascade-alert` / `cascadeAlert` label-mapping slot (spec 019).
 *
 * Tests cover:
 *   1. Slot-array membership — the UI will render the input if the slot is present.
 *   2. Round-trip through buildIntegrationConfig — the value persists to config.
 *   3. Optionality — wizard completes without the alerts slot being mapped.
 */

import { describe, expect, it } from 'vitest';
import {
	JIRA_LABEL_SLOTS,
	JIRA_STATUS_SLOTS,
	jiraProviderWizard,
} from '../../../web/src/components/projects/pm-providers/jira/wizard.js';
import {
	LINEAR_LABEL_SLOTS,
	LINEAR_STATUS_SLOTS,
	linearProviderWizard,
} from '../../../web/src/components/projects/pm-providers/linear/wizard.js';
import {
	TRELLO_LABEL_SLOTS,
	TRELLO_LIST_SLOTS,
	trelloProviderWizard,
} from '../../../web/src/components/projects/pm-providers/trello/wizard.js';
import { createInitialState } from '../../../web/src/components/projects/pm-wizard-state.js';

// ============================================================================
// 1. Slot-array membership
// ============================================================================

describe('status-mapping slot arrays include an alerts entry (spec 019)', () => {
	it('TRELLO_LIST_SLOTS contains an alerts entry', () => {
		expect(TRELLO_LIST_SLOTS.some((s) => s.key === 'alerts')).toBe(true);
	});

	it('JIRA_STATUS_SLOTS contains an alerts entry', () => {
		expect(JIRA_STATUS_SLOTS.some((s) => s.key === 'alerts')).toBe(true);
	});

	it('LINEAR_STATUS_SLOTS contains an alerts entry', () => {
		expect(LINEAR_STATUS_SLOTS.some((s) => s.key === 'alerts')).toBe(true);
	});
});

describe('label-mapping slot arrays include a cascade-alert / cascadeAlert entry (spec 019)', () => {
	it('TRELLO_LABEL_SLOTS contains a cascade-alert entry', () => {
		expect(TRELLO_LABEL_SLOTS.some((s) => s.key === 'cascade-alert')).toBe(true);
	});

	it('JIRA_LABEL_SLOTS contains a cascadeAlert entry', () => {
		expect(JIRA_LABEL_SLOTS.some((s) => s.key === 'cascadeAlert')).toBe(true);
	});

	it('LINEAR_LABEL_SLOTS contains a cascadeAlert entry', () => {
		expect(LINEAR_LABEL_SLOTS.some((s) => s.key === 'cascadeAlert')).toBe(true);
	});
});

// ============================================================================
// 2. Round-trip through buildIntegrationConfig
// ============================================================================

describe('alerts status slot round-trips through buildIntegrationConfig', () => {
	it('Trello: lists.alerts propagates from trelloListMappings', () => {
		const state = {
			...createInitialState(),
			trelloListMappings: { alerts: 'list-id-alerts-123' },
		};
		const config = trelloProviderWizard.buildIntegrationConfig(state);
		expect((config.lists as Record<string, string>).alerts).toBe('list-id-alerts-123');
	});

	it('JIRA: statuses.alerts propagates from jiraStatusMappings', () => {
		const state = {
			...createInitialState(),
			jiraStatusMappings: { alerts: 'Alerts Status' },
		};
		const config = jiraProviderWizard.buildIntegrationConfig(state);
		expect((config.statuses as Record<string, string>).alerts).toBe('Alerts Status');
	});

	it('Linear: statuses.alerts propagates from linearStatusMappings', () => {
		const state = {
			...createInitialState(),
			linearStatusMappings: { alerts: 'state-uuid-abc' },
		};
		const config = linearProviderWizard.buildIntegrationConfig(state);
		expect((config.statuses as Record<string, string>).alerts).toBe('state-uuid-abc');
	});
});

describe('cascade-alert label slot round-trips through buildIntegrationConfig', () => {
	it('Trello: labels[cascade-alert] propagates from trelloLabelMappings', () => {
		const state = {
			...createInitialState(),
			trelloLabelMappings: { 'cascade-alert': 'label-id-789' },
		};
		const config = trelloProviderWizard.buildIntegrationConfig(state);
		expect((config.labels as Record<string, string>)['cascade-alert']).toBe('label-id-789');
	});

	it('JIRA: labels.cascadeAlert propagates from jiraLabels', () => {
		const state = {
			...createInitialState(),
			jiraLabels: { cascadeAlert: 'cascade-alert-label' },
		};
		const config = jiraProviderWizard.buildIntegrationConfig(state);
		expect((config.labels as Record<string, string>).cascadeAlert).toBe('cascade-alert-label');
	});

	it('Linear: labels.cascadeAlert propagates from linearLabels', () => {
		const state = {
			...createInitialState(),
			linearLabels: { cascadeAlert: 'label-uuid-xyz' },
		};
		const config = linearProviderWizard.buildIntegrationConfig(state);
		expect((config.labels as Record<string, string>).cascadeAlert).toBe('label-uuid-xyz');
	});
});

// ============================================================================
// 3. Optionality — wizard completes without alerts slot
// ============================================================================

describe('alerts slot is optional — wizard does not require it', () => {
	it('Trello: provider buildIntegrationConfig produces no alerts entry when not mapped', () => {
		const state = {
			...createInitialState(),
			trelloListMappings: { todo: 'list-id-todo' },
		};
		const config = trelloProviderWizard.buildIntegrationConfig(state);
		expect((config.lists as Record<string, string>).alerts).toBeUndefined();
	});

	it('JIRA: provider buildIntegrationConfig produces no alerts entry when not mapped', () => {
		const state = {
			...createInitialState(),
			jiraStatusMappings: { todo: 'To Do' },
		};
		const config = jiraProviderWizard.buildIntegrationConfig(state);
		expect((config.statuses as Record<string, string>).alerts).toBeUndefined();
	});

	it('Linear: provider buildIntegrationConfig produces no alerts entry when not mapped', () => {
		const state = {
			...createInitialState(),
			linearStatusMappings: { todo: 'state-uuid-todo' },
		};
		const config = linearProviderWizard.buildIntegrationConfig(state);
		expect((config.statuses as Record<string, string>).alerts).toBeUndefined();
	});
});
