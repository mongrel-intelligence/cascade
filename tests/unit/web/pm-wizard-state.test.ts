import { describe, expect, it } from 'vitest';

import {
	INITIAL_JIRA_LABELS,
	areCredentialsReady,
	buildEditState,
	createInitialState,
	isStep1Complete,
	isStep2Complete,
	isStep3Complete,
	isStep4Complete,
	wizardReducer,
} from '../../../web/src/components/projects/pm-wizard-state.js';
import type {
	WizardAction,
	WizardState,
} from '../../../web/src/components/projects/pm-wizard-state.js';

// ============================================================================
// createInitialState
// ============================================================================

describe('createInitialState', () => {
	it('returns a valid initial state with trello as default provider', () => {
		const state = createInitialState();
		expect(state.provider).toBe('trello');
		expect(state.trelloApiKeyCredentialId).toBeNull();
		expect(state.trelloTokenCredentialId).toBeNull();
		expect(state.jiraEmailCredentialId).toBeNull();
		expect(state.jiraApiTokenCredentialId).toBeNull();
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

	it('SET_PROVIDER resets to initial state with new provider', () => {
		const state = {
			...initialState(),
			trelloApiKeyCredentialId: 5,
			trelloBoardId: 'board-1',
		};
		const next = dispatch(state, { type: 'SET_PROVIDER', provider: 'jira' });
		expect(next.provider).toBe('jira');
		// Should have been reset
		expect(next.trelloApiKeyCredentialId).toBeNull();
		expect(next.trelloBoardId).toBe('');
	});

	it('SET_TRELLO_API_KEY_CRED clears verification', () => {
		const state = {
			...initialState(),
			verificationResult: { provider: 'trello' as const, display: 'Test User' },
			verifyError: 'previous error',
		};
		const next = dispatch(state, { type: 'SET_TRELLO_API_KEY_CRED', id: 42 });
		expect(next.trelloApiKeyCredentialId).toBe(42);
		expect(next.verificationResult).toBeNull();
		expect(next.verifyError).toBeNull();
	});

	it('SET_TRELLO_TOKEN_CRED clears verification', () => {
		const state = {
			...initialState(),
			verificationResult: { provider: 'trello' as const, display: 'Test User' },
		};
		const next = dispatch(state, { type: 'SET_TRELLO_TOKEN_CRED', id: 7 });
		expect(next.trelloTokenCredentialId).toBe(7);
		expect(next.verificationResult).toBeNull();
	});

	it('SET_JIRA_EMAIL_CRED clears verification', () => {
		const state = {
			...initialState(),
			verificationResult: { provider: 'jira' as const, display: 'JIRA User' },
		};
		const next = dispatch(state, { type: 'SET_JIRA_EMAIL_CRED', id: 3 });
		expect(next.jiraEmailCredentialId).toBe(3);
		expect(next.verificationResult).toBeNull();
	});

	it('SET_JIRA_API_TOKEN_CRED clears verification', () => {
		const state = { ...initialState() };
		const next = dispatch(state, { type: 'SET_JIRA_API_TOKEN_CRED', id: 9 });
		expect(next.jiraApiTokenCredentialId).toBe(9);
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
			trelloApiKeyCredentialId: 1,
			trelloTokenCredentialId: 2,
		};
		expect(isStep2Complete(state)).toBe(false);
	});

	it('returns true when trello creds present and verified', () => {
		const state = {
			...createInitialState(),
			provider: 'trello' as const,
			trelloApiKeyCredentialId: 1,
			trelloTokenCredentialId: 2,
			verificationResult: { provider: 'trello' as const, display: '@user (User)' },
		};
		expect(isStep2Complete(state)).toBe(true);
	});

	it('returns false when jira baseUrl missing even with creds', () => {
		const state = {
			...createInitialState(),
			provider: 'jira' as const,
			jiraEmailCredentialId: 1,
			jiraApiTokenCredentialId: 2,
			jiraBaseUrl: '',
			verificationResult: { provider: 'jira' as const, display: 'User' },
		};
		expect(isStep2Complete(state)).toBe(false);
	});

	it('returns true when jira creds and baseUrl present and verified', () => {
		const state = {
			...createInitialState(),
			provider: 'jira' as const,
			jiraEmailCredentialId: 1,
			jiraApiTokenCredentialId: 2,
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
			trelloApiKeyCredentialId: 1,
			trelloTokenCredentialId: 2,
		};
		expect(areCredentialsReady(state)).toBe(true);
	});

	it('returns false for trello when one credential missing', () => {
		const state = {
			...createInitialState(),
			provider: 'trello' as const,
			trelloApiKeyCredentialId: 1,
		};
		expect(areCredentialsReady(state)).toBe(false);
	});

	it('returns true for jira when email, api token, and baseUrl set', () => {
		const state = {
			...createInitialState(),
			provider: 'jira' as const,
			jiraEmailCredentialId: 1,
			jiraApiTokenCredentialId: 2,
			jiraBaseUrl: 'https://myorg.atlassian.net',
		};
		expect(areCredentialsReady(state)).toBe(true);
	});

	it('returns false for jira when baseUrl missing', () => {
		const state = {
			...createInitialState(),
			provider: 'jira' as const,
			jiraEmailCredentialId: 1,
			jiraApiTokenCredentialId: 2,
			jiraBaseUrl: '',
		};
		expect(areCredentialsReady(state)).toBe(false);
	});
});

// ============================================================================
// buildEditState
// ============================================================================

describe('buildEditState', () => {
	it('builds trello edit state from config and credentials', () => {
		const config = {
			boardId: 'board-abc',
			lists: { todo: 'list-1', done: 'list-2' },
			labels: { processing: 'label-x' },
			customFields: { cost: 'cf-cost-1' },
		};
		const credentials = new Map([
			['api_key', 10],
			['token', 20],
		]);
		const result = buildEditState('trello', config, credentials);
		expect(result.provider).toBe('trello');
		expect(result.trelloApiKeyCredentialId).toBe(10);
		expect(result.trelloTokenCredentialId).toBe(20);
		expect(result.trelloBoardId).toBe('board-abc');
		expect(result.trelloListMappings).toEqual({ todo: 'list-1', done: 'list-2' });
		expect(result.trelloLabelMappings).toEqual({ processing: 'label-x' });
		expect(result.trelloCostFieldId).toBe('cf-cost-1');
	});

	it('builds jira edit state from config and credentials', () => {
		const config = {
			baseUrl: 'https://example.atlassian.net',
			projectKey: 'PROJ',
			statuses: { todo: 'To Do', done: 'Done' },
			issueTypes: { task: 'Task', subtask: 'Subtask' },
			labels: { processing: 'cascade-processing' },
			customFields: { cost: 'customfield_10042' },
		};
		const credentials = new Map([
			['email', 5],
			['api_token', 6],
		]);
		const result = buildEditState('jira', config, credentials);
		expect(result.provider).toBe('jira');
		expect(result.jiraEmailCredentialId).toBe(5);
		expect(result.jiraApiTokenCredentialId).toBe(6);
		expect(result.jiraBaseUrl).toBe('https://example.atlassian.net');
		expect(result.jiraProjectKey).toBe('PROJ');
		expect(result.jiraStatusMappings).toEqual({ todo: 'To Do', done: 'Done' });
		expect(result.jiraIssueTypes).toEqual({ task: 'Task', subtask: 'Subtask' });
		expect(result.jiraLabels).toEqual({ processing: 'cascade-processing' });
		expect(result.jiraCostFieldId).toBe('customfield_10042');
	});

	it('handles missing optional config fields gracefully', () => {
		const config = { boardId: 'board-1' };
		const credentials = new Map<string, number>();
		const result = buildEditState('trello', config, credentials);
		expect(result.trelloBoardId).toBe('board-1');
		expect(result.trelloListMappings).toBeUndefined();
		expect(result.trelloCostFieldId).toBe('');
		expect(result.trelloApiKeyCredentialId).toBeNull();
	});

	it('returns only provider for unknown provider', () => {
		const result = buildEditState('unknown', {}, new Map());
		expect(result.provider).toBe('unknown');
		expect(Object.keys(result).length).toBe(1);
	});
});
