/**
 * Unit tests for pure functions extracted in the pm-wizard-hooks refactor:
 *   - runPerLabelCreations (batch label creator with per-item error handling)
 *   - buildTrelloIntegrationConfig / buildJiraIntegrationConfig (pure config builders)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jiraProviderWizard } from '../../../web/src/components/projects/pm-providers/jira/wizard.js';
import { linearProviderWizard } from '../../../web/src/components/projects/pm-providers/linear/wizard.js';
import { trelloProviderWizard } from '../../../web/src/components/projects/pm-providers/trello/wizard.js';
import {
	buildCurrentUserDiscoveryRequest,
	buildIntegrationUpsertInput,
	buildPersistedCredentialInputs,
	buildProviderAuthArgFromMetadata,
	runPerLabelCreations,
} from '../../../web/src/components/projects/pm-wizard-hooks.js';
import type { WizardState } from '../../../web/src/components/projects/pm-wizard-state.js';
import {
	buildJiraIntegrationConfig,
	buildLinearIntegrationConfig,
	buildTrelloIntegrationConfig,
	createInitialState,
} from '../../../web/src/components/projects/pm-wizard-state.js';

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
// buildTrelloIntegrationConfig
// ============================================================================

describe('buildTrelloIntegrationConfig', () => {
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
		const config = buildTrelloIntegrationConfig(seed());
		expect(config).toEqual({
			boardId: 'board-abc',
			lists: { todo: 'list-1', done: 'list-2' },
			labels: { processing: 'label-x' },
		});
	});

	it('includes customFields when trelloCostFieldId is set', () => {
		const config = buildTrelloIntegrationConfig(seed({ trelloCostFieldId: 'cf-cost' }));
		expect(config.customFields).toEqual({ cost: 'cf-cost' });
	});

	it('omits customFields when trelloCostFieldId is empty', () => {
		const config = buildTrelloIntegrationConfig(seed({ trelloCostFieldId: '' }));
		expect(config).not.toHaveProperty('customFields');
	});

	it('passes through empty mappings', () => {
		const config = buildTrelloIntegrationConfig(
			seed({ trelloListMappings: {}, trelloLabelMappings: {} }),
		);
		expect(config.lists).toEqual({});
		expect(config.labels).toEqual({});
	});
});

// ============================================================================
// buildJiraIntegrationConfig
// ============================================================================

describe('buildJiraIntegrationConfig', () => {
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
		const config = buildJiraIntegrationConfig(seed());
		expect(config).toEqual({
			projectKey: 'PROJ',
			baseUrl: 'https://example.atlassian.net',
			statuses: { todo: 'To Do', done: 'Done' },
			labels: { processing: 'cascade-processing' },
		});
	});

	it('includes issueTypes when jiraIssueTypes non-empty', () => {
		const config = buildJiraIntegrationConfig(
			seed({ jiraIssueTypes: { task: 'Task', subtask: 'Sub-task' } }),
		);
		expect(config.issueTypes).toEqual({ task: 'Task', subtask: 'Sub-task' });
	});

	it('omits issueTypes when jiraIssueTypes is empty', () => {
		const config = buildJiraIntegrationConfig(seed({ jiraIssueTypes: {} }));
		expect(config).not.toHaveProperty('issueTypes');
	});

	it('omits labels when jiraLabels is empty', () => {
		const config = buildJiraIntegrationConfig(seed({ jiraLabels: {} }));
		expect(config).not.toHaveProperty('labels');
	});

	it('includes customFields when jiraCostFieldId set', () => {
		const config = buildJiraIntegrationConfig(seed({ jiraCostFieldId: 'customfield_10042' }));
		expect(config.customFields).toEqual({ cost: 'customfield_10042' });
	});

	it('omits customFields when jiraCostFieldId is empty', () => {
		const config = buildJiraIntegrationConfig(seed({ jiraCostFieldId: '' }));
		expect(config).not.toHaveProperty('customFields');
	});
});

// ============================================================================
// buildLinearIntegrationConfig (already tested in pm-wizard-state.test.ts;
// added here for cross-reference completeness)
// ============================================================================

describe('buildLinearIntegrationConfig', () => {
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
		const config = buildLinearIntegrationConfig(seed());
		expect(config).toEqual({ teamId: 'T1', statuses: { todo: 'S-TD' } });
	});

	it('includes projectId when linearProjectId is set', () => {
		const config = buildLinearIntegrationConfig(seed({ linearProjectId: 'P1' }));
		expect(config.projectId).toBe('P1');
	});

	it('omits projectId when linearProjectId is empty', () => {
		const config = buildLinearIntegrationConfig(seed({ linearProjectId: '' }));
		expect(config).not.toHaveProperty('projectId');
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
