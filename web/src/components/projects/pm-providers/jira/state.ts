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
	jiraProjectKey: string;
	jiraProjects: JiraProjectOption[];
	jiraProjectDetails: JiraProjectDetails | null;
	jiraStatusMappings: Record<string, string>;
	jiraIssueTypes: Record<string, string>;
	jiraLabels: Record<string, string>;
	jiraCostFieldId: string;
}

export function createInitialJiraState(): JiraWizardStateSlice {
	return {
		jiraEmail: '',
		jiraApiToken: '',
		jiraBaseUrl: '',
		jiraProjectKey: '',
		jiraProjects: [],
		jiraProjectDetails: null,
		jiraStatusMappings: {},
		jiraIssueTypes: {},
		jiraLabels: { ...INITIAL_JIRA_LABELS },
		jiraCostFieldId: '',
	};
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
