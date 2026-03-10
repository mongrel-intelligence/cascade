import type { AgentProfile } from '../agents/definitions/profiles.js';
import { getAllProjectCredentials } from '../config/provider.js';
import { getPersonaToken } from '../github/personas.js';
import { getJiraConfig } from '../pm/config.js';
import type { AgentInput, ProjectConfig } from '../types/index.js';
import { parseRepoFullName } from '../utils/repo.js';
import { ENV_VAR_NAME } from './progressState.js';

/**
 * Env var name for the GitHub ack comment ID injected into the claude-code subprocess.
 * The `CreatePRReviewCommand` CLI reads this to delete the comment after review submission.
 */
export const GITHUB_ACK_COMMENT_ID_ENV_VAR = 'CASCADE_GITHUB_ACK_COMMENT_ID';

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

	return getPersonaToken(projectId, agentType);
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
	const jiraConfig = getJiraConfig(project);
	if (jiraConfig) {
		projectSecrets.CASCADE_JIRA_PROJECT_KEY = jiraConfig.projectKey;
		projectSecrets.CASCADE_JIRA_BASE_URL = jiraConfig.baseUrl;
		if (jiraConfig.statuses) {
			projectSecrets.CASCADE_JIRA_STATUSES = JSON.stringify(jiraConfig.statuses);
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

/**
 * Inject the pre-seeded progress comment ID into project secrets so the
 * Claude Code subprocess can find it via the CASCADE_PROGRESS_COMMENT_ID env var.
 *
 * Only injects when ackCommentId is a string (PM comment) and cardId is set.
 * GitHub ack comments (numeric IDs) are handled separately via session state.
 */
export function injectProgressCommentId(
	projectSecrets: Record<string, string>,
	cardId: string | undefined,
	ackCommentId: string | number | undefined,
): void {
	if (cardId && typeof ackCommentId === 'string' && ackCommentId) {
		projectSecrets[ENV_VAR_NAME] = `${cardId}:${ackCommentId}`;
	}
}

/**
 * Inject the GitHub ack comment ID into project secrets so the claude-code subprocess
 * can delete it immediately after posting the PR review.
 *
 * Only injects when isGitHubAck is true (numeric ackCommentId on a PR trigger).
 * This is specific to the claude-code backend path — llmist handles deletion in-process
 * via the CreatePRReview gadget's deleteInitialComment() call.
 */
export function injectGitHubAckCommentId(
	projectSecrets: Record<string, string>,
	ackCommentId: string | number | undefined,
	isGitHubAck: boolean,
): void {
	if (isGitHubAck && typeof ackCommentId === 'number' && ackCommentId) {
		projectSecrets[GITHUB_ACK_COMMENT_ID_ENV_VAR] = String(ackCommentId);
	}
}
