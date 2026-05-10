/**
 * PM Wizard state management: types, initial state, reducer, and step-completion helpers.
 * Has zero imports from other pm-wizard files to avoid circular dependencies.
 */
import type { Reducer } from 'react';
import {
	createInitialJiraState,
	INITIAL_JIRA_LABELS,
	type JiraProjectDetails,
	type JiraProjectOption,
	resetJiraProjectState,
} from './pm-providers/jira/state.js';
import {
	createInitialLinearState,
	INITIAL_LINEAR_LABELS,
	type LinearProjectOption,
	type LinearTeamDetails,
	type LinearTeamOption,
	resetLinearTeamState,
} from './pm-providers/linear/state.js';
import {
	createInitialTrelloState,
	resetTrelloBoardState,
	type TrelloBoardDetails,
	type TrelloBoardOption,
} from './pm-providers/trello/state.js';

export type {
	JiraProjectDetails,
	JiraProjectOption,
	LinearProjectOption,
	LinearTeamDetails,
	LinearTeamOption,
	TrelloBoardDetails,
	TrelloBoardOption,
};
export { INITIAL_JIRA_LABELS, INITIAL_LINEAR_LABELS };

// ============================================================================
// Types
// ============================================================================

/**
 * Provider identifier — an open string so new providers registered via the
 * frontend barrel (`web/src/components/projects/pm-providers/index.ts`) can
 * be dispatched without adding to a closed union here.
 *
 * Note: adding a new PM provider still requires updating `WizardState` with
 * the provider's credential fields (e.g. `asanaApiKey: string`), the reducer
 * with the corresponding action types, and `buildEditState` with the new
 * provider's config-shape handling. The credential-readiness path
 * (`areCredentialsReadyFromMetadata` in `pm-wizard-hooks.ts`) and the
 * mutation auth path (`buildProviderAuthArgFromMetadata`) are metadata-driven
 * and do NOT require changes.
 */
export type Provider = string;

export interface WizardState {
	provider: Provider;
	// Step 2: Credentials (raw values — never credential IDs)
	trelloApiKey: string;
	trelloToken: string;
	jiraEmail: string;
	jiraApiToken: string;
	jiraBaseUrl: string;
	linearApiKey: string;
	verificationResult: { provider: Provider; display: string } | null;
	verifyError: string | null;
	// Step 3: Board/Project
	trelloBoardId: string;
	trelloBoards: TrelloBoardOption[];
	jiraProjectKey: string;
	jiraProjects: JiraProjectOption[];
	linearTeamId: string;
	linearTeams: LinearTeamOption[];
	linearProjectId: string;
	linearProjects: LinearProjectOption[];
	// Step 4: Field mapping
	trelloBoardDetails: TrelloBoardDetails | null;
	jiraProjectDetails: JiraProjectDetails | null;
	linearTeamDetails: LinearTeamDetails | null;
	// Trello mappings
	trelloListMappings: Record<string, string>;
	trelloLabelMappings: Record<string, string>;
	trelloCostFieldId: string;
	// JIRA mappings
	jiraStatusMappings: Record<string, string>;
	jiraIssueTypes: Record<string, string>;
	jiraLabels: Record<string, string>;
	jiraCostFieldId: string;
	// Linear mappings
	linearStatusMappings: Record<string, string>;
	linearLabels: Record<string, string>;
	// Editing mode
	isEditing: boolean;
	hasStoredCredentials: boolean; // true in edit mode when provider credentials exist in project_credentials
	/**
	 * Provider that was loaded from the server at INIT_EDIT time. Used by the save flow
	 * to clean up the prior provider's credentials when the user switches provider
	 * mid-edit. Undefined on first-time setup.
	 */
	previousProvider?: Provider;
}

