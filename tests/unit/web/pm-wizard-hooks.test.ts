/**
 * Unit tests for pure functions extracted in the pm-wizard-hooks refactor:
 *   - buildProviderAuthArg (generic auth-arg builder for all three providers)
 *   - runPerLabelCreations (batch label creator with per-item error handling)
 *   - buildTrelloIntegrationConfig / buildJiraIntegrationConfig (pure config builders)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildProviderAuthArg,
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
// buildProviderAuthArg
// ============================================================================

describe('buildProviderAuthArg', () => {
	function trelloState(overrides: Partial<WizardState> = {}): WizardState {
		return { ...createInitialState(), provider: 'trello', ...overrides };
	}
	function jiraState(overrides: Partial<WizardState> = {}): WizardState {
		return { ...createInitialState(), provider: 'jira', ...overrides };
	}
	function linearState(overrides: Partial<WizardState> = {}): WizardState {
		return { ...createInitialState(), provider: 'linear', ...overrides };
	}

	// ── Edit mode — stored credentials path ──────────────────────────────
	it('trello: returns { projectId } in edit mode when stored creds and no raw key', () => {
		const state = trelloState({
			isEditing: true,
			hasStoredCredentials: true,
			trelloApiKey: '',
			trelloToken: '',
		});
		expect(buildProviderAuthArg(state, 'proj-1')).toEqual({ projectId: 'proj-1' });
	});

	it('jira: returns { projectId } in edit mode when stored creds and no raw token', () => {
		const state = jiraState({
			isEditing: true,
			hasStoredCredentials: true,
			jiraApiToken: '',
			jiraEmail: '',
		});
		expect(buildProviderAuthArg(state, 'proj-jira')).toEqual({ projectId: 'proj-jira' });
	});

	it('linear: returns { projectId } in edit mode when stored creds and no raw key', () => {
		const state = linearState({
			isEditing: true,
			hasStoredCredentials: true,
			linearApiKey: '',
		});
		expect(buildProviderAuthArg(state, 'proj-lin')).toEqual({ projectId: 'proj-lin' });
	});

	// ── Fresh setup — credentials path ──────────────────────────────────
	it('trello: returns credentials when api_key and token present (fresh setup)', () => {
		const state = trelloState({ trelloApiKey: 'key-abc', trelloToken: 'tok-xyz' });
		expect(buildProviderAuthArg(state, 'proj-1')).toEqual({
			credentials: { api_key: 'key-abc', token: 'tok-xyz' },
		});
	});

	it('jira: returns credentials when email + api_token + base_url present (fresh setup)', () => {
		const state = jiraState({
			jiraEmail: 'user@example.com',
			jiraApiToken: 'jira-tok',
			jiraBaseUrl: 'https://example.atlassian.net',
		});
		expect(buildProviderAuthArg(state, 'proj-j')).toEqual({
			credentials: {
				email: 'user@example.com',
				api_token: 'jira-tok',
				base_url: 'https://example.atlassian.net',
			},
		});
	});

	it('linear: returns credentials when api_key present (fresh setup)', () => {
		const state = linearState({ linearApiKey: 'lin_abc' });
		expect(buildProviderAuthArg(state, 'proj-l')).toEqual({
			credentials: { api_key: 'lin_abc' },
		});
	});

	// ── Edit mode — user re-typed key → use fresh credentials ───────────
	it('trello: uses fresh credentials when user re-typed api_key in edit mode', () => {
		const state = trelloState({
			isEditing: true,
			hasStoredCredentials: true,
			trelloApiKey: 'new-key',
			trelloToken: 'new-tok',
		});
		expect(buildProviderAuthArg(state, 'proj-1')).toEqual({
			credentials: { api_key: 'new-key', token: 'new-tok' },
		});
	});

	it('linear: uses fresh credentials when user re-typed api_key in edit mode', () => {
		const state = linearState({
			isEditing: true,
			hasStoredCredentials: true,
			linearApiKey: 'lin_fresh',
		});
		expect(buildProviderAuthArg(state, 'proj-l')).toEqual({
			credentials: { api_key: 'lin_fresh' },
		});
	});

	// ── Error cases ──────────────────────────────────────────────────────
	it('trello: throws when no api_key in fresh mode', () => {
		const state = trelloState({ trelloToken: 'tok' });
		expect(() => buildProviderAuthArg(state, 'proj-1')).toThrow(
			'Enter both credentials before verifying',
		);
	});

	it('trello: throws when no token in fresh mode', () => {
		const state = trelloState({ trelloApiKey: 'key' });
		expect(() => buildProviderAuthArg(state, 'proj-1')).toThrow(
			'Enter both credentials before verifying',
		);
	});

	it('jira: throws when no email in fresh mode', () => {
		const state = jiraState({ jiraApiToken: 'tok', jiraBaseUrl: 'https://x.atlassian.net' });
		expect(() => buildProviderAuthArg(state, 'proj-j')).toThrow(
			'Enter both credentials before verifying',
		);
	});

	it('jira: throws when no api_token in fresh mode', () => {
		const state = jiraState({ jiraEmail: 'u@x.com', jiraBaseUrl: 'https://x.atlassian.net' });
		expect(() => buildProviderAuthArg(state, 'proj-j')).toThrow(
			'Enter both credentials before verifying',
		);
	});

	it('linear: throws when no api_key in fresh mode', () => {
		const state = linearState({ linearApiKey: '' });
		expect(() => buildProviderAuthArg(state, 'proj-l')).toThrow(
			'Enter your API key before verifying',
		);
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
