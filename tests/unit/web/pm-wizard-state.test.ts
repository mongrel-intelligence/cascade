import { describe, expect, it } from 'vitest';
import {
	createInitialJiraState,
	INITIAL_JIRA_LABELS as PROVIDER_INITIAL_JIRA_LABELS,
	resetJiraProjectState,
} from '../../../web/src/components/projects/pm-providers/jira/state.js';
import {
	createInitialLinearState,
	INITIAL_LINEAR_LABELS,
	resetLinearTeamState,
} from '../../../web/src/components/projects/pm-providers/linear/state.js';
import {
	createInitialTrelloState,
	resetTrelloBoardState,
} from '../../../web/src/components/projects/pm-providers/trello/state.js';
import type {
	WizardAction,
	WizardState,
} from '../../../web/src/components/projects/pm-wizard-state.js';
import {
	areCredentialsReady,
	buildEditState,
	buildLinearIntegrationConfig,
	createInitialState,
	deriveActiveWebhooks,
	INITIAL_JIRA_LABELS,
	isStep1Complete,
	isStep2Complete,
	isStep3Complete,
	isStep4Complete,
	shouldUseStoredCredentials,
	wizardReducer,
} from '../../../web/src/components/projects/pm-wizard-state.js';

// ============================================================================
// createInitialState
// ============================================================================

describe('createInitialState', () => {
	it('returns a valid initial state with trello as default provider', () => {
		const state = createInitialState();
		expect(state.provider).toBe('trello');
		expect(state.trelloApiKey).toBe('');
		expect(state.trelloToken).toBe('');
		expect(state.jiraEmail).toBe('');
		expect(state.jiraApiToken).toBe('');
		expect(state.jiraBaseUrl).toBe('');
		expect(state.verificationResult).toBeNull();
		expect(state.verifyError).toBeNull();
		expect(state.trelloBoardId).toBe('');
		expect(state.trelloBoards).toEqual([]);
		expect(state.jiraProjectKey).toBe('');
		expect(state.jiraProjects).toEqual([]);
		expect(state.trelloBoardDetails).toBeNull();
		expect(state.jiraProjectDetails).toBeNull();
		expect(state.trelloListMappings).toEqual({});
		expect(state.trelloLabelMappings).toEqual({});
		expect(state.trelloCostFieldId).toBe('');
		expect(state.jiraStatusMappings).toEqual({});
		expect(state.jiraIssueTypes).toEqual({});
		expect(state.jiraLabels).toEqual(INITIAL_JIRA_LABELS);
		expect(state.jiraCostFieldId).toBe('');
		expect(state.isEditing).toBe(false);
		expect(state.previousProvider).toBeUndefined();
	});

	it('composes provider-owned initial state slices', () => {
		const state = createInitialState();
		expect(state).toMatchObject({
			...createInitialTrelloState(),
			...createInitialJiraState(),
			...createInitialLinearState(),
		});
	});
});

// ============================================================================
// Provider state slices
// ============================================================================

describe('provider state slices', () => {
	it('owns the Trello initial state defaults', () => {
		expect(createInitialTrelloState()).toEqual({
			trelloApiKey: '',
			trelloToken: '',
			trelloBoardId: '',
			trelloBoards: [],
			trelloBoardDetails: null,
			trelloListMappings: {},
			trelloLabelMappings: {},
			trelloCostFieldId: '',
		});
	});

	it('owns the JIRA initial state defaults', () => {
		expect(createInitialJiraState()).toEqual({
			jiraEmail: '',
			jiraApiToken: '',
			jiraBaseUrl: '',
			jiraProjectKey: '',
			jiraProjects: [],
			jiraProjectDetails: null,
			jiraStatusMappings: {},
			jiraIssueTypes: {},
			jiraLabels: PROVIDER_INITIAL_JIRA_LABELS,
			jiraCostFieldId: '',
		});
	});

	it('owns the Linear initial state defaults', () => {
		expect(createInitialLinearState()).toEqual({
			linearApiKey: '',
			linearTeamId: '',
			linearTeams: [],
			linearProjectId: '',
			linearProjects: [],
			linearTeamDetails: null,
			linearStatusMappings: {},
			linearLabels: INITIAL_LINEAR_LABELS,
		});
	});

	it('captures Trello board-change reset behavior', () => {
		expect(resetTrelloBoardState('board-2')).toEqual({
			trelloBoardId: 'board-2',
			trelloBoardDetails: null,
			trelloListMappings: {},
			trelloLabelMappings: {},
			trelloCostFieldId: '',
		});
	});

	it('captures JIRA project-change reset behavior', () => {
		expect(resetJiraProjectState('NEXT')).toEqual({
			jiraProjectKey: 'NEXT',
			jiraProjectDetails: null,
			jiraStatusMappings: {},
			jiraIssueTypes: {},
			jiraCostFieldId: '',
		});
	});

	it('captures Linear team-change reset behavior, including project scope', () => {
		expect(resetLinearTeamState('team-2')).toEqual({
			linearTeamId: 'team-2',
			linearTeamDetails: null,
			linearStatusMappings: {},
			linearProjectId: '',
			linearProjects: [],
		});
	});
});