export type WizardAction =
	| { type: 'SET_PROVIDER'; provider: Provider }
	| { type: 'SET_TRELLO_API_KEY'; value: string }
	| { type: 'SET_TRELLO_TOKEN'; value: string }
	| { type: 'SET_JIRA_EMAIL'; value: string }
	| { type: 'SET_JIRA_API_TOKEN'; value: string }
	| { type: 'SET_JIRA_BASE_URL'; url: string }
	| { type: 'SET_LINEAR_API_KEY'; value: string }
	| {
			type: 'SET_VERIFICATION';
			result: { provider: Provider; display: string } | null;
			error?: string | null;
	  }
	| { type: 'SET_TRELLO_BOARDS'; boards: TrelloBoardOption[] }
	| { type: 'SET_TRELLO_BOARD_ID'; id: string }
	| { type: 'SET_JIRA_PROJECTS'; projects: JiraProjectOption[] }
	| { type: 'SET_JIRA_PROJECT_KEY'; key: string }
	| { type: 'SET_LINEAR_TEAMS'; teams: LinearTeamOption[] }
	| { type: 'SET_LINEAR_TEAM_ID'; id: string }
	| { type: 'SET_LINEAR_TEAM_DETAILS'; details: LinearTeamDetails | null }
	| { type: 'SET_LINEAR_PROJECTS'; projects: LinearProjectOption[] }
	| { type: 'SET_LINEAR_PROJECT_ID'; value: string }
	| { type: 'SET_TRELLO_BOARD_DETAILS'; details: TrelloBoardDetails | null }
	| { type: 'SET_JIRA_PROJECT_DETAILS'; details: JiraProjectDetails | null }
	| { type: 'SET_TRELLO_LIST_MAPPING'; key: string; value: string }
	| { type: 'SET_TRELLO_LABEL_MAPPING'; key: string; value: string }
	| { type: 'SET_TRELLO_COST_FIELD'; id: string }
	| { type: 'SET_JIRA_STATUS_MAPPING'; key: string; value: string }
	| { type: 'SET_JIRA_ISSUE_TYPE'; key: string; value: string }
	| { type: 'SET_JIRA_LABEL'; key: string; value: string }
	| { type: 'SET_JIRA_COST_FIELD'; id: string }
	| { type: 'SET_LINEAR_STATUS_MAPPING'; key: string; value: string }
	| { type: 'SET_LINEAR_LABEL'; key: string; value: string }
	| { type: 'INIT_EDIT'; state: Partial<WizardState> }
	| { type: 'ADD_TRELLO_BOARD_LABEL'; label: { id: string; name: string; color: string } }
	| { type: 'ADD_LINEAR_TEAM_LABEL'; label: { id: string; name: string; color: string } }
	| {
			type: 'ADD_TRELLO_BOARD_CUSTOM_FIELD';
			customField: { id: string; name: string; type: string };
	  }
	| { type: 'ADD_JIRA_PROJECT_CUSTOM_FIELD'; field: { id: string; name: string; custom: boolean } };

// ============================================================================
// Initial state and constants
// ============================================================================

