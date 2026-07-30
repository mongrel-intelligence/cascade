import type { AgentProfile } from '../agents/definitions/profiles.js';
import { getAllProjectCredentials } from '../config/provider.js';
import {
	isCommentOnlyReview,
	REVIEW_EVENT_POLICY_ENV_VAR,
	resolveReviewEventPolicy,
} from '../config/reviewEventPolicy.js';
import { resolveUpdateChannel, UPDATE_CHANNEL_ENV_VAR } from '../config/updateChannel.js';
import { getPersonaToken } from '../github/personas.js';
import { getJiraConfig, getLinearConfig, getTrelloConfig } from '../pm/config.js';
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
function injectProjectContext(
	projectSecrets: Record<string, string>,
	project: ProjectConfig,
): void {
	projectSecrets.CASCADE_PROJECT_ID = project.id;
	if (project.orgId) projectSecrets.CASCADE_ORG_ID = project.orgId;
	if (project.name) projectSecrets.CASCADE_PROJECT_NAME = project.name;
}

function injectTrelloConfig(projectSecrets: Record<string, string>, project: ProjectConfig): void {
	const trelloConfig = getTrelloConfig(project);
	if (!trelloConfig) return;

	projectSecrets.CASCADE_TRELLO_BOARD_ID = trelloConfig.boardId;
	projectSecrets.CASCADE_TRELLO_LISTS = JSON.stringify(trelloConfig.lists);
	projectSecrets.CASCADE_TRELLO_LABELS = JSON.stringify(trelloConfig.labels);
}

function injectAgentInputContext(projectSecrets: Record<string, string>, input: AgentInput): void {
	const stringFields: Array<[keyof AgentInput, string]> = [
		['workItemId', 'CASCADE_WORK_ITEM_ID'],
		['workItemUrl', 'CASCADE_WORK_ITEM_URL'],
		['workItemTitle', 'CASCADE_WORK_ITEM_TITLE'],
		['prUrl', 'CASCADE_PR_URL'],
		['prTitle', 'CASCADE_PR_TITLE'],
	];

	for (const [field, envVar] of stringFields) {
		const value = input[field];
		if (typeof value === 'string' && value) {
			projectSecrets[envVar] = value;
		}
	}

	if (typeof input.prNumber === 'number') {
		projectSecrets.CASCADE_PR_NUMBER = String(input.prNumber);
	}
}

export async function augmentProjectSecrets(
	project: ProjectConfig,
	agentType: string,
	input: AgentInput,
): Promise<Record<string, string>> {
	const projectSecrets = await getAllProjectCredentials(project.id);

	injectProjectContext(projectSecrets, project);

	// Inject base branch so cascade-tools create-pr uses the correct target automatically
	if (project.baseBranch) {
		projectSecrets.CASCADE_BASE_BRANCH = project.baseBranch;
	}

	// Inject Trello integration config so friction reports can resolve optional PM slots.
	injectTrelloConfig(projectSecrets, project);

	// Inject JIRA integration config so cascade-tools can construct JiraPMProvider
	const jiraConfig = getJiraConfig(project);
	if (jiraConfig) {
		projectSecrets.CASCADE_JIRA_PROJECT_KEY = jiraConfig.projectKey;
		projectSecrets.CASCADE_JIRA_BASE_URL = jiraConfig.baseUrl;
		projectSecrets.JIRA_BASE_URL = jiraConfig.baseUrl;
		// Carry the JIRA auth mode into the worker so in-worker JIRA calls
		// (agent runs, friction reports) route through the correct host. Absent
		// config ⇒ 'basic' (the historical default), preserving existing projects.
		projectSecrets.CASCADE_JIRA_AUTH_TYPE = jiraConfig.authType ?? 'basic';
		if (jiraConfig.statuses) {
			projectSecrets.CASCADE_JIRA_STATUSES = JSON.stringify(jiraConfig.statuses);
		}
	}

	// Inject Linear integration config so cascade-tools can construct LinearPMProvider.
	// Without this, every `cascade-tools pm <cmd>` from inside a Linear-backed worker
	// throws "Linear integration requires teamId in config" (LinearIntegration's
	// guard) — the agent then either errors out or falls back to direct Linear API
	// calls. Mirrors the JIRA injection above.
	const linearConfig = getLinearConfig(project);
	if (linearConfig) {
		projectSecrets.CASCADE_LINEAR_TEAM_ID = linearConfig.teamId;
		if (linearConfig.projectId) {
			projectSecrets.CASCADE_LINEAR_PROJECT_ID = linearConfig.projectId;
		}
		if (linearConfig.statuses) {
			projectSecrets.CASCADE_LINEAR_STATUSES = JSON.stringify(linearConfig.statuses);
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
	injectAgentInputContext(projectSecrets, input);

	// Inject the review event policy so the cascade-tools create-pr-review
	// subprocess enforces comment-only mode. Omitted under the default (`all`)
	// policy — absence means "no restriction". In-process gadget runs resolve
	// the policy from SessionState instead (see src/gadgets/github/CreatePRReview.ts).
	const reviewEventPolicy = resolveReviewEventPolicy(project, agentType);
	if (isCommentOnlyReview(reviewEventPolicy)) {
		projectSecrets[REVIEW_EVENT_POLICY_ENV_VAR] = reviewEventPolicy;
	}

	// Inject PM type so cascade-tools uses the correct provider. Omitted for
	// SCM-only projects (no PM provider) so the worker doesn't assume Trello.
	if (project.pm?.type) {
		projectSecrets.CASCADE_PM_TYPE = project.pm.type;
	}

	// Inject the resolved update channel so the `cascade-tools pm post-comment`
	// CLI can enforce the PM-posting gate even when invoked via bash, bypassing
	// the in-process filterPostingGadgetNames filter. The orchestrator also writes
	// this value to UPDATE_CHANNEL_FILE as a fallback for the claude-code
	// subprocess-env-stripping case (see secretOrchestrator.ts).
	//
	// Scope: `pm post-comment` is the ONLY cascade-tools command that reads this
	// var. The SCM posting commands (`scm post-pr-comment`, `update-pr-comment`,
	// `reply-to-review-comment`, `create-pr-review`) do NOT gate on it, so the
	// symmetric bash bypass still exists on the SCM side for `pm-only`/`none`
	// agents. Adding the equivalent SCM CLI gate is a tracked follow-up, out of
	// scope for this PM-focused change.
	projectSecrets[UPDATE_CHANNEL_ENV_VAR] = resolveUpdateChannel(project, agentType);

	return projectSecrets;
}

/**
 * Inject the pre-seeded progress comment ID into project secrets so the
 * Claude Code subprocess can find it via the CASCADE_PROGRESS_COMMENT_ID env var.
 *
 * Only injects when ackCommentId is a string (PM comment) and workItemId is set.
 * GitHub ack comments (numeric IDs) are handled separately via session state.
 */
export function injectProgressCommentId(
	projectSecrets: Record<string, string>,
	workItemId: string | undefined,
	ackCommentId: string | number | undefined,
): void {
	if (workItemId && typeof ackCommentId === 'string' && ackCommentId) {
		projectSecrets[ENV_VAR_NAME] = `${workItemId}:${ackCommentId}`;
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