// ============================================================================
// wizardReducer
// ============================================================================

describe('wizardReducer', () => {
	function initialState(): WizardState {
		return createInitialState();
	}

	function dispatch(state: WizardState, action: WizardAction): WizardState {
		return wizardReducer(state, action);
	}

	it('SET_PROVIDER (not editing) resets to initial state with new provider', () => {
		const state = {
			...initialState(),
			trelloApiKey: 'my-api-key',
			trelloBoardId: 'board-1',
		};
		const next = dispatch(state, { type: 'SET_PROVIDER', provider: 'jira' });
		expect(next.provider).toBe('jira');
		// Should have been reset
		expect(next.trelloApiKey).toBe('');
		expect(next.trelloBoardId).toBe('');
		expect(next.isEditing).toBe(false);
		expect(next.previousProvider).toBeUndefined();
	});

	it('SET_PROVIDER (editing) preserves isEditing + previousProvider and clears provider-specific fields', () => {
		const state: WizardState = {
			...initialState(),
			provider: 'trello',
			isEditing: true,
			previousProvider: 'trello',
			hasStoredCredentials: true,
			trelloApiKey: 'key',
			trelloToken: 'tok',
			trelloBoardId: 'board-1',
			trelloListMappings: { todo: 'list-1' },
			trelloLabelMappings: { processing: 'label-1' },
			trelloCostFieldId: 'cf-1',
			verificationResult: { provider: 'trello', display: '@user' },
			verifyError: null,
		};
		const next = dispatch(state, { type: 'SET_PROVIDER', provider: 'linear' });

		// New provider is set, edit mode carries over
		expect(next.provider).toBe('linear');
		expect(next.isEditing).toBe(true);
		expect(next.previousProvider).toBe('trello');

		// Credentials + verification + hasStoredCredentials are cleared
		expect(next.trelloApiKey).toBe('');
		expect(next.trelloToken).toBe('');
		expect(next.linearApiKey).toBe('');
		expect(next.verificationResult).toBeNull();
		expect(next.verifyError).toBeNull();
		expect(next.hasStoredCredentials).toBe(false);

		// Provider-specific fields cleared
		expect(next.trelloBoardId).toBe('');
		expect(next.trelloListMappings).toEqual({});
		expect(next.trelloLabelMappings).toEqual({});
		expect(next.trelloCostFieldId).toBe('');
	});

	it('SET_PROVIDER (editing) with no previousProvider set leaves previousProvider undefined', () => {
		const state: WizardState = {
			...initialState(),
			provider: 'trello',
			isEditing: true,
		};
		const next = dispatch(state, { type: 'SET_PROVIDER', provider: 'jira' });
		expect(next.isEditing).toBe(true);
		expect(next.previousProvider).toBeUndefined();
	});

	it('SET_TRELLO_API_KEY clears verification', () => {
		const state = {
			...initialState(),
			verificationResult: { provider: 'trello' as const, display: 'Test User' },
			verifyError: 'previous error',
		};
		const next = dispatch(state, { type: 'SET_TRELLO_API_KEY', value: 'new-api-key' });
		expect(next.trelloApiKey).toBe('new-api-key');
		expect(next.verificationResult).toBeNull();
		expect(next.verifyError).toBeNull();
	});

	it('SET_TRELLO_TOKEN clears verification', () => {
		const state = {
			...initialState(),
			verificationResult: { provider: 'trello' as const, display: 'Test User' },
		};
		const next = dispatch(state, { type: 'SET_TRELLO_TOKEN', value: 'new-token' });
		expect(next.trelloToken).toBe('new-token');
		expect(next.verificationResult).toBeNull();
	});

	it('SET_JIRA_EMAIL clears verification', () => {
		const state = {
			...initialState(),
			verificationResult: { provider: 'jira' as const, display: 'JIRA User' },
		};
		const next = dispatch(state, { type: 'SET_JIRA_EMAIL', value: 'user@example.com' });
		expect(next.jiraEmail).toBe('user@example.com');
		expect(next.verificationResult).toBeNull();
	});

	it('SET_JIRA_API_TOKEN clears verification', () => {
		const state = { ...initialState() };
		const next = dispatch(state, { type: 'SET_JIRA_API_TOKEN', value: 'my-jira-token' });
		expect(next.jiraApiToken).toBe('my-jira-token');
	});

	it('SET_JIRA_BASE_URL clears verification', () => {
		const state = {
			...initialState(),
			verificationResult: { provider: 'jira' as const, display: 'JIRA User' },
			verifyError: 'old error',
		};
		const next = dispatch(state, { type: 'SET_JIRA_BASE_URL', url: 'https://myorg.atlassian.net' });
		expect(next.jiraBaseUrl).toBe('https://myorg.atlassian.net');
		expect(next.verificationResult).toBeNull();
		expect(next.verifyError).toBeNull();
	});

	it('SET_VERIFICATION stores result and clears error', () => {
		const state = { ...initialState(), verifyError: 'old error' };
		const next = dispatch(state, {
			type: 'SET_VERIFICATION',
			result: { provider: 'trello', display: '@user (John Doe)' },
		});
		expect(next.verificationResult).toEqual({ provider: 'trello', display: '@user (John Doe)' });
		expect(next.verifyError).toBeNull();
	});

	it('SET_VERIFICATION with error stores error and null result', () => {
		const state = {
			...initialState(),
			verificationResult: { provider: 'trello' as const, display: '@user' },
		};
		const next = dispatch(state, {
			type: 'SET_VERIFICATION',
			result: null,
			error: 'auth failed',
		});
		expect(next.verificationResult).toBeNull();
		expect(next.verifyError).toBe('auth failed');
	});

	it('SET_TRELLO_BOARDS sets boards', () => {
		const state = initialState();
		const boards = [{ id: 'b1', name: 'My Board', url: 'https://trello.com/b/abc' }];
		const next = dispatch(state, { type: 'SET_TRELLO_BOARDS', boards });
		expect(next.trelloBoards).toEqual(boards);
	});

	it('SET_TRELLO_BOARD_ID clears details and mappings', () => {
		const state = {
			...initialState(),
			trelloBoardDetails: {
				lists: [{ id: 'l1', name: 'Todo' }],
				labels: [],
				customFields: [],
			},
			trelloListMappings: { todo: 'l1' },
			trelloLabelMappings: { processing: 'label-1' },
			trelloCostFieldId: 'cf-1',
		};
		const next = dispatch(state, { type: 'SET_TRELLO_BOARD_ID', id: 'new-board' });
		expect(next.trelloBoardId).toBe('new-board');
		expect(next.trelloBoardDetails).toBeNull();
		expect(next.trelloListMappings).toEqual({});
		expect(next.trelloLabelMappings).toEqual({});
		expect(next.trelloCostFieldId).toBe('');
	});

	it('SET_JIRA_PROJECTS sets projects', () => {
		const state = initialState();
		const projects = [{ key: 'PROJ', name: 'My Project' }];
		const next = dispatch(state, { type: 'SET_JIRA_PROJECTS', projects });
		expect(next.jiraProjects).toEqual(projects);
	});

	it('SET_JIRA_PROJECT_KEY clears details and mappings', () => {
		const state = {
			...initialState(),
			jiraProjectDetails: {
				statuses: [{ name: 'In Progress', id: 'ip' }],
				issueTypes: [],
				fields: [],
			},
			jiraStatusMappings: { todo: 'Todo' },
			jiraIssueTypes: { task: 'Task' },
			jiraCostFieldId: 'cf-1',
		};
		const next = dispatch(state, { type: 'SET_JIRA_PROJECT_KEY', key: 'NEW' });
		expect(next.jiraProjectKey).toBe('NEW');
		expect(next.jiraProjectDetails).toBeNull();
		expect(next.jiraStatusMappings).toEqual({});
		expect(next.jiraIssueTypes).toEqual({});
		expect(next.jiraCostFieldId).toBe('');
	});

	it('SET_TRELLO_LIST_MAPPING merges into existing mappings', () => {
		const state = {
			...initialState(),
			trelloListMappings: { backlog: 'list-1' },
		};
		const next = dispatch(state, {
			type: 'SET_TRELLO_LIST_MAPPING',
			key: 'todo',
			value: 'list-2',
		});
		expect(next.trelloListMappings).toEqual({ backlog: 'list-1', todo: 'list-2' });
	});

	it('SET_TRELLO_LABEL_MAPPING merges into existing mappings', () => {
		const state = { ...initialState() };
		const next = dispatch(state, {
			type: 'SET_TRELLO_LABEL_MAPPING',
			key: 'processing',
			value: 'label-abc',
		});
		expect(next.trelloLabelMappings.processing).toBe('label-abc');
	});

	it('SET_TRELLO_COST_FIELD sets the field ID', () => {
		const state = initialState();
		const next = dispatch(state, { type: 'SET_TRELLO_COST_FIELD', id: 'cf-cost' });
		expect(next.trelloCostFieldId).toBe('cf-cost');
	});

	it('SET_JIRA_STATUS_MAPPING merges into existing mappings', () => {
		const state = {
			...initialState(),
			jiraStatusMappings: { backlog: 'Backlog' },
		};
		const next = dispatch(state, {
			type: 'SET_JIRA_STATUS_MAPPING',
			key: 'todo',
			value: 'To Do',
		});
		expect(next.jiraStatusMappings).toEqual({ backlog: 'Backlog', todo: 'To Do' });
	});

	it('SET_JIRA_ISSUE_TYPE merges into existing issue types', () => {
		const state = { ...initialState() };
		const next = dispatch(state, { type: 'SET_JIRA_ISSUE_TYPE', key: 'task', value: 'Task' });
		expect(next.jiraIssueTypes.task).toBe('Task');
	});

	it('SET_JIRA_LABEL merges into existing labels', () => {
		const state = { ...initialState() };
		const next = dispatch(state, {
			type: 'SET_JIRA_LABEL',
			key: 'processing',
			value: 'my-processing',
		});
		expect(next.jiraLabels.processing).toBe('my-processing');
		// Other defaults preserved
		expect(next.jiraLabels.error).toBe(INITIAL_JIRA_LABELS.error);
	});

	it('SET_JIRA_COST_FIELD sets the field ID', () => {
		const state = initialState();
		const next = dispatch(state, { type: 'SET_JIRA_COST_FIELD', id: 'customfield_10042' });
		expect(next.jiraCostFieldId).toBe('customfield_10042');
	});

	it('INIT_EDIT merges partial state and sets isEditing', () => {
		const state = initialState();
		const next = dispatch(state, {
			type: 'INIT_EDIT',
			state: { provider: 'jira', jiraBaseUrl: 'https://example.atlassian.net' },
		});
		expect(next.isEditing).toBe(true);
		expect(next.provider).toBe('jira');
		expect(next.jiraBaseUrl).toBe('https://example.atlassian.net');
	});

	it('INIT_EDIT records previousProvider matching the loaded provider', () => {
		const state = initialState();
		const next = dispatch(state, {
			type: 'INIT_EDIT',
			state: { provider: 'trello', trelloBoardId: 'board-1' },
		});
		expect(next.previousProvider).toBe('trello');
	});

	it('ADD_TRELLO_BOARD_LABEL appends a label to trelloBoardDetails.labels', () => {
		const state = {
			...initialState(),
			trelloBoardDetails: {
				lists: [],
				labels: [{ id: 'lbl-existing', name: 'Existing', color: 'red' }],
				customFields: [],
			},
		};
		const newLabel = { id: 'lbl-new', name: 'cascade-processing', color: 'blue' };
		const next = dispatch(state, { type: 'ADD_TRELLO_BOARD_LABEL', label: newLabel });
		expect(next.trelloBoardDetails?.labels).toHaveLength(2);
		expect(next.trelloBoardDetails?.labels[1]).toEqual(newLabel);
	});

	it('ADD_TRELLO_BOARD_LABEL is a no-op when trelloBoardDetails is null', () => {
		const state = initialState();
		const next = dispatch(state, {
			type: 'ADD_TRELLO_BOARD_LABEL',
			label: { id: 'lbl-1', name: 'test', color: 'blue' },
		});
		expect(next.trelloBoardDetails).toBeNull();
		expect(next).toBe(state);
	});

	it('ADD_TRELLO_BOARD_LABEL preserves existing labels', () => {
		const existingLabels = [
			{ id: 'lbl-1', name: 'ready', color: 'sky' },
			{ id: 'lbl-2', name: 'processing', color: 'blue' },
		];
		const state = {
			...initialState(),
			trelloBoardDetails: {
				lists: [],
				labels: existingLabels,
				customFields: [],
			},
		};
		const newLabel = { id: 'lbl-3', name: 'cascade-error', color: 'red' };
		const next = dispatch(state, { type: 'ADD_TRELLO_BOARD_LABEL', label: newLabel });
		expect(next.trelloBoardDetails?.labels).toHaveLength(3);
		expect(next.trelloBoardDetails?.labels[0]).toEqual(existingLabels[0]);
		expect(next.trelloBoardDetails?.labels[1]).toEqual(existingLabels[1]);
		expect(next.trelloBoardDetails?.labels[2]).toEqual(newLabel);
	});

	it('ADD_TRELLO_BOARD_CUSTOM_FIELD appends a custom field to trelloBoardDetails.customFields', () => {
		const state = {
			...initialState(),
			trelloBoardDetails: {
				lists: [],
				labels: [],
				customFields: [{ id: 'cf-existing', name: 'Existing', type: 'text' }],
			},
		};
		const newCustomField = { id: 'cf-cost', name: 'Cost', type: 'number' };
		const next = dispatch(state, {
			type: 'ADD_TRELLO_BOARD_CUSTOM_FIELD',
			customField: newCustomField,
		});
		expect(next.trelloBoardDetails?.customFields).toHaveLength(2);
		expect(next.trelloBoardDetails?.customFields[1]).toEqual(newCustomField);
	});

	it('ADD_TRELLO_BOARD_CUSTOM_FIELD is a no-op when trelloBoardDetails is null', () => {
		const state = initialState();
		const next = dispatch(state, {
			type: 'ADD_TRELLO_BOARD_CUSTOM_FIELD',
			customField: { id: 'cf-1', name: 'test', type: 'number' },
		});
		expect(next.trelloBoardDetails).toBeNull();
		expect(next).toBe(state);
	});

	it('ADD_TRELLO_BOARD_CUSTOM_FIELD preserves existing custom fields', () => {
		const existingFields = [
			{ id: 'cf-1', name: 'Budget', type: 'number' },
			{ id: 'cf-2', name: 'Tags', type: 'list' },
		];
		const state = {
			...initialState(),
			trelloBoardDetails: {
				lists: [],
				labels: [],
				customFields: existingFields,
			},
		};
		const newCustomField = { id: 'cf-3', name: 'Cost', type: 'number' };
		const next = dispatch(state, {
			type: 'ADD_TRELLO_BOARD_CUSTOM_FIELD',
			customField: newCustomField,
		});
		expect(next.trelloBoardDetails?.customFields).toHaveLength(3);
		expect(next.trelloBoardDetails?.customFields[0]).toEqual(existingFields[0]);
		expect(next.trelloBoardDetails?.customFields[1]).toEqual(existingFields[1]);
		expect(next.trelloBoardDetails?.customFields[2]).toEqual(newCustomField);
	});

	it('unknown action returns state unchanged', () => {
		const state = initialState();
		// @ts-expect-error testing unknown action
		const next = dispatch(state, { type: 'UNKNOWN_ACTION' });
		expect(next).toEqual(state);
	});
});

