/**
 * JIRA authentication mode. NON-secret connection setting (mirrors
 * `baseUrl`), NOT a credential — both modes still authenticate via HTTP
 * Basic with `email:api_token`. The enum distinguishes the token class /
 * host routing:
 * - `'basic'` — classic API token; Jira REST API at the site URL.
 * - `'scoped'` — scoped API token; CASCADE routes Jira REST API calls
 *   through the `api.atlassian.com/ex/jira/{cloudId}` gateway using the
 *   token's granular scopes.
 *
 * Single source of truth for the wizard-state literal union so
 * `pm-wizard-state.ts` and the provider slice cannot drift.
 */
export type JiraWizardAuthType = 'basic' | 'scoped';

export interface JiraProjectOption {
	key: string;
	name: string;
}

export interface JiraProjectDetails {
	statuses: Array<{ name: string; id: string }>;
	issueTypes: Array<{ name: string; subtask: boolean }>;
	fields: Array<{ id: string; name: string; custom: boolean }>;
}

export const INITIAL_JIRA_LABELS: Record<string, string> = {
	processing: 'cascade-processing',
	processed: 'cascade-processed',
	error: 'cascade-error',
	readyToProcess: 'cascade-ready',
	auto: 'cascade-auto',
};

export interface JiraWizardStateSlice {
	jiraEmail: string;
	jiraApiToken: string;
	jiraBaseUrl: string;
	jiraAuthType: JiraWizardAuthType;
	jiraProjectKey: string;
	jiraProjects: JiraProjectOption[];
	jiraProjectDetails: JiraProjectDetails | null;
	jiraStatusMappings: Record<string, string>;
	jiraIssueTypes: Record<string, string>;
	jiraLabels: Record<string, string>;
	jiraCostFieldId: string;
}

interface VerificationState {
	verificationResult: { provider: string; display: string } | null;
	verifyError: string | null;
}

export type JiraWizardAction =
	| { type: 'SET_JIRA_EMAIL'; value: string }
	| { type: 'SET_JIRA_API_TOKEN'; value: string }
	| { type: 'SET_JIRA_BASE_URL'; url: string }
	| { type: 'SET_JIRA_AUTH_TYPE'; value: JiraWizardAuthType }
	| { type: 'SET_JIRA_PROJECTS'; projects: JiraProjectOption[] }
	| { type: 'SET_JIRA_PROJECT_KEY'; key: string }
	| { type: 'SET_JIRA_PROJECT_DETAILS'; details: JiraProjectDetails | null }
	| { type: 'SET_JIRA_STATUS_MAPPING'; key: string; value: string }
	| { type: 'SET_JIRA_ISSUE_TYPE'; key: string; value: string }
	| { type: 'SET_JIRA_LABEL'; key: string; value: string }
	| { type: 'SET_JIRA_COST_FIELD'; id: string }
	| { type: 'ADD_JIRA_PROJECT_CUSTOM_FIELD'; field: { id: string; name: string; custom: boolean } };

export function createInitialJiraState(): JiraWizardStateSlice {
	return {
		jiraEmail: '',
		jiraApiToken: '',
		jiraBaseUrl: '',
		jiraAuthType: 'basic',
		jiraProjectKey: '',
		jiraProjects: [],
		jiraProjectDetails: null,
		jiraStatusMappings: {},
		jiraIssueTypes: {},
		jiraLabels: { ...INITIAL_JIRA_LABELS },
		jiraCostFieldId: '',
	};
}

export function isJiraWizardAction(action: { type: string }): action is JiraWizardAction {
	return action.type.includes('JIRA');
}

export function jiraWizardReducer<T extends JiraWizardStateSlice & VerificationState>(
	state: T,
	action: JiraWizardAction,
): T {
	switch (action.type) {
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
			return {
				...state,
				jiraBaseUrl: action.url,
				verificationResult: null,
				verifyError: null,
			};
		case 'SET_JIRA_AUTH_TYPE':
			// auth_type changes the host routing verification runs against, so
			// any prior "Verified as …" result is now stale — clear it.
			return {
				...state,
				jiraAuthType: action.value,
				verificationResult: null,
				verifyError: null,
			};
		case 'SET_JIRA_PROJECTS':
			return { ...state, jiraProjects: action.projects };
		case 'SET_JIRA_PROJECT_KEY':
			return {
				...state,
				...resetJiraProjectState(action.key),
			};
		case 'SET_JIRA_PROJECT_DETAILS':
			return { ...state, jiraProjectDetails: action.details };
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
		case 'ADD_JIRA_PROJECT_CUSTOM_FIELD':
			if (!state.jiraProjectDetails) return state;
			return {
				...state,
				jiraProjectDetails: {
					...state.jiraProjectDetails,
					fields: [...state.jiraProjectDetails.fields, action.field],
				},
			};
	}
}

export function resetJiraProjectState(
	jiraProjectKey: string,
): Pick<
	JiraWizardStateSlice,
	| 'jiraProjectKey'
	| 'jiraProjectDetails'
	| 'jiraStatusMappings'
	| 'jiraIssueTypes'
	| 'jiraCostFieldId'
> {
	return {
		jiraProjectKey,
		jiraProjectDetails: null,
		jiraStatusMappings: {},
		jiraIssueTypes: {},
		jiraCostFieldId: '',
	};
}
