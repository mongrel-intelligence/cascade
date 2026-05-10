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