// ============================================================================
// Step-completion helpers
// ============================================================================

describe('isStep1Complete', () => {
	it('returns true when provider is set', () => {
		expect(isStep1Complete({ ...createInitialState(), provider: 'trello' })).toBe(true);
		expect(isStep1Complete({ ...createInitialState(), provider: 'jira' })).toBe(true);
	});
});

describe('isStep2Complete', () => {
	it('returns true in edit mode when hasStoredCredentials is true (no raw creds needed)', () => {
		const state = {
			...createInitialState(),
			provider: 'trello' as const,
			isEditing: true,
			hasStoredCredentials: true,
		};
		expect(isStep2Complete(state)).toBe(true);
	});

	it('returns false when trello credentials missing', () => {
		const state = {
			...createInitialState(),
			provider: 'trello' as const,
			verificationResult: { provider: 'trello' as const, display: '@user' },
		};
		expect(isStep2Complete(state)).toBe(false);
	});

	it('returns false when trello creds present but no verification', () => {
		const state = {
			...createInitialState(),
			provider: 'trello' as const,
			trelloApiKey: 'my-api-key',
			trelloToken: 'my-token',
		};
		expect(isStep2Complete(state)).toBe(false);
	});

	it('returns true when trello creds present and verified', () => {
		const state = {
			...createInitialState(),
			provider: 'trello' as const,
			trelloApiKey: 'my-api-key',
			trelloToken: 'my-token',
			verificationResult: { provider: 'trello' as const, display: '@user (User)' },
		};
		expect(isStep2Complete(state)).toBe(true);
	});

	it('returns false when jira baseUrl missing even with creds', () => {
		const state = {
			...createInitialState(),
			provider: 'jira' as const,
			jiraEmail: 'user@example.com',
			jiraApiToken: 'my-token',
			jiraBaseUrl: '',
			verificationResult: { provider: 'jira' as const, display: 'User' },
		};
		expect(isStep2Complete(state)).toBe(false);
	});

	it('returns true when jira creds and baseUrl present and verified', () => {
		const state = {
			...createInitialState(),
			provider: 'jira' as const,
			jiraEmail: 'user@example.com',
			jiraApiToken: 'my-token',
			jiraBaseUrl: 'https://myorg.atlassian.net',
			verificationResult: { provider: 'jira' as const, display: 'User (user@example.com)' },
		};
		expect(isStep2Complete(state)).toBe(true);
	});
});

