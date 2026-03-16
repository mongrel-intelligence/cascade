/**
 * PM Wizard state management: types, initial state, reducer, and step-completion helpers.
 * Has zero imports from other pm-wizard files to avoid circular dependencies.
 */
import type { Reducer } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface TrelloBoardOption {
	id: string;
	name: string;
	url: string;
}

export interface TrelloBoardDetails {
	lists: Array<{ id: string; name: string }>;
	labels: Array<{ id: string; name: string; color: string }>;
	customFields: Array<{ id: string; name: string; type: string }>;
}

export interface JiraProjectOption {
	key: string;
	name: string;
}

export interface JiraProjectDetails {
	statuses: Array<{ name: string; id: string }>;
	issueTypes: Array<{ name: string; subtask: boolean }>;
	fields: Array<{ id: string; name: string; custom: boolean }>;
}

export type Provider = 'trello' | 'jira';

export interface WizardState {
	provider: Provider;
	// Step 2: Credentials (raw values — never credential IDs)
	trelloApiKey: string;
	trelloToken: string;
	jiraEmail: string;
	jiraApiToken: string;
	jiraBaseUrl: string;
	verificationResult: { provider: Provider; display: string } | null;
	verifyError: string | null;
	// Step 3: Board/Project
	trelloBoardId: string;
	trelloBoards: TrelloBoardOption[];
	jiraProjectKey: string;
	jiraProjects: JiraProjectOption[];
	// Step 4: Field mapping
	trelloBoardDetails: TrelloBoardDetails | null;
	jiraProjectDetails: JiraProjectDetails | null;
	// Trello mappings
	trelloListMappings: Record<string, string>;
	trelloLabelMappings: Record<string, string>;
	trelloCostFieldId: string;
	// JIRA mappings
	jiraStatusMappings: Record<string, string>;
	jiraIssueTypes: Record<string, string>;
	jiraLabels: Record<string, string>;
	jiraCostFieldId: string;
	// Editing mode
	isEditing: boolean;
	hasStoredCredentials: boolean; // true in edit mode when provider credentials exist in project_credentials
}

export type WizardAction =
	| { type: 'SET_PROVIDER'; provider: Provider }
	| { type: 'SET_TRELLO_API_KEY'; value: string }
	| { type: 'SET_TRELLO_TOKEN'; value: string }
	| { type: 'SET_JIRA_EMAIL'; value: string }
	| { type: 'SET_JIRA_API_TOKEN'; value: string }
	| { type: 'SET_JIRA_BASE_URL'; url: string }
	| {
			type: 'SET_VERIFICATION';
			result: { provider: Provider; display: string } | null;
			error?: string | null;
	  }
	| { type: 'SET_TRELLO_BOARDS'; boards: TrelloBoardOption[] }
	| { type: 'SET_TRELLO_BOARD_ID'; id: string }
	| { type: 'SET_JIRA_PROJECTS'; projects: JiraProjectOption[] }
	| { type: 'SET_JIRA_PROJECT_KEY'; key: string }
	| { type: 'SET_TRELLO_BOARD_DETAILS'; details: TrelloBoardDetails | null }
	| { type: 'SET_JIRA_PROJECT_DETAILS'; details: JiraProjectDetails | null }
	| { type: 'SET_TRELLO_LIST_MAPPING'; key: string; value: string }
	| { type: 'SET_TRELLO_LABEL_MAPPING'; key: string; value: string }
	| { type: 'SET_TRELLO_COST_FIELD'; id: string }
	| { type: 'SET_JIRA_STATUS_MAPPING'; key: string; value: string }
	| { type: 'SET_JIRA_ISSUE_TYPE'; key: string; value: string }
	| { type: 'SET_JIRA_LABEL'; key: string; value: string }
	| { type: 'SET_JIRA_COST_FIELD'; id: string }
	| { type: 'INIT_EDIT'; state: Partial<WizardState> }
	| { type: 'ADD_TRELLO_BOARD_LABEL'; label: { id: string; name: string; color: string } }
	| {
			type: 'ADD_TRELLO_BOARD_CUSTOM_FIELD';
			customField: { id: string; name: string; type: string };
	  }
	| { type: 'ADD_JIRA_PROJECT_CUSTOM_FIELD'; field: { id: string; name: string; custom: boolean } };

// ============================================================================
// Initial state and constants
// ============================================================================

