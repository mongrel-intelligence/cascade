export interface LinearTeamOption {
	id: string;
	name: string;
	key: string;
}

export interface LinearProjectOption {
	id: string;
	name: string;
	icon: string | null;
	color: string | null;
}

export interface LinearTeamDetails {
	states: Array<{ id: string; name: string; type: string }>;
	labels: Array<{ id: string; name: string; color: string }>;
}

/**
 * Linear label mappings store workflow-label **UUIDs**, not names, because
 * Linear's GraphQL API rejects names for issueUpdate.labelIds. The wizard
 * populates these from the team's existing labels or via the create-label
 * button. Initial state is therefore empty — operators pick or create.
 */
export const INITIAL_LINEAR_LABELS: Record<string, string> = {};

export interface LinearWizardStateSlice {
	linearApiKey: string;
	linearTeamId: string;
	linearTeams: LinearTeamOption[];
	linearProjectId: string;
	linearProjects: LinearProjectOption[];
	linearTeamDetails: LinearTeamDetails | null;
	linearStatusMappings: Record<string, string>;
	linearLabels: Record<string, string>;
}

interface VerificationState {
	verificationResult: { provider: string; display: string } | null;
	verifyError: string | null;
}

export type LinearWizardAction =
	| { type: 'SET_LINEAR_API_KEY'; value: string }
	| { type: 'SET_LINEAR_TEAMS'; teams: LinearTeamOption[] }
	| { type: 'SET_LINEAR_TEAM_ID'; id: string }
	| { type: 'SET_LINEAR_TEAM_DETAILS'; details: LinearTeamDetails | null }
	| { type: 'SET_LINEAR_PROJECTS'; projects: LinearProjectOption[] }
	| { type: 'SET_LINEAR_PROJECT_ID'; value: string }
	| { type: 'SET_LINEAR_STATUS_MAPPING'; key: string; value: string }
	| { type: 'SET_LINEAR_LABEL'; key: string; value: string }
	| { type: 'ADD_LINEAR_TEAM_LABEL'; label: { id: string; name: string; color: string } };

export function createInitialLinearState(): LinearWizardStateSlice {
	return {
		linearApiKey: '',
		linearTeamId: '',
		linearTeams: [],
		linearProjectId: '',
		linearProjects: [],
		linearTeamDetails: null,
		linearStatusMappings: {},
		linearLabels: { ...INITIAL_LINEAR_LABELS },
	};
}

export function isLinearWizardAction(action: { type: string }): action is LinearWizardAction {
	return action.type.includes('LINEAR');
}

export function linearWizardReducer<T extends LinearWizardStateSlice & VerificationState>(
	state: T,
	action: LinearWizardAction,
): T {
	switch (action.type) {
		case 'SET_LINEAR_API_KEY':
			return {
				...state,
				linearApiKey: action.value,
				verificationResult: null,
				verifyError: null,
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
		case 'ADD_LINEAR_TEAM_LABEL':
			if (!state.linearTeamDetails) return state;
			return {
				...state,
				linearTeamDetails: {
					...state.linearTeamDetails,
					labels: [...state.linearTeamDetails.labels, action.label],
				},
			};
	}
}

export function resetLinearTeamState(
	linearTeamId: string,
): Pick<
	LinearWizardStateSlice,
	| 'linearTeamId'
	| 'linearTeamDetails'
	| 'linearStatusMappings'
	| 'linearProjectId'
	| 'linearProjects'
> {
	return {
		linearTeamId,
		linearTeamDetails: null,
		linearStatusMappings: {},
		linearProjectId: '',
		linearProjects: [],
	};
}