describe('isStep3Complete', () => {
	it('returns true for trello when boardId set', () => {
		const state = { ...createInitialState(), provider: 'trello' as const, trelloBoardId: 'b1' };
		expect(isStep3Complete(state)).toBe(true);
	});

	it('returns false for trello when boardId empty', () => {
		const state = { ...createInitialState(), provider: 'trello' as const };
		expect(isStep3Complete(state)).toBe(false);
	});

	it('returns true for jira when projectKey set', () => {
		const state = { ...createInitialState(), provider: 'jira' as const, jiraProjectKey: 'PROJ' };
		expect(isStep3Complete(state)).toBe(true);
	});

	it('returns false for jira when projectKey empty', () => {
		const state = { ...createInitialState(), provider: 'jira' as const };
		expect(isStep3Complete(state)).toBe(false);
	});
});

describe('isStep4Complete', () => {
	it('returns true for trello when any list mapping set', () => {
		const state = {
			...createInitialState(),
			provider: 'trello' as const,
			trelloListMappings: { todo: 'list-1' },
		};
		expect(isStep4Complete(state)).toBe(true);
	});

	it('returns false for trello when no list mappings', () => {
		const state = { ...createInitialState(), provider: 'trello' as const };
		expect(isStep4Complete(state)).toBe(false);
	});

	it('returns true for jira when any status mapping set', () => {
		const state = {
			...createInitialState(),
			provider: 'jira' as const,
			jiraStatusMappings: { todo: 'To Do' },
		};
		expect(isStep4Complete(state)).toBe(true);
	});

	it('returns false for jira when no status mappings', () => {
		const state = { ...createInitialState(), provider: 'jira' as const };
		expect(isStep4Complete(state)).toBe(false);
	});
});