export const INITIAL_JIRA_LABELS: Record<string, string> = {
	processing: 'cascade-processing',
	processed: 'cascade-processed',
	error: 'cascade-error',
	readyToProcess: 'cascade-ready',
	auto: 'cascade-auto',
};

export function createInitialState(): WizardState {
	return {
		provider: 'trello',
		trelloApiKey: '',
		trelloToken: '',
		jiraEmail: '',
		jiraApiToken: '',
		jiraBaseUrl: '',
		verificationResult: null,
		verifyError: null,
		trelloBoardId: '',
		trelloBoards: [],
		jiraProjectKey: '',
		jiraProjects: [],
		trelloBoardDetails: null,
		jiraProjectDetails: null,
		trelloListMappings: {},
		trelloLabelMappings: {},
		trelloCostFieldId: '',
		jiraStatusMappings: {},
		jiraIssueTypes: {},
		jiraLabels: { ...INITIAL_JIRA_LABELS },
		jiraCostFieldId: '',
		isEditing: false,
		hasStoredCredentials: false,
	};
}

// ============================================================================
// Reducer
// ============================================================================

export const wizardReducer: Reducer<WizardState, WizardAction> = (state, action) => {
	switch (action.type) {
		case 'SET_PROVIDER':
			return {
				...createInitialState(),
				provider: action.provider,
			};
		case 'SET_TRELLO_API_KEY':
			return {
				...state,
				trelloApiKey: action.value,
				verificationResult: null,
				verifyError: null,
			};
		case 'SET_TRELLO_TOKEN':
			return {
				...state,
				trelloToken: action.value,
				verificationResult: null,
				verifyError: null,
			};
		case 'SET_JIRA_EMAIL':
			return {
				...state,
				jiraEmail: action.value,
				verificationResult: null,
				verifyError: null,
			};
		case 'SET_JIRA_API_TOKEN':
			return {
				...state,
				jiraApiToken: action.value,
				verificationResult: null,
				verifyError: null,
			};
		case 'SET_JIRA_BASE_URL':
			return { ...state, jiraBaseUrl: action.url, verificationResult: null, verifyError: null };
		case 'SET_VERIFICATION':
			return { ...state, verificationResult: action.result, verifyError: action.error ?? null };
		case 'SET_TRELLO_BOARDS':
			return { ...state, trelloBoards: action.boards };
		case 'SET_TRELLO_BOARD_ID':
			return {
				...state,
				trelloBoardId: action.id,
				trelloBoardDetails: null,
				trelloListMappings: {},
				trelloLabelMappings: {},
				trelloCostFieldId: '',
			};
		case 'SET_JIRA_PROJECTS':
			return { ...state, jiraProjects: action.projects };
		case 'SET_JIRA_PROJECT_KEY':
			return {
				...state,
				jiraProjectKey: action.key,
				jiraProjectDetails: null,
				jiraStatusMappings: {},
				jiraIssueTypes: {},
				jiraCostFieldId: '',
			};
		case 'SET_TRELLO_BOARD_DETAILS':
			return { ...state, trelloBoardDetails: action.details };
		case 'SET_JIRA_PROJECT_DETAILS':
			return { ...state, jiraProjectDetails: action.details };
		case 'SET_TRELLO_LIST_MAPPING':
			return {
				...state,
				trelloListMappings: { ...state.trelloListMappings, [action.key]: action.value },
			};
		case 'SET_TRELLO_LABEL_MAPPING':
			return {
				...state,
				trelloLabelMappings: { ...state.trelloLabelMappings, [action.key]: action.value },
			};
		case 'SET_TRELLO_COST_FIELD':
			return { ...state, trelloCostFieldId: action.id };
		case 'SET_JIRA_STATUS_MAPPING':
			return {
				...state,
				jiraStatusMappings: { ...state.jiraStatusMappings, [action.key]: action.value },
			};
		case 'SET_JIRA_ISSUE_TYPE':
			return {
				...state,
				jiraIssueTypes: { ...state.jiraIssueTypes, [action.key]: action.value },
			};
		case 'SET_JIRA_LABEL':
			return {
				...state,
				jiraLabels: { ...state.jiraLabels, [action.key]: action.value },
			};
		case 'SET_JIRA_COST_FIELD':
			return { ...state, jiraCostFieldId: action.id };
		case 'INIT_EDIT':
			return { ...state, ...action.state, isEditing: true };
		case 'ADD_TRELLO_BOARD_LABEL':
			if (!state.trelloBoardDetails) return state;
			return {
				...state,
				trelloBoardDetails: {
					...state.trelloBoardDetails,
					labels: [...state.trelloBoardDetails.labels, action.label],
				},
			};
		case 'ADD_TRELLO_BOARD_CUSTOM_FIELD':
			if (!state.trelloBoardDetails) return state;
			return {
				...state,
				trelloBoardDetails: {
					...state.trelloBoardDetails,
					customFields: [...state.trelloBoardDetails.customFields, action.customField],
				},
			};
		case 'ADD_JIRA_PROJECT_CUSTOM_FIELD':
			if (!state.jiraProjectDetails) return state;
			return {
				...state,
				jiraProjectDetails: {
					...state.jiraProjectDetails,
					fields: [...state.jiraProjectDetails.fields, action.field],
				},
			};
		default:
			return state;
	}
};

