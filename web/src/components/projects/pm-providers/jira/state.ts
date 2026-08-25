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
	/**
	 * Spec 024: which issues on a SHARED JIRA project key belong to this
	 * project. Empty kind means the project is the key's default owner, which
	 * is every project that does not share a key — so the wizard adds no
	 * required input.
	 */
	jiraRoutingKind: '' | 'label' | 'component';
	jiraRoutingValue: string;
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
	| { type: 'ADD_JIRA_PROJECT_CUSTOM_FIELD'; field: { id: string; name: string; custom: boolean } }
	| {
			type: 'SET_JIRA_ROUTING_DISCRIMINATOR';
			kind: '' | 'label' | 'component';
			value: string;
	  };

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
		jiraRoutingKind: '',
		jiraRoutingValue: '',
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
		case 'SET_JIRA_ROUTING_DISCRIMINATOR': {
			// An empty value clears the whole discriminator rather than leaving a
			// kind behind: a kind without a value serialises to a routing block the
			// backend schema rejects, and clearing the field plainly means "no
			// scoping". Routing is non-secret config, so unlike the credential
			// cases this does not invalidate a verification result.
			const value = action.value;
			return value
				? { ...state, jiraRoutingKind: action.kind, jiraRoutingValue: value }
				: { ...state, jiraRoutingKind: '', jiraRoutingValue: '' };
		}
		case 'SET_JIRA_PROJECT_KEY':
			return {
				...state,
				...resetJiraProjectState(action.key),
			};
		case 'SET_JIRA_PROJECT_DETAILS':
			// MNG-1768: when project details load, auto-upgrade any legacy
			// name-valued status mappings to the locale-invariant status ID. This
			// backfills IDs when an operator edits a name-based config and keeps
			// the dropdown showing the correct current selection (the select now
			// keys on status IDs) instead of "— Select —".
			return {
				...state,
				jiraProjectDetails: action.details,
				jiraStatusMappings: normalizeJiraStatusMappingsToIds(
					state.jiraStatusMappings,
					action.details?.statuses ?? [],
				),
			};
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

/**
 * MNG-1768: upgrade legacy name-valued JIRA status mappings to locale-invariant
 * status IDs.
 *
 * For each mapping value, if it case-insensitively equals a discovered status
 * **name**, rewrite it to that status's **id**. Values that already equal a
 * status ID, or that match no discovered status (e.g. an unrecognized custom
 * status), are left untouched so we never destroy a value we can't confidently
 * re-map.
 */
export function normalizeJiraStatusMappingsToIds(
	mappings: Record<string, string>,
	statuses: Array<{ id: string; name: string }>,
): Record<string, string> {
	if (statuses.length === 0) return mappings;

	const idSet = new Set(statuses.map((s) => s.id));
	const nameToId = new Map(statuses.map((s) => [s.name.toLowerCase(), s.id]));

	let changed = false;
	const next: Record<string, string> = {};
	for (const [key, value] of Object.entries(mappings)) {
		if (value && !idSet.has(value)) {
			const mappedId = nameToId.get(value.toLowerCase());
			if (mappedId) {
				next[key] = mappedId;
				changed = true;
				continue;
			}
		}
		next[key] = value;
	}

	return changed ? next : mappings;
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
