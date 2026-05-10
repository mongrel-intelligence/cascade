/**
 * PM Wizard state management: types, initial state, reducer, and step-completion helpers.
 * Has zero imports from other pm-wizard files to avoid circular dependencies.
 */
import type { Reducer } from 'react';
import {
	createInitialJiraState,
	INITIAL_JIRA_LABELS,
	isJiraWizardAction,
	type JiraProjectDetails,
	type JiraProjectOption,
	type JiraWizardAction,
	jiraWizardReducer,
} from './pm-providers/jira/state.js';
import {
	createInitialLinearState,
	INITIAL_LINEAR_LABELS,
	isLinearWizardAction,
	type LinearProjectOption,
	type LinearTeamDetails,
	type LinearTeamOption,
	type LinearWizardAction,
	linearWizardReducer,
} from './pm-providers/linear/state.js';
import {
	createInitialTrelloState,
	isTrelloWizardAction,
	type TrelloBoardDetails,
	type TrelloBoardOption,
	type TrelloWizardAction,
	trelloWizardReducer,
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
 * the provider's credential fields (e.g. `asanaApiKey: string`) and the
 * reducer with the corresponding action types. Provider config-shape hydration
 * belongs on that provider's `ProviderWizardDefinition.buildEditState`.
 * The credential-readiness path
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
	| {
			type: 'SET_VERIFICATION';
			result: { provider: Provider; display: string } | null;
			error?: string | null;
	  }
	| { type: 'INIT_EDIT'; state: Partial<WizardState> }
	| TrelloWizardAction
	| JiraWizardAction
	| LinearWizardAction;

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
		case 'INIT_EDIT': {
			const merged = { ...state, ...action.state, isEditing: true };
			// Snapshot the loaded provider so a later SET_PROVIDER knows what to clean up.
			merged.previousProvider = merged.provider;
			return merged;
		}
		default:
			if (isTrelloWizardAction(action)) return trelloWizardReducer(state, action);
			if (isJiraWizardAction(action)) return jiraWizardReducer(state, action);
			if (isLinearWizardAction(action)) return linearWizardReducer(state, action);
			return state;
	}
};

// ============================================================================
// Step-completion helpers (pure functions)
// ============================================================================

export function isStep1Complete(state: WizardState): boolean {
	return !!state.provider;
}

/**
 * Returns `true` when a wizard mutation (verify, createLabel, createCustomField)
 * should pass `projectId` to the backend — meaning: edit mode is active, the
 * provider has stored credentials in `project_credentials`, and the user has
 * NOT re-typed the primary API key in the form (because provider-owned edit
 * hydration intentionally leaves raw credentials blank for security).
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