// ============================================================================
// Edit-mode state builder
// ============================================================================

/**
 * Build a partial WizardState from an existing integration's config.
 * Called when editing an existing PM integration.
 * Note: Raw credential values are NOT pre-populated for security. When stored credentials
 * exist in project_credentials, `hasStoredCredentials` is set true so the wizard can
 * operate without re-entry.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: restoring state from two provider config shapes
export function buildEditState(
	provider: string,
	initialConfig: Record<string, unknown>,
	configuredKeys: Set<string>,
): Partial<WizardState> {
	const editState: Partial<WizardState> = {
		provider: provider as Provider,
	};

	if (provider === 'trello') {
		editState.trelloBoardId = (initialConfig.boardId as string) ?? '';

		const lists = initialConfig.lists as Record<string, string> | undefined;
		if (lists) editState.trelloListMappings = lists;

		const labels = initialConfig.labels as Record<string, string> | undefined;
		if (labels) editState.trelloLabelMappings = labels;

		const cf = initialConfig.customFields as Record<string, string> | undefined;
		editState.trelloCostFieldId = cf?.cost ?? '';

		editState.hasStoredCredentials =
			configuredKeys.has('TRELLO_API_KEY') && configuredKeys.has('TRELLO_TOKEN');
	} else if (provider === 'jira') {
		editState.jiraBaseUrl = (initialConfig.baseUrl as string) ?? '';
		editState.jiraProjectKey = (initialConfig.projectKey as string) ?? '';

		const statuses = initialConfig.statuses as Record<string, string> | undefined;
		if (statuses) editState.jiraStatusMappings = statuses;

		const issueTypes = initialConfig.issueTypes as Record<string, string> | undefined;
		if (issueTypes) editState.jiraIssueTypes = issueTypes;

		const labels = initialConfig.labels as Record<string, string> | undefined;
		if (labels) editState.jiraLabels = labels;

		const cf = initialConfig.customFields as Record<string, string> | undefined;
		editState.jiraCostFieldId = cf?.cost ?? '';

		editState.hasStoredCredentials =
			configuredKeys.has('JIRA_EMAIL') && configuredKeys.has('JIRA_API_TOKEN');
	}

	return editState;
}

// ============================================================================
// Step-completion helpers (pure functions)
// ============================================================================

export function isStep1Complete(state: WizardState): boolean {
	return !!state.provider;
}

export function isStep2Complete(state: WizardState): boolean {
	if (state.isEditing && state.hasStoredCredentials) return true;
	const credsReady =
		state.provider === 'trello'
			? !!(state.trelloApiKey && state.trelloToken)
			: !!(state.jiraEmail && state.jiraApiToken && state.jiraBaseUrl);
	return credsReady && !!state.verificationResult;
}

export function isStep3Complete(state: WizardState): boolean {
	return state.provider === 'trello' ? !!state.trelloBoardId : !!state.jiraProjectKey;
}

export function isStep4Complete(state: WizardState): boolean {
	return state.provider === 'trello'
		? Object.keys(state.trelloListMappings).length > 0
		: Object.keys(state.jiraStatusMappings).length > 0;
}

export function areCredentialsReady(state: WizardState): boolean {
	return state.provider === 'trello'
		? !!(state.trelloApiKey && state.trelloToken)
		: !!(state.jiraEmail && state.jiraApiToken && state.jiraBaseUrl);
}