export function createInitialState(): WizardState {
	return {
		provider: 'trello',
		verificationResult: null,
		verifyError: null,
		...createInitialTrelloState(),
		...createInitialJiraState(),
		...createInitialLinearState(),
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
			// Preserve edit-mode flags so a provider switch on an existing integration
			// still knows which provider to clean up at save time.
			return {
				...createInitialState(),
				provider: action.provider,
				isEditing: state.isEditing,
				previousProvider: state.previousProvider,
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
		case 'SET_LINEAR_API_KEY':
			return {
				...state,
				linearApiKey: action.value,
				verificationResult: null,
				verifyError: null,
			};
		case 'SET_VERIFICATION':
			return { ...state, verificationResult: action.result, verifyError: action.error ?? null };
		case 'SET_TRELLO_BOARDS':
			return { ...state, trelloBoards: action.boards };
		case 'SET_TRELLO_BOARD_ID':
			return {
				...state,
				...resetTrelloBoardState(action.id),
			};
		case 'SET_JIRA_PROJECTS':
			return { ...state, jiraProjects: action.projects };
		case 'SET_JIRA_PROJECT_KEY':
			return {
				...state,
				...resetJiraProjectState(action.key),
			};
		case 'SET_LINEAR_TEAMS':
			return { ...state, linearTeams: action.teams };
		case 'SET_LINEAR_TEAM_ID':
			return {
				...state,
				...resetLinearTeamState(action.id),
			};
		case 'SET_LINEAR_PROJECTS':
			return { ...state, linearProjects: action.projects };
		case 'SET_LINEAR_PROJECT_ID':
			return { ...state, linearProjectId: action.value };
		case 'SET_LINEAR_TEAM_DETAILS':
			return { ...state, linearTeamDetails: action.details };
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
		case 'SET_LINEAR_STATUS_MAPPING':
			return {
				...state,
				linearStatusMappings: { ...state.linearStatusMappings, [action.key]: action.value },
			};
		case 'SET_LINEAR_LABEL':
			return {
				...state,
				linearLabels: { ...state.linearLabels, [action.key]: action.value },
			};
		case 'INIT_EDIT': {
			const merged = { ...state, ...action.state, isEditing: true };
			// Snapshot the loaded provider so a later SET_PROVIDER knows what to clean up.
			merged.previousProvider = merged.provider;
			return merged;
		}
		case 'ADD_TRELLO_BOARD_LABEL':
			if (!state.trelloBoardDetails) return state;
			return {
				...state,
				trelloBoardDetails: {
					...state.trelloBoardDetails,
					labels: [...state.trelloBoardDetails.labels, action.label],
				},
			};
		case 'ADD_LINEAR_TEAM_LABEL':
			if (!state.linearTeamDetails) return state;
			return {
				...state,
				linearTeamDetails: {
					...state.linearTeamDetails,
					labels: [...state.linearTeamDetails.labels, action.label],
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
	} else if (provider === 'linear') {
		editState.linearTeamId = (initialConfig.teamId as string) ?? '';
		editState.linearProjectId = (initialConfig.projectId as string) ?? '';

		const statuses = initialConfig.statuses as Record<string, string> | undefined;
		if (statuses) editState.linearStatusMappings = statuses;

		const labels = initialConfig.labels as Record<string, string> | undefined;
		if (labels) editState.linearLabels = labels;

		editState.hasStoredCredentials = configuredKeys.has('LINEAR_API_KEY');
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
			: state.provider === 'jira'
				? !!(state.jiraEmail && state.jiraApiToken && state.jiraBaseUrl)
				: !!state.linearApiKey;
	return credsReady && !!state.verificationResult;
}

export function isStep3Complete(state: WizardState): boolean {
	if (state.provider === 'trello') return !!state.trelloBoardId;
	if (state.provider === 'jira') return !!state.jiraProjectKey;
	return !!state.linearTeamId;
}

export function isStep4Complete(state: WizardState): boolean {
	if (state.provider === 'trello') return Object.keys(state.trelloListMappings).length > 0;
	if (state.provider === 'jira') return Object.keys(state.jiraStatusMappings).length > 0;
	return Object.keys(state.linearStatusMappings).length > 0;
}

export function areCredentialsReady(state: WizardState): boolean {
	if (state.provider === 'trello') return !!(state.trelloApiKey && state.trelloToken);
	if (state.provider === 'jira')
		return !!(state.jiraEmail && state.jiraApiToken && state.jiraBaseUrl);
	return !!state.linearApiKey;
}

/**
 * Returns `true` when a wizard mutation (verify, createLabel, createCustomField)
 * should pass `projectId` to the backend — meaning: edit mode is active, the
 * provider has stored credentials in `project_credentials`, and the user has
 * NOT re-typed the primary API key in the form (because `buildEditState`
 * intentionally leaves raw credentials blank for security).
 *
 * `resolvePMCredentials` on the backend (`src/api/routers/pm-discovery.ts`)
 * resolves stored credentials when `projectId` is supplied, so this check
 * lets edit-mode mutations work without the user re-typing their key.
 *
 * Fresh setup (no `isEditing`) → false → mutation passes `credentials` from
 * form state (current behavior).
 */
export function shouldUseStoredCredentials(state: WizardState): boolean {
	if (!state.isEditing || !state.hasStoredCredentials) return false;
	if (state.provider === 'trello') return !state.trelloApiKey;
	if (state.provider === 'jira') return !state.jiraApiToken;
	return !state.linearApiKey;
}

/**
 * Build the Trello integration config payload from wizard state.
 * Pure function so it can be unit-tested without the React runtime.
 */
export function buildTrelloIntegrationConfig(state: WizardState): Record<string, unknown> {
	return {
		boardId: state.trelloBoardId,
		lists: state.trelloListMappings,
		labels: state.trelloLabelMappings,
		...(state.trelloCostFieldId ? { customFields: { cost: state.trelloCostFieldId } } : {}),
	};
}

/**
 * Build the JIRA integration config payload from wizard state.
 * Pure function so it can be unit-tested without the React runtime.
 */
export function buildJiraIntegrationConfig(state: WizardState): Record<string, unknown> {
	return {
		projectKey: state.jiraProjectKey,
		baseUrl: state.jiraBaseUrl,
		statuses: state.jiraStatusMappings,
		...(Object.keys(state.jiraIssueTypes).length > 0 ? { issueTypes: state.jiraIssueTypes } : {}),
		...(Object.keys(state.jiraLabels).length > 0 ? { labels: state.jiraLabels } : {}),
		...(state.jiraCostFieldId ? { customFields: { cost: state.jiraCostFieldId } } : {}),
	};
}

/**
 * Build the Linear integration config payload from wizard state.
 * Pure function so it can be unit-tested without the React runtime.
 */
export function buildLinearIntegrationConfig(state: WizardState): Record<string, unknown> {
	return {
		teamId: state.linearTeamId,
		...(state.linearProjectId ? { projectId: state.linearProjectId } : {}),
		statuses: state.linearStatusMappings,
		...(Object.keys(state.linearLabels).length > 0 ? { labels: state.linearLabels } : {}),
	};
}

/**
 * Map the provider's webhook listing into the shape expected by `WebhookStep`.
 * Linear webhooks are configured manually outside the wizard; Trello/JIRA come
 * from the corresponding API listing.
 */
export function deriveActiveWebhooks(
	provider: Provider,
	webhooksData:
		| {
				trello?: ReadonlyArray<{ id: string | number; callbackURL: string; active: boolean }>;
				jira?: ReadonlyArray<{ id: string | number; url: string; enabled: boolean }>;
		  }
		| undefined,
): Array<{ id: string; url: string; active: boolean }> {
	if (provider === 'trello') {
		return (webhooksData?.trello ?? []).map((w) => ({
			id: String(w.id),
			url: w.callbackURL,
			active: w.active,
		}));
	}
	if (provider === 'jira') {
		return (webhooksData?.jira ?? []).map((w) => ({
			id: String(w.id),
			url: w.url,
			active: w.enabled,
		}));
	}
	// Linear: webhooks are configured manually
	return [];
}
