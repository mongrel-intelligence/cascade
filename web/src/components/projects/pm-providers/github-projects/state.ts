export interface GitHubProjectsOwnerOption {
	login: string;
	type: 'user' | 'organization';
}

export interface GitHubProjectsProjectOption {
	id: string;
	title: string;
	url: string;
}

export interface GitHubProjectsStatusOption {
	id: string;
	name: string;
	color?: string;
}

export interface GitHubProjectsWizardStateSlice {
	githubProjectsToken: string;
	githubProjectsOwner: string;
	githubProjectsOwnerType: 'user' | 'organization';
	githubProjectsOwners: GitHubProjectsOwnerOption[];
	githubProjectsProjectId: string;
	githubProjectsProjects: GitHubProjectsProjectOption[];
	githubProjectsStatusOptions: GitHubProjectsStatusOption[];
	githubProjectsStatusMappings: Record<string, string>;
}

interface VerificationState {
	verificationResult: { provider: string; display: string } | null;
	verifyError: string | null;
}

export type GitHubProjectsWizardAction =
	| { type: 'SET_GITHUB_PROJECTS_TOKEN'; value: string }
	| { type: 'SET_GITHUB_PROJECTS_OWNER'; login: string; ownerType: 'user' | 'organization' }
	| { type: 'SET_GITHUB_PROJECTS_OWNERS'; owners: GitHubProjectsOwnerOption[] }
	| { type: 'SET_GITHUB_PROJECTS_PROJECT_ID'; id: string }
	| { type: 'SET_GITHUB_PROJECTS_PROJECTS'; projects: GitHubProjectsProjectOption[] }
	| { type: 'SET_GITHUB_PROJECTS_STATUS_OPTIONS'; options: GitHubProjectsStatusOption[] }
	| { type: 'SET_GITHUB_PROJECTS_STATUS_MAPPING'; key: string; value: string }
	| { type: 'RESET_GITHUB_PROJECTS_PROJECT_STATE' };

export function createInitialGitHubProjectsState(): GitHubProjectsWizardStateSlice {
	return {
		githubProjectsToken: '',
		githubProjectsOwner: '',
		githubProjectsOwnerType: 'user',
		githubProjectsOwners: [],
		githubProjectsProjectId: '',
		githubProjectsProjects: [],
		githubProjectsStatusOptions: [],
		githubProjectsStatusMappings: {},
	};
}

export function isGitHubProjectsWizardAction(action: {
	type: string;
}): action is GitHubProjectsWizardAction {
	return action.type.includes('GITHUB_PROJECTS');
}

export function githubProjectsWizardReducer<
	T extends GitHubProjectsWizardStateSlice & VerificationState,
>(state: T, action: GitHubProjectsWizardAction): T {
	switch (action.type) {
		case 'SET_GITHUB_PROJECTS_TOKEN':
			return {
				...state,
				githubProjectsToken: action.value,
				verificationResult: null,
				verifyError: null,
			};
		case 'SET_GITHUB_PROJECTS_OWNER':
			return {
				...state,
				githubProjectsOwner: action.login,
				githubProjectsOwnerType: action.ownerType,
				...resetGitHubProjectsProjectState(),
			};
		case 'SET_GITHUB_PROJECTS_OWNERS':
			return { ...state, githubProjectsOwners: action.owners };
		case 'SET_GITHUB_PROJECTS_PROJECT_ID':
			return {
				...state,
				githubProjectsProjectId: action.id,
				githubProjectsStatusMappings: {},
			};
		case 'SET_GITHUB_PROJECTS_PROJECTS':
			return { ...state, githubProjectsProjects: action.projects };
		case 'SET_GITHUB_PROJECTS_STATUS_OPTIONS':
			return { ...state, githubProjectsStatusOptions: action.options };
		case 'SET_GITHUB_PROJECTS_STATUS_MAPPING':
			return {
				...state,
				githubProjectsStatusMappings: {
					...state.githubProjectsStatusMappings,
					[action.key]: action.value,
				},
			};
		case 'RESET_GITHUB_PROJECTS_PROJECT_STATE':
			return { ...state, ...resetGitHubProjectsProjectState() };
	}
}

export function resetGitHubProjectsProjectState(): Pick<
	GitHubProjectsWizardStateSlice,
	| 'githubProjectsProjectId'
	| 'githubProjectsProjects'
	| 'githubProjectsStatusOptions'
	| 'githubProjectsStatusMappings'
> {
	return {
		githubProjectsProjectId: '',
		githubProjectsProjects: [],
		githubProjectsStatusOptions: [],
		githubProjectsStatusMappings: {},
	};
}