describe('areCredentialsReady', () => {
	it('returns true for trello when both credentials set', () => {
		const state = {
			...createInitialState(),
			provider: 'trello' as const,
			trelloApiKey: 'my-api-key',
			trelloToken: 'my-token',
		};
		expect(areCredentialsReady(state)).toBe(true);
	});

	it('returns false for trello when one credential missing', () => {
		const state = {
			...createInitialState(),
			provider: 'trello' as const,
			trelloApiKey: 'my-api-key',
		};
		expect(areCredentialsReady(state)).toBe(false);
	});

	it('returns true for jira when email, api token, and baseUrl set', () => {
		const state = {
			...createInitialState(),
			provider: 'jira' as const,
			jiraEmail: 'user@example.com',
			jiraApiToken: 'my-token',
			jiraBaseUrl: 'https://myorg.atlassian.net',
		};
		expect(areCredentialsReady(state)).toBe(true);
	});

	it('returns false for jira when baseUrl missing', () => {
		const state = {
			...createInitialState(),
			provider: 'jira' as const,
			jiraEmail: 'user@example.com',
			jiraApiToken: 'my-token',
			jiraBaseUrl: '',
		};
		expect(areCredentialsReady(state)).toBe(false);
	});
});

describe('shouldUseStoredCredentials', () => {
	// When editing an existing integration, the form does NOT pre-fill
	// the API key for security — `hasStoredCredentials` is flipped true
	// but e.g. `linearApiKey` is empty. Wizard mutations (verify,
	// createLabel, createCustomField) detect this and pass `projectId`
	// to the backend so it resolves the stored credentials.
	//
	// Fresh setup (not editing) → always use form-state credentials.
	// Edit mode where the user re-typed a key → use the fresh key.
	// Edit mode with stored creds + empty key → use projectId.

	it('linear: false in fresh-setup mode (no editing)', () => {
		const state = { ...createInitialState(), provider: 'linear' as const };
		expect(shouldUseStoredCredentials(state)).toBe(false);
	});

	it('linear: true in edit mode with stored creds and empty apiKey', () => {
		const state: WizardState = {
			...createInitialState(),
			provider: 'linear' as const,
			isEditing: true,
			hasStoredCredentials: true,
			linearApiKey: '',
		};
		expect(shouldUseStoredCredentials(state)).toBe(true);
	});

	it('linear: false in edit mode when user re-typed the apiKey', () => {
		const state: WizardState = {
			...createInitialState(),
			provider: 'linear' as const,
			isEditing: true,
			hasStoredCredentials: true,
			linearApiKey: 'lin_fresh_typed_key',
		};
		expect(shouldUseStoredCredentials(state)).toBe(false);
	});

	it('trello: true in edit mode with stored creds and empty apiKey', () => {
		const state: WizardState = {
			...createInitialState(),
			provider: 'trello' as const,
			isEditing: true,
			hasStoredCredentials: true,
			trelloApiKey: '',
			trelloToken: '',
		};
		expect(shouldUseStoredCredentials(state)).toBe(true);
	});

	it('trello: false in edit mode when user re-typed the apiKey', () => {
		const state: WizardState = {
			...createInitialState(),
			provider: 'trello' as const,
			isEditing: true,
			hasStoredCredentials: true,
			trelloApiKey: 'fresh_key',
			trelloToken: '',
		};
		expect(shouldUseStoredCredentials(state)).toBe(false);
	});

	it('jira: true in edit mode with stored creds and empty apiToken', () => {
		const state: WizardState = {
			...createInitialState(),
			provider: 'jira' as const,
			isEditing: true,
			hasStoredCredentials: true,
			jiraEmail: '',
			jiraApiToken: '',
		};
		expect(shouldUseStoredCredentials(state)).toBe(true);
	});

	it('jira: false in edit mode when user re-typed the apiToken', () => {
		const state: WizardState = {
			...createInitialState(),
			provider: 'jira' as const,
			isEditing: true,
			hasStoredCredentials: true,
			jiraEmail: '',
			jiraApiToken: 'fresh_token',
		};
		expect(shouldUseStoredCredentials(state)).toBe(false);
	});

	it('false when edit mode but hasStoredCredentials is false (user deleted creds)', () => {
		const state: WizardState = {
			...createInitialState(),
			provider: 'linear' as const,
			isEditing: true,
			hasStoredCredentials: false,
			linearApiKey: '',
		};
		expect(shouldUseStoredCredentials(state)).toBe(false);
	});
});

