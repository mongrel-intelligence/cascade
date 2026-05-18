/**
 * Unit tests for pure functions extracted in the pm-wizard-hooks refactor:
 *   - runPerLabelCreations (batch label creator with per-item error handling)
 *   - provider-owned buildIntegrationConfig implementations
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jiraProviderWizard } from '../../../web/src/components/projects/pm-providers/jira/wizard.js';
import { linearProviderWizard } from '../../../web/src/components/projects/pm-providers/linear/wizard.js';
import { buildMissingStatusTriggerConfigs } from '../../../web/src/components/projects/pm-providers/save-trigger-configs.js';
import { trelloProviderWizard } from '../../../web/src/components/projects/pm-providers/trello/wizard.js';
import {
	buildCurrentUserDiscoveryRequest,
	buildIntegrationUpsertInput,
	buildPersistedCredentialInputs,
	buildProviderAuthArgFromMetadata,
	buildProviderCustomFieldCreationRequest,
	buildProviderLabelCreationRequest,
	runPerLabelCreations,
} from '../../../web/src/components/projects/pm-wizard-hooks.js';
import type { WizardState } from '../../../web/src/components/projects/pm-wizard-state.js';
import { createInitialState } from '../../../web/src/components/projects/pm-wizard-state.js';

// ============================================================================
// Provider-owned credential metadata
// ============================================================================

describe('provider credential metadata', () => {
	function trelloState(overrides: Partial<WizardState> = {}): WizardState {
		return { ...createInitialState(), provider: 'trello', ...overrides };
	}
	function jiraState(overrides: Partial<WizardState> = {}): WizardState {
		return { ...createInitialState(), provider: 'jira', ...overrides };
	}
	function linearState(overrides: Partial<WizardState> = {}): WizardState {
		return { ...createInitialState(), provider: 'linear', ...overrides };
	}

	it('builds stored credential fallback auth payloads from provider metadata', () => {
		expect(
			buildProviderAuthArgFromMetadata(
				trelloState({ isEditing: true, hasStoredCredentials: true, trelloApiKey: '' }),
				'proj-t',
				trelloProviderWizard.auth,
			),
		).toEqual({ projectId: 'proj-t' });
		expect(
			buildProviderAuthArgFromMetadata(
				jiraState({ isEditing: true, hasStoredCredentials: true, jiraEmail: '' }),
				'proj-j',
				jiraProviderWizard.auth,
			),
		).toEqual({ projectId: 'proj-j' });
		expect(
			buildProviderAuthArgFromMetadata(
				linearState({ isEditing: true, hasStoredCredentials: true, linearApiKey: '' }),
				'proj-l',
				linearProviderWizard.auth,
			),
		).toEqual({ projectId: 'proj-l' });
	});

	it('builds raw credential auth payloads from provider metadata', () => {
		expect(
			buildProviderAuthArgFromMetadata(
				trelloState({ trelloApiKey: 'key-abc', trelloToken: 'tok-xyz' }),
				'proj-t',
				trelloProviderWizard.auth,
			),
		).toEqual({ credentials: { api_key: 'key-abc', token: 'tok-xyz' } });
		expect(
			buildProviderAuthArgFromMetadata(
				jiraState({
					jiraEmail: 'user@example.com',
					jiraApiToken: 'jira-tok',
					jiraBaseUrl: 'https://example.atlassian.net',
				}),
				'proj-j',
				jiraProviderWizard.auth,
			),
		).toEqual({
			credentials: {
				email: 'user@example.com',
				api_token: 'jira-tok',
				base_url: 'https://example.atlassian.net',
			},
		});
		expect(
			buildProviderAuthArgFromMetadata(
				linearState({ linearApiKey: 'lin_abc' }),
				'proj-l',
				linearProviderWizard.auth,
			),
		).toEqual({ credentials: { api_key: 'lin_abc' } });
	});

	it('throws provider metadata errors when raw credentials are missing', () => {
		expect(() =>
			buildProviderAuthArgFromMetadata(
				trelloState({ trelloApiKey: 'key', trelloToken: '' }),
				'proj-t',
				trelloProviderWizard.auth,
			),
		).toThrow('Enter both credentials before verifying');
		expect(() =>
			buildProviderAuthArgFromMetadata(
				jiraState({ jiraEmail: 'user@example.com', jiraApiToken: 'tok', jiraBaseUrl: '' }),
				'proj-j',
				jiraProviderWizard.auth,
			),
		).toThrow('Enter both credentials before verifying');
		expect(() =>
			buildProviderAuthArgFromMetadata(
				linearState({ linearApiKey: '' }),
				'proj-l',
				linearProviderWizard.auth,
			),
		).toThrow('Enter your API key before verifying');
	});

	it('declares complete normal credential persistence metadata for each provider', () => {
		expect(trelloProviderWizard.credentialPersistence).toEqual([
			{ envVarKey: 'TRELLO_API_KEY', stateField: 'trelloApiKey', label: 'Trello API Key' },
			{ envVarKey: 'TRELLO_TOKEN', stateField: 'trelloToken', label: 'Trello Token' },
		]);
		expect(jiraProviderWizard.credentialPersistence).toEqual([
			{ envVarKey: 'JIRA_EMAIL', stateField: 'jiraEmail', label: 'JIRA Email' },
			{ envVarKey: 'JIRA_API_TOKEN', stateField: 'jiraApiToken', label: 'JIRA API Token' },
		]);
		expect(linearProviderWizard.credentialPersistence).toEqual([
			{ envVarKey: 'LINEAR_API_KEY', stateField: 'linearApiKey', label: 'Linear API Key' },
		]);
	});

	it('keeps config and webhook secrets out of normal credential persistence metadata', () => {
		expect(jiraProviderWizard.auth.rawCredentials.map((c) => c.role)).toEqual([
			'email',
			'api_token',
			'base_url',
		]);
		expect(jiraProviderWizard.credentialPersistence.map((c) => c.envVarKey)).not.toContain(
			'JIRA_BASE_URL',
		);
		expect(jiraProviderWizard.credentialPersistence.map((c) => c.envVarKey)).not.toContain(
			'JIRA_WEBHOOK_SECRET',
		);
		expect(linearProviderWizard.credentialPersistence.map((c) => c.envVarKey)).not.toContain(
			'LINEAR_WEBHOOK_SECRET',
		);
	});
});

describe('buildMissingStatusTriggerConfigs', () => {
	it('builds trigger configs for mapped workflow statuses with dispatch agents', () => {
		const result = buildMissingStatusTriggerConfigs({
			statusMappings: {
				prd: 'state-prd',
				done: 'state-done',
				story: '',
			},
			workflowStatuses: [
				{ key: 'prd', agentType: 'prd', isBuiltin: false },
				{ key: 'done', agentType: null, isBuiltin: true },
				{ key: 'story', agentType: 'story', isBuiltin: false },
			],
			existingConfigs: [],
		});

		expect(result).toEqual([
			{
				agentType: 'prd',
				triggerEvent: 'pm:status-changed',
				enabled: true,
			},
		]);
	});

	it('does not overwrite existing status trigger configs', () => {
		const result = buildMissingStatusTriggerConfigs({
			statusMappings: { prd: 'state-prd' },
			workflowStatuses: [{ key: 'prd', agentType: 'prd', isBuiltin: false }],
			existingConfigs: [{ agentType: 'prd', triggerEvent: 'pm:status-changed' }],
		});

		expect(result).toEqual([]);
	});

	it('auto-enables only allowlisted built-in status trigger configs', () => {
		const result = buildMissingStatusTriggerConfigs({
			statusMappings: {
				backlog: 'state-backlog',
				planning: 'state-planning',
				todo: 'state-todo',
				inReview: 'state-review',
			},
			workflowStatuses: [
				{ key: 'backlog', agentType: 'backlog-manager', isBuiltin: true },
				{ key: 'planning', agentType: 'planning', isBuiltin: true },
				{ key: 'todo', agentType: 'implementation', isBuiltin: true },
				{ key: 'inReview', agentType: null, isBuiltin: true },
			],
			existingConfigs: [],
		});

		expect(result).toEqual([
			{
				agentType: 'planning',
				triggerEvent: 'pm:status-changed',
				enabled: true,
			},
			{
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
				enabled: true,
			},
		]);
	});
});

// ============================================================================
// Metadata-driven verification
// ============================================================================

describe('metadata-driven verification request', () => {
	function trelloState(overrides: Partial<WizardState> = {}): WizardState {
		return { ...createInitialState(), provider: 'trello', ...overrides };
	}
	function jiraState(overrides: Partial<WizardState> = {}): WizardState {
		return { ...createInitialState(), provider: 'jira', ...overrides };
	}
	function linearState(overrides: Partial<WizardState> = {}): WizardState {
		return { ...createInitialState(), provider: 'linear', ...overrides };
	}

	it('builds stored-credential currentUser discovery requests from provider metadata', () => {
		expect(
			buildCurrentUserDiscoveryRequest(
				trelloState({ isEditing: true, hasStoredCredentials: true, trelloApiKey: '' }),
				'proj-t',
				trelloProviderWizard,
			),
		).toEqual({
			providerId: 'trello',
			capability: 'currentUser',
			args: {},
			projectId: 'proj-t',
		});
	});

	it('builds raw-credential currentUser discovery requests from provider metadata', () => {
		expect(
			buildCurrentUserDiscoveryRequest(
				jiraState({
					jiraEmail: 'user@example.com',
					jiraApiToken: 'jira-token',
					jiraBaseUrl: 'https://example.atlassian.net',
				}),
				'proj-j',
				jiraProviderWizard,
			),
		).toEqual({
			providerId: 'jira',
			capability: 'currentUser',
			args: {},
			credentials: {
				email: 'user@example.com',
				api_token: 'jira-token',
				base_url: 'https://example.atlassian.net',
			},
		});
		expect(
			buildCurrentUserDiscoveryRequest(
				linearState({ linearApiKey: 'lin-key' }),
				'proj-l',
				linearProviderWizard,
			),
		).toEqual({
			providerId: 'linear',
			capability: 'currentUser',
			args: {},
			credentials: { api_key: 'lin-key' },
		});
	});

	it('preserves provider-specific verified-as display formatting', () => {
		expect(
			trelloProviderWizard.formatVerificationDisplay({
				id: '1',
				name: 'Full Name',
				displayName: 'user',
			}),
		).toBe('@user (Full Name)');
		expect(
			jiraProviderWizard.formatVerificationDisplay({
				id: '2',
				name: 'Jira User',
				displayName: 'user@example.com',
			}),
		).toBe('Jira User (user@example.com)');
		expect(
			linearProviderWizard.formatVerificationDisplay({
				id: '3',
				name: 'Linear User',
				displayName: 'lin',
			}),
		).toBe('lin');
		expect(linearProviderWizard.formatVerificationDisplay({ id: '4', name: 'Linear User' })).toBe(
			'Linear User',
		);
	});
});

// ============================================================================
// Metadata-driven mutation requests
// ============================================================================

describe('metadata-driven mutation requests', () => {
	function trelloState(overrides: Partial<WizardState> = {}): WizardState {
		return { ...createInitialState(), provider: 'trello', trelloBoardId: 'board-1', ...overrides };
	}
	function jiraState(overrides: Partial<WizardState> = {}): WizardState {
		return { ...createInitialState(), provider: 'jira', jiraProjectKey: 'PROJ', ...overrides };
	}
	function linearState(overrides: Partial<WizardState> = {}): WizardState {
		return { ...createInitialState(), provider: 'linear', linearTeamId: 'team-1', ...overrides };
	}

	it('builds raw credential payloads for provider label creation', () => {
		expect(
			buildProviderLabelCreationRequest(
				{
					providerId: trelloProviderWizard.id,
					auth: trelloProviderWizard.auth,
					getContainerId: (state) => state.trelloBoardId,
					containerError: 'Board must be selected before creating a label',
				},
				trelloState({ trelloApiKey: 'key', trelloToken: 'token' }),
				'proj-t',
				{ name: 'cascade-ready', color: 'sky' },
			),
		).toEqual({
			providerId: 'trello',
			containerId: 'board-1',
			name: 'cascade-ready',
			color: 'sky',
			credentials: { api_key: 'key', token: 'token' },
		});
		expect(
			buildProviderLabelCreationRequest(
				{
					providerId: linearProviderWizard.id,
					auth: linearProviderWizard.auth,
					getContainerId: (state) => state.linearTeamId,
					containerError: 'Team must be selected before creating a label',
				},
				linearState({ linearApiKey: 'lin-key' }),
				'proj-l',
				{ name: 'cascade-ready', color: '#0284C7' },
			),
		).toEqual({
			providerId: 'linear',
			containerId: 'team-1',
			name: 'cascade-ready',
			color: '#0284C7',
			credentials: { api_key: 'lin-key' },
		});
	});

	it('builds stored credential fallback payloads for provider label creation', () => {
		expect(
			buildProviderLabelCreationRequest(
				{
					providerId: trelloProviderWizard.id,
					auth: trelloProviderWizard.auth,
					getContainerId: (state) => state.trelloBoardId,
					containerError: 'Board must be selected before creating a label',
				},
				trelloState({
					isEditing: true,
					hasStoredCredentials: true,
					trelloApiKey: '',
					trelloToken: '',
				}),
				'proj-t',
				{ name: 'cascade-ready', color: 'sky' },
			),
		).toMatchObject({ providerId: 'trello', projectId: 'proj-t' });
		expect(
			buildProviderLabelCreationRequest(
				{
					providerId: linearProviderWizard.id,
					auth: linearProviderWizard.auth,
					getContainerId: (state) => state.linearTeamId,
					containerError: 'Team must be selected before creating a label',
				},
				linearState({ isEditing: true, hasStoredCredentials: true, linearApiKey: '' }),
				'proj-l',
				{ name: 'cascade-ready', color: '#0284C7' },
			),
		).toMatchObject({ providerId: 'linear', projectId: 'proj-l' });
	});

	it('builds raw credential payloads for provider custom-field creation', () => {
		expect(
			buildProviderCustomFieldCreationRequest(
				{
					providerId: trelloProviderWizard.id,
					auth: trelloProviderWizard.auth,
					getContainerId: (state) => state.trelloBoardId,
					containerError: 'Board must be selected before creating a custom field',
				},
				trelloState({ trelloApiKey: 'key', trelloToken: 'token' }),
				'proj-t',
				{ name: 'Cost' },
			),
		).toEqual({
			providerId: 'trello',
			containerId: 'board-1',
			name: 'Cost',
			credentials: { api_key: 'key', token: 'token' },
		});
		expect(
			buildProviderCustomFieldCreationRequest(
				{
					providerId: jiraProviderWizard.id,
					auth: jiraProviderWizard.auth,
					getContainerId: (state) => state.jiraProjectKey || 'global',
				},
				jiraState({
					jiraEmail: 'user@example.com',
					jiraApiToken: 'jira-token',
					jiraBaseUrl: 'https://example.atlassian.net',
				}),
				'proj-j',
				{ name: 'Cost' },
			),
		).toEqual({
			providerId: 'jira',
			containerId: 'PROJ',
			name: 'Cost',
			credentials: {
				email: 'user@example.com',
				api_token: 'jira-token',
				base_url: 'https://example.atlassian.net',
			},
		});
	});

	it('builds stored credential fallback payloads for provider custom-field creation', () => {
		expect(
			buildProviderCustomFieldCreationRequest(
				{
					providerId: trelloProviderWizard.id,
					auth: trelloProviderWizard.auth,
					getContainerId: (state) => state.trelloBoardId,
					containerError: 'Board must be selected before creating a custom field',
				},
				trelloState({
					isEditing: true,
					hasStoredCredentials: true,
					trelloApiKey: '',
					trelloToken: '',
				}),
				'proj-t',
				{ name: 'Cost' },
			),
		).toMatchObject({ providerId: 'trello', projectId: 'proj-t' });
		expect(
			buildProviderCustomFieldCreationRequest(
				{
					providerId: jiraProviderWizard.id,
					auth: jiraProviderWizard.auth,
					getContainerId: (state) => state.jiraProjectKey || 'global',
				},
				jiraState({
					isEditing: true,
					hasStoredCredentials: true,
					jiraEmail: '',
					jiraApiToken: '',
				}),
				'proj-j',
				{ name: 'Cost' },
			),
		).toMatchObject({ providerId: 'jira', projectId: 'proj-j' });
	});

	it('throws metadata missing-credential errors for mutation requests', () => {
		expect(() =>
			buildProviderLabelCreationRequest(
				{
					providerId: linearProviderWizard.id,
					auth: linearProviderWizard.auth,
					getContainerId: (state) => state.linearTeamId,
					containerError: 'Team must be selected before creating a label',
				},
				linearState({ linearApiKey: '' }),
				'proj-l',
				{ name: 'cascade-ready' },
			),
		).toThrow('Enter your API key before verifying');
		expect(() =>
			buildProviderCustomFieldCreationRequest(
				{
					providerId: jiraProviderWizard.id,
					auth: jiraProviderWizard.auth,
					getContainerId: (state) => state.jiraProjectKey || 'global',
				},
				jiraState({ jiraEmail: 'user@example.com', jiraApiToken: 'tok', jiraBaseUrl: '' }),
				'proj-j',
				{ name: 'Cost' },
			),
		).toThrow('Enter both credentials before verifying');
	});
});

// ============================================================================
// Metadata-driven save
// ============================================================================

describe('metadata-driven save payloads', () => {
	function trelloState(overrides: Partial<WizardState> = {}): WizardState {
		return {
			...createInitialState(),
			provider: 'trello',
			trelloApiKey: 'key',
			trelloToken: 'token',
			trelloBoardId: 'board-1',
			trelloListMappings: { todo: 'list-todo' },
			...overrides,
		};
	}
	function jiraState(overrides: Partial<WizardState> = {}): WizardState {
		return {
			...createInitialState(),
			provider: 'jira',
			jiraEmail: 'user@example.com',
			jiraApiToken: 'jira-token',
			jiraBaseUrl: 'https://example.atlassian.net',
			jiraProjectKey: 'PROJ',
			jiraStatusMappings: { todo: 'To Do' },
			...overrides,
		};
	}

	it('persists integration config through manifestDef.buildIntegrationConfig', () => {
		const state = trelloState();
		expect(buildIntegrationUpsertInput('proj-1', state, trelloProviderWizard)).toEqual({
			projectId: 'proj-1',
			category: 'pm',
			provider: 'trello',
			config: {
				boardId: 'board-1',
				lists: { todo: 'list-todo' },
				labels: {},
			},
		});
	});

	it('persists credential values through provider credential metadata', () => {
		expect(buildPersistedCredentialInputs(trelloState(), trelloProviderWizard)).toEqual([
			{ envVarKey: 'TRELLO_API_KEY', value: 'key', name: 'Trello API Key' },
			{ envVarKey: 'TRELLO_TOKEN', value: 'token', name: 'Trello Token' },
		]);
		expect(buildPersistedCredentialInputs(jiraState(), jiraProviderWizard)).toEqual([
			{ envVarKey: 'JIRA_EMAIL', value: 'user@example.com', name: 'JIRA Email' },
			{ envVarKey: 'JIRA_API_TOKEN', value: 'jira-token', name: 'JIRA API Token' },
		]);
	});

	it('skips empty credential values so stored credentials remain untouched on edit', () => {
		expect(
			buildPersistedCredentialInputs(
				jiraState({
					isEditing: true,
					hasStoredCredentials: true,
					jiraEmail: '',
					jiraApiToken: '',
				}),
				jiraProviderWizard,
			),
		).toEqual([]);
	});
});

// ============================================================================
// trelloProviderWizard.buildIntegrationConfig
// ============================================================================

describe('trelloProviderWizard.buildIntegrationConfig', () => {
	function seed(overrides: Partial<WizardState> = {}): WizardState {
		return {
			...createInitialState(),
			provider: 'trello',
			trelloBoardId: 'board-abc',
			trelloListMappings: { todo: 'list-1', done: 'list-2' },
			trelloLabelMappings: { processing: 'label-x' },
			...overrides,
		};
	}

	it('produces the expected config shape', () => {
		const config = trelloProviderWizard.buildIntegrationConfig(seed());
		expect(config).toEqual({
			boardId: 'board-abc',
			lists: { todo: 'list-1', done: 'list-2' },
			labels: { processing: 'label-x' },
		});
	});

	it('includes customFields when trelloCostFieldId is set', () => {
		const config = trelloProviderWizard.buildIntegrationConfig(
			seed({ trelloCostFieldId: 'cf-cost' }),
		);
		expect(config.customFields).toEqual({ cost: 'cf-cost' });
	});

	it('omits customFields when trelloCostFieldId is empty', () => {
		const config = trelloProviderWizard.buildIntegrationConfig(seed({ trelloCostFieldId: '' }));
		expect(config).not.toHaveProperty('customFields');
	});

	it('passes through empty mappings', () => {
		const config = trelloProviderWizard.buildIntegrationConfig(
			seed({ trelloListMappings: {}, trelloLabelMappings: {} }),
		);
		expect(config.lists).toEqual({});
		expect(config.labels).toEqual({});
	});
});

// ============================================================================
// jiraProviderWizard.buildIntegrationConfig
// ============================================================================

describe('jiraProviderWizard.buildIntegrationConfig', () => {
	function seed(overrides: Partial<WizardState> = {}): WizardState {
		return {
			...createInitialState(),
			provider: 'jira',
			jiraProjectKey: 'PROJ',
			jiraBaseUrl: 'https://example.atlassian.net',
			jiraStatusMappings: { todo: 'To Do', done: 'Done' },
			jiraLabels: { processing: 'cascade-processing' },
			...overrides,
		};
	}

	it('produces the expected config shape', () => {
		const config = jiraProviderWizard.buildIntegrationConfig(seed());
		expect(config).toEqual({
			projectKey: 'PROJ',
			baseUrl: 'https://example.atlassian.net',
			statuses: { todo: 'To Do', done: 'Done' },
			labels: { processing: 'cascade-processing' },
		});
	});

	it('includes issueTypes when jiraIssueTypes non-empty', () => {
		const config = jiraProviderWizard.buildIntegrationConfig(
			seed({ jiraIssueTypes: { task: 'Task', subtask: 'Sub-task' } }),
		);
		expect(config.issueTypes).toEqual({ task: 'Task', subtask: 'Sub-task' });
	});

	it('omits issueTypes when jiraIssueTypes is empty', () => {
		const config = jiraProviderWizard.buildIntegrationConfig(seed({ jiraIssueTypes: {} }));
		expect(config).not.toHaveProperty('issueTypes');
	});

	it('omits labels when jiraLabels is empty', () => {
		const config = jiraProviderWizard.buildIntegrationConfig(seed({ jiraLabels: {} }));
		expect(config).not.toHaveProperty('labels');
	});

	it('includes customFields when jiraCostFieldId set', () => {
		const config = jiraProviderWizard.buildIntegrationConfig(
			seed({ jiraCostFieldId: 'customfield_10042' }),
		);
		expect(config.customFields).toEqual({ cost: 'customfield_10042' });
	});

	it('omits customFields when jiraCostFieldId is empty', () => {
		const config = jiraProviderWizard.buildIntegrationConfig(seed({ jiraCostFieldId: '' }));
		expect(config).not.toHaveProperty('customFields');
	});
});

// ============================================================================
// linearProviderWizard.buildIntegrationConfig
// ============================================================================

describe('linearProviderWizard.buildIntegrationConfig', () => {
	function seed(overrides: Partial<WizardState> = {}): WizardState {
		return {
			...createInitialState(),
			provider: 'linear',
			linearTeamId: 'T1',
			linearStatusMappings: { todo: 'S-TD' },
			linearLabels: {},
			...overrides,
		};
	}

	it('produces the expected config shape', () => {
		const config = linearProviderWizard.buildIntegrationConfig(seed());
		expect(config).toEqual({ teamId: 'T1', statuses: { todo: 'S-TD' } });
	});

	it('includes projectId when linearProjectId is set', () => {
		const config = linearProviderWizard.buildIntegrationConfig(seed({ linearProjectId: 'P1' }));
		expect(config.projectId).toBe('P1');
	});

	it('omits projectId when linearProjectId is empty', () => {
		const config = linearProviderWizard.buildIntegrationConfig(seed({ linearProjectId: '' }));
		expect(config).not.toHaveProperty('projectId');
	});
});

// ============================================================================
// trelloProviderWizard.buildSaveTriggerConfigs
// ============================================================================

describe('trelloProviderWizard.buildSaveTriggerConfigs', () => {
	function seed(overrides: Partial<WizardState> = {}): WizardState {
		return {
			...createInitialState(),
			provider: 'trello',
			trelloBoardId: 'board-1',
			trelloListMappings: { todo: 'list-todo' },
			...overrides,
		};
	}

	it('creates a status-changed trigger for a mapped custom status with a dispatch agent', () => {
		const configs = trelloProviderWizard.buildSaveTriggerConfigs?.({
			state: seed({
				trelloListMappings: {
					todo: 'list-todo',
					prd: 'list-prd',
				},
			}),
			workflowStatuses: [
				{ key: 'todo', agentType: 'implementation', isBuiltin: true },
				{ key: 'prd', agentType: 'prd', isBuiltin: false },
			],
			existingConfigs: [],
		});

		expect(configs).toEqual([
			{ agentType: 'implementation', triggerEvent: 'pm:status-changed', enabled: true },
			{ agentType: 'prd', triggerEvent: 'pm:status-changed', enabled: true },
		]);
	});

	it('does not overwrite existing trigger configs', () => {
		const configs = trelloProviderWizard.buildSaveTriggerConfigs?.({
			state: seed({
				trelloListMappings: {
					todo: 'list-todo',
					prd: 'list-prd',
				},
			}),
			workflowStatuses: [
				{ key: 'todo', agentType: 'implementation', isBuiltin: true },
				{ key: 'prd', agentType: 'prd', isBuiltin: false },
			],
			existingConfigs: [{ agentType: 'prd', triggerEvent: 'pm:status-changed' }],
		});

		expect(configs).toEqual([
			{ agentType: 'implementation', triggerEvent: 'pm:status-changed', enabled: true },
		]);
	});

	it('preserves built-in splitting/planning/todo defaults when mapped', () => {
		const configs = trelloProviderWizard.buildSaveTriggerConfigs?.({
			state: seed({
				trelloListMappings: {
					splitting: 'list-splitting',
					planning: 'list-planning',
					todo: 'list-todo',
				},
			}),
			workflowStatuses: [
				{ key: 'splitting', agentType: 'splitting', isBuiltin: true },
				{ key: 'planning', agentType: 'planning', isBuiltin: true },
				{ key: 'todo', agentType: 'implementation', isBuiltin: true },
			],
			existingConfigs: [],
		});

		expect(configs).toEqual([
			{ agentType: 'splitting', triggerEvent: 'pm:status-changed', enabled: true },
			{ agentType: 'planning', triggerEvent: 'pm:status-changed', enabled: true },
			{ agentType: 'implementation', triggerEvent: 'pm:status-changed', enabled: true },
		]);
	});

	it('does not create a config for a status with no agentType', () => {
		const configs = trelloProviderWizard.buildSaveTriggerConfigs?.({
			state: seed({
				trelloListMappings: {
					alerts: 'list-alerts',
					friction: 'list-friction',
				},
			}),
			workflowStatuses: [
				{ key: 'alerts', agentType: null, isBuiltin: true },
				{ key: 'friction', agentType: null, isBuiltin: true },
			],
			existingConfigs: [],
		});

		expect(configs).toEqual([]);
	});
});

// ============================================================================
// jiraProviderWizard.buildSaveTriggerConfigs
// ============================================================================

describe('jiraProviderWizard.buildSaveTriggerConfigs', () => {
	function seed(overrides: Partial<WizardState> = {}): WizardState {
		return {
			...createInitialState(),
			provider: 'jira',
			jiraProjectKey: 'PROJ',
			jiraStatusMappings: { todo: 'To Do' },
			...overrides,
		};
	}

	it('creates a status-changed trigger for a mapped custom status with a dispatch agent', () => {
		const configs = jiraProviderWizard.buildSaveTriggerConfigs?.({
			state: seed({
				jiraStatusMappings: {
					todo: 'To Do',
					prd: 'PRD',
				},
			}),
			workflowStatuses: [
				{ key: 'todo', agentType: 'implementation', isBuiltin: true },
				{ key: 'prd', agentType: 'prd', isBuiltin: false },
			],
			existingConfigs: [],
		});

		expect(configs).toEqual([
			{ agentType: 'implementation', triggerEvent: 'pm:status-changed', enabled: true },
			{ agentType: 'prd', triggerEvent: 'pm:status-changed', enabled: true },
		]);
	});

	it('does not overwrite existing trigger configs', () => {
		const configs = jiraProviderWizard.buildSaveTriggerConfigs?.({
			state: seed({
				jiraStatusMappings: {
					todo: 'To Do',
					prd: 'PRD',
				},
			}),
			workflowStatuses: [
				{ key: 'todo', agentType: 'implementation', isBuiltin: true },
				{ key: 'prd', agentType: 'prd', isBuiltin: false },
			],
			existingConfigs: [{ agentType: 'prd', triggerEvent: 'pm:status-changed' }],
		});

		expect(configs).toEqual([
			{ agentType: 'implementation', triggerEvent: 'pm:status-changed', enabled: true },
		]);
	});

	it('preserves built-in splitting/planning/todo defaults when mapped', () => {
		const configs = jiraProviderWizard.buildSaveTriggerConfigs?.({
			state: seed({
				jiraStatusMappings: {
					splitting: 'Splitting',
					planning: 'Planning',
					todo: 'To Do',
				},
			}),
			workflowStatuses: [
				{ key: 'splitting', agentType: 'splitting', isBuiltin: true },
				{ key: 'planning', agentType: 'planning', isBuiltin: true },
				{ key: 'todo', agentType: 'implementation', isBuiltin: true },
			],
			existingConfigs: [],
		});

		expect(configs).toEqual([
			{ agentType: 'splitting', triggerEvent: 'pm:status-changed', enabled: true },
			{ agentType: 'planning', triggerEvent: 'pm:status-changed', enabled: true },
			{ agentType: 'implementation', triggerEvent: 'pm:status-changed', enabled: true },
		]);
	});

	it('does not create a config for a status with no agentType', () => {
		const configs = jiraProviderWizard.buildSaveTriggerConfigs?.({
			state: seed({
				jiraStatusMappings: {
					alerts: 'Alerts',
					friction: 'Friction',
				},
			}),
			workflowStatuses: [
				{ key: 'alerts', agentType: null, isBuiltin: true },
				{ key: 'friction', agentType: null, isBuiltin: true },
			],
			existingConfigs: [],
		});

		expect(configs).toEqual([]);
	});
});

// ============================================================================
// runPerLabelCreations
// ============================================================================

const { mockCreateLabel } = vi.hoisted(() => ({
	mockCreateLabel: vi.fn(),
}));

vi.mock('../../../web/src/lib/trpc.js', () => ({
	trpcClient: {
		pm: {
			discovery: {
				createLabel: { mutate: mockCreateLabel },
			},
		},
	},
	trpc: {},
}));

describe('runPerLabelCreations', () => {
	beforeEach(() => {
		mockCreateLabel.mockReset();
	});

	it('returns successes when all labels created', async () => {
		mockCreateLabel
			.mockResolvedValueOnce({ id: 'lbl-1', name: 'cascade-ready', color: 'sky' })
			.mockResolvedValueOnce({ id: 'lbl-2', name: 'cascade-processing', color: 'blue' });

		const result = await runPerLabelCreations({
			labelsToCreate: [
				{ slot: 'readyToProcess', name: 'cascade-ready', color: 'sky' },
				{ slot: 'processing', name: 'cascade-processing', color: 'blue' },
			],
			providerId: 'trello',
			containerId: 'board-1',
			authArg: { credentials: { api_key: 'k', token: 't' } },
		});

		expect(result.successes).toHaveLength(2);
		expect(result.errors).toHaveLength(0);
		expect(result.successes[0]).toEqual({ id: 'lbl-1', name: 'cascade-ready', color: 'sky' });
		expect(result.successes[1]).toEqual({
			id: 'lbl-2',
			name: 'cascade-processing',
			color: 'blue',
		});
	});

	it('collects per-item errors without aborting remaining items', async () => {
		mockCreateLabel
			.mockRejectedValueOnce(new Error('rate limit'))
			.mockResolvedValueOnce({ id: 'lbl-2', name: 'cascade-processing', color: 'blue' });

		const result = await runPerLabelCreations({
			labelsToCreate: [
				{ slot: 'readyToProcess', name: 'cascade-ready', color: 'sky' },
				{ slot: 'processing', name: 'cascade-processing', color: 'blue' },
			],
			providerId: 'trello',
			containerId: 'board-1',
			authArg: { projectId: 'proj-1' },
		});

		expect(result.successes).toHaveLength(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toEqual({ name: 'cascade-ready', error: 'rate limit' });
		expect(result.successes[0].name).toBe('cascade-processing');
	});

	it('returns empty arrays when labelsToCreate is empty', async () => {
		const result = await runPerLabelCreations({
			labelsToCreate: [],
			providerId: 'linear',
			containerId: 'team-1',
			authArg: { credentials: { api_key: 'lin_key' } },
		});

		expect(result.successes).toHaveLength(0);
		expect(result.errors).toHaveLength(0);
		expect(mockCreateLabel).not.toHaveBeenCalled();
	});

	it('passes the correct arguments to the tRPC mutation', async () => {
		mockCreateLabel.mockResolvedValueOnce({ id: 'lbl-1', name: 'my-label', color: 'green' });

		await runPerLabelCreations({
			labelsToCreate: [{ slot: 'processed', name: 'my-label', color: 'green' }],
			providerId: 'linear',
			containerId: 'team-abc',
			authArg: { credentials: { api_key: 'lin_key' } },
		});

		expect(mockCreateLabel).toHaveBeenCalledWith({
			providerId: 'linear',
			containerId: 'team-abc',
			name: 'my-label',
			color: 'green',
			credentials: { api_key: 'lin_key' },
		});
	});

	it('converts non-Error rejections to string errors', async () => {
		mockCreateLabel.mockRejectedValueOnce('some string error');

		const result = await runPerLabelCreations({
			labelsToCreate: [{ slot: 'auto', name: 'cascade-auto', color: 'purple' }],
			providerId: 'trello',
			containerId: 'board-1',
			authArg: { projectId: 'proj-1' },
		});

		expect(result.errors[0].error).toBe('some string error');
	});
});
