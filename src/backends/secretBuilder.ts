import { getAllProjectCredentials } from '../config/provider.js';
import { getPersonaToken } from '../github/personas.js';
import type { AgentInput, ProjectConfig } from '../types/index.js';
import { parseRepoFullName } from '../utils/repo.js';
import type { AgentProfile } from './agent-profiles.js';

/**
 * Resolve the GitHub token for profiles that need GitHub client access.
 * Uses the persona token system (GITHUB_TOKEN_IMPLEMENTER / GITHUB_TOKEN_REVIEWER).
 */
export async function resolveGitHubToken(
	profile: AgentProfile,
	projectId: string,
	agentType: string,
): Promise<string | undefined> {
	if (!profile.needsGitHubToken) return undefined;

	try {
		return await getPersonaToken(projectId, agentType);
	} catch {
		// Fall back to legacy GITHUB_TOKEN for projects not yet migrated
		const secrets = await getAllProjectCredentials(projectId);
		return secrets.GITHUB_TOKEN;
	}
}

/**
 * Build the per-project secrets map by fetching credentials and injecting
 * CASCADE-specific env vars (base branch, JIRA config, repo owner/name, agent type, PM type).
 */
export async function augmentProjectSecrets(
	project: ProjectConfig,
	agentType: string,
	_input: AgentInput,
): Promise<Record<string, string>> {
	const projectSecrets = await getAllProjectCredentials(project.id);

	// Inject base branch so cascade-tools create-pr uses the correct target automatically
	if (project.baseBranch) {
		projectSecrets.CASCADE_BASE_BRANCH = project.baseBranch;
	}

	// Inject JIRA integration config so cascade-tools can construct JiraPMProvider
	if (project.jira) {
		projectSecrets.CASCADE_JIRA_PROJECT_KEY = project.jira.projectKey;
		projectSecrets.CASCADE_JIRA_BASE_URL = project.jira.baseUrl;
		if (project.jira.statuses) {
			projectSecrets.CASCADE_JIRA_STATUSES = JSON.stringify(project.jira.statuses);
		}
	}

	// Inject repo owner/name so cascade-tools auto-resolve without flags
	const { owner: repoOwner, repo: repoName } = project.repo
		? parseRepoFullName(project.repo)
		: { owner: '', repo: '' };
	if (repoOwner && repoName) {
		projectSecrets.CASCADE_REPO_OWNER = repoOwner;
		projectSecrets.CASCADE_REPO_NAME = repoName;
	}

	// Inject agent type so Finish command can validate without flags
	projectSecrets.CASCADE_AGENT_TYPE = agentType;

	// Inject PM type so cascade-tools uses the correct provider
	projectSecrets.CASCADE_PM_TYPE = project.pm?.type ?? 'trello';

	return projectSecrets;
}