// ============================================================================
// buildEditState
// ============================================================================

describe('buildEditState', () => {
	it('builds trello edit state from config', () => {
		const config = {
			boardId: 'board-abc',
			lists: { todo: 'list-1', done: 'list-2' },
			labels: { processing: 'label-x' },
			customFields: { cost: 'cf-cost-1' },
		};
		const result = buildEditState('trello', config, new Set<string>());
		expect(result.provider).toBe('trello');
		// Raw credential values are NOT pre-populated for security
		expect(result.trelloApiKey).toBeUndefined();
		expect(result.trelloToken).toBeUndefined();
		expect(result.trelloBoardId).toBe('board-abc');
		expect(result.trelloListMappings).toEqual({ todo: 'list-1', done: 'list-2' });
		expect(result.trelloLabelMappings).toEqual({ processing: 'label-x' });
		expect(result.trelloCostFieldId).toBe('cf-cost-1');
	});

	it('sets hasStoredCredentials true for trello when both keys present', () => {
		const config = { boardId: 'board-abc' };
		const result = buildEditState('trello', config, new Set(['TRELLO_API_KEY', 'TRELLO_TOKEN']));
		expect(result.hasStoredCredentials).toBe(true);
	});

	it('sets hasStoredCredentials false for trello when only one key present', () => {
		const result = buildEditState('trello', {}, new Set(['TRELLO_API_KEY']));
		expect(result.hasStoredCredentials).toBe(false);
	});

	it('sets hasStoredCredentials false for trello when no keys present', () => {
		const result = buildEditState('trello', {}, new Set<string>());
		expect(result.hasStoredCredentials).toBe(false);
	});

	it('builds jira edit state from config', () => {
		const config = {
			baseUrl: 'https://example.atlassian.net',
			projectKey: 'PROJ',
			statuses: { todo: 'To Do', done: 'Done' },
			issueTypes: { task: 'Task', subtask: 'Subtask' },
			labels: { processing: 'cascade-processing' },
			customFields: { cost: 'customfield_10042' },
		};
		const result = buildEditState('jira', config, new Set<string>());
		expect(result.provider).toBe('jira');
		// Raw credential values are NOT pre-populated for security
		expect(result.jiraEmail).toBeUndefined();
		expect(result.jiraApiToken).toBeUndefined();
		expect(result.jiraBaseUrl).toBe('https://example.atlassian.net');
		expect(result.jiraProjectKey).toBe('PROJ');
		expect(result.jiraStatusMappings).toEqual({ todo: 'To Do', done: 'Done' });
		expect(result.jiraIssueTypes).toEqual({ task: 'Task', subtask: 'Subtask' });
		expect(result.jiraLabels).toEqual({ processing: 'cascade-processing' });
		expect(result.jiraCostFieldId).toBe('customfield_10042');
	});

	it('sets hasStoredCredentials true for jira when both keys present', () => {
		const result = buildEditState(
			'jira',
			{ baseUrl: 'https://example.atlassian.net', projectKey: 'PROJ' },
			new Set(['JIRA_EMAIL', 'JIRA_API_TOKEN']),
		);
		expect(result.hasStoredCredentials).toBe(true);
	});

	it('sets hasStoredCredentials false for jira when only one key present', () => {
		const result = buildEditState('jira', {}, new Set(['JIRA_EMAIL']));
		expect(result.hasStoredCredentials).toBe(false);
	});

	it('handles missing optional config fields gracefully', () => {
		const config = { boardId: 'board-1' };
		const result = buildEditState('trello', config, new Set<string>());
		expect(result.trelloBoardId).toBe('board-1');
		expect(result.trelloListMappings).toBeUndefined();
		expect(result.trelloCostFieldId).toBe('');
	});

	it('returns only provider for unknown provider', () => {
		const result = buildEditState('unknown', {}, new Set<string>());
		expect(result.provider).toBe('unknown');
		expect(Object.keys(result).length).toBe(1);
	});
});

// ============================================================================
// Linear project scope — state reducer + edit-state hydration (spec 005)
// ============================================================================

describe('Linear project scope — createInitialState', () => {
	it('linearProjectId defaults to empty string', () => {
		const state = createInitialState();
		expect(state.linearProjectId).toBe('');
	});

	it('linearProjects defaults to empty array', () => {
		const state = createInitialState();
		expect(state.linearProjects).toEqual([]);
	});
});

describe('Linear project scope — wizardReducer', () => {
	function initialState(): WizardState {
		return createInitialState();
	}

	it('SET_LINEAR_PROJECTS replaces the list', () => {
		const result = wizardReducer(initialState(), {
			type: 'SET_LINEAR_PROJECTS',
			projects: [
				{ id: 'P1', name: 'Alpha', icon: null, color: null },
				{ id: 'P2', name: 'Beta', icon: 'rocket', color: '#f00' },
			],
		});
		expect(result.linearProjects).toEqual([
			{ id: 'P1', name: 'Alpha', icon: null, color: null },
			{ id: 'P2', name: 'Beta', icon: 'rocket', color: '#f00' },
		]);
	});

	it('SET_LINEAR_PROJECT_ID sets the chosen id', () => {
		const result = wizardReducer(initialState(), {
			type: 'SET_LINEAR_PROJECT_ID',
			value: 'P1',
		});
		expect(result.linearProjectId).toBe('P1');
	});

	it('SET_LINEAR_PROJECT_ID with empty string clears selection', () => {
		const withValue = wizardReducer(initialState(), {
			type: 'SET_LINEAR_PROJECT_ID',
			value: 'P1',
		});
		const result = wizardReducer(withValue, {
			type: 'SET_LINEAR_PROJECT_ID',
			value: '',
		});
		expect(result.linearProjectId).toBe('');
	});

	it('SET_LINEAR_TEAM_ID resets linearProjectId and linearProjects', () => {
		// Seed state with a chosen project + loaded project list
		const seeded: WizardState = {
			...initialState(),
			linearTeamId: 'OLD-TEAM',
			linearProjectId: 'P1',
			linearProjects: [{ id: 'P1', name: 'Alpha', icon: null, color: null }],
		};
		const result = wizardReducer(seeded, {
			type: 'SET_LINEAR_TEAM_ID',
			id: 'NEW-TEAM',
		});
		expect(result.linearTeamId).toBe('NEW-TEAM');
		expect(result.linearProjectId).toBe('');
		expect(result.linearProjects).toEqual([]);
	});
});

describe('Linear project scope — buildEditState hydration', () => {
	it('hydrates linearProjectId from initialConfig.projectId when present', () => {
		const result = buildEditState(
			'linear',
			{ teamId: 'T1', projectId: 'P1', statuses: {} },
			new Set(['LINEAR_API_KEY']),
		);
		expect(result.linearProjectId).toBe('P1');
	});

	it('leaves linearProjectId unset when initialConfig has no projectId', () => {
		const result = buildEditState(
			'linear',
			{ teamId: 'T1', statuses: {} },
			new Set(['LINEAR_API_KEY']),
		);
		expect(result.linearProjectId ?? '').toBe('');
	});
});

describe('buildLinearIntegrationConfig — save payload', () => {
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

	it('omits projectId when linearProjectId is empty', () => {
		const config = buildLinearIntegrationConfig(seed({ linearProjectId: '' }));
		expect(config).not.toHaveProperty('projectId');
		expect(config.teamId).toBe('T1');
	});

	it('includes projectId when linearProjectId is set', () => {
		const config = buildLinearIntegrationConfig(seed({ linearProjectId: 'P1' }));
		expect(config.projectId).toBe('P1');
		expect(config.teamId).toBe('T1');
	});

	it('clearing a previously-set projectId yields a config without projectId', () => {
		// Simulate edit mode: start with projectId set, user clears, we save.
		const state = seed({ linearProjectId: '' }); // after clear
		const config = buildLinearIntegrationConfig(state);
		expect(config).not.toHaveProperty('projectId');
	});

	it('omits labels when linearLabels is empty; includes when populated', () => {
		const bare = buildLinearIntegrationConfig(seed());
		expect(bare).not.toHaveProperty('labels');
		const withLabels = buildLinearIntegrationConfig(
			// Linear labels are stored as UUIDs (the Linear API rejects names for
			// issueUpdate.labelIds). Wizard dropdowns populate from the team's labels.
			seed({ linearLabels: { processing: '11111111-1111-4111-8111-111111111111' } }),
		);
		expect(withLabels).toHaveProperty('labels', {
			processing: '11111111-1111-4111-8111-111111111111',
		});
	});
});

// ============================================================================
// deriveActiveWebhooks
// ============================================================================

describe('deriveActiveWebhooks', () => {
	it('maps Trello webhooks via callbackURL + active', () => {
		const result = deriveActiveWebhooks('trello', {
			trello: [
				{ id: 1, callbackURL: 'https://hook/trello', active: true },
				{ id: 2, callbackURL: 'https://hook/trello-2', active: false },
			],
		});

		expect(result).toEqual([
			{ id: '1', url: 'https://hook/trello', active: true },
			{ id: '2', url: 'https://hook/trello-2', active: false },
		]);
	});

	it('maps JIRA webhooks via url + enabled (renamed to active)', () => {
		const result = deriveActiveWebhooks('jira', {
			jira: [{ id: 'abc', url: 'https://hook/jira', enabled: true }],
		});

		expect(result).toEqual([{ id: 'abc', url: 'https://hook/jira', active: true }]);
	});

	it('returns empty array for Linear (manual webhook setup)', () => {
		const result = deriveActiveWebhooks('linear', {
			trello: [{ id: 1, callbackURL: 'irrelevant', active: true }],
			jira: [{ id: 1, url: 'irrelevant', enabled: true }],
		});

		expect(result).toEqual([]);
	});

	it('returns empty array when webhooksData is undefined', () => {
		expect(deriveActiveWebhooks('trello', undefined)).toEqual([]);
		expect(deriveActiveWebhooks('jira', undefined)).toEqual([]);
		expect(deriveActiveWebhooks('linear', undefined)).toEqual([]);
	});

	it('coerces numeric IDs to strings', () => {
		const result = deriveActiveWebhooks('trello', {
			trello: [{ id: 42, callbackURL: 'u', active: true }],
		});
		expect(result[0].id).toBe('42');
		expect(typeof result[0].id).toBe('string');
	});
});
