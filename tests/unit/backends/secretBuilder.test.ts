import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config/provider.js', () => ({
	getAllProjectCredentials: vi.fn(),
}));

vi.mock('../../../src/github/personas.js', () => ({
	getPersonaToken: vi.fn(),
}));

import type { AgentProfile } from '../../../src/agents/definitions/profiles.js';
import { ENV_VAR_NAME } from '../../../src/backends/progressState.js';
import {
	augmentProjectSecrets,
	GITHUB_ACK_COMMENT_ID_ENV_VAR,
	injectGitHubAckCommentId,
	injectProgressCommentId,
	resolveGitHubToken,
} from '../../../src/backends/secretBuilder.js';
import { getAllProjectCredentials } from '../../../src/config/provider.js';
import { getPersonaToken } from '../../../src/github/personas.js';
import type { AgentInput, ProjectConfig } from '../../../src/types/index.js';

const mockGetAllProjectCredentials = vi.mocked(getAllProjectCredentials);
const mockGetPersonaToken = vi.mocked(getPersonaToken);

function makeProject(overrides?: Partial<ProjectConfig>): ProjectConfig {
	return {
		id: 'test-project',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: { boardId: 'b1', lists: {}, labels: {} },
		...overrides,
	};
}

function makeProfile(overrides?: Partial<AgentProfile>): AgentProfile {
	return {
		filterTools: (tools) => tools,
		allCapabilities: ['fs:read', 'fs:write', 'shell:exec'],
		needsGitHubToken: false,
		finishHooks: {},
		fetchContext: vi.fn().mockResolvedValue([]),
		buildTaskPrompt: () => 'Process the work item',
		capabilities: {
			required: ['fs:read'],
			optional: ['fs:write', 'shell:exec'],
		},
		...overrides,
	};
}

beforeEach(() => {
	mockGetAllProjectCredentials.mockResolvedValue({});
});

describe('augmentProjectSecrets', () => {
	it('injects CASCADE_BASE_BRANCH from project.baseBranch', async () => {
		const project = makeProject({ baseBranch: 'develop' });
		const secrets = await augmentProjectSecrets(project, 'implementation', {} as AgentInput);
		expect(secrets.CASCADE_BASE_BRANCH).toBe('develop');
	});

	it('does not inject CASCADE_BASE_BRANCH when baseBranch is undefined', async () => {
		const project = makeProject({ baseBranch: undefined });
		const secrets = await augmentProjectSecrets(project, 'implementation', {} as AgentInput);
		expect(secrets.CASCADE_BASE_BRANCH).toBeUndefined();
	});

	it('injects CASCADE_REPO_OWNER and CASCADE_REPO_NAME from project.repo', async () => {
		const project = makeProject({ repo: 'acme/widgets' });
		const secrets = await augmentProjectSecrets(project, 'implementation', {} as AgentInput);
		expect(secrets.CASCADE_REPO_OWNER).toBe('acme');
		expect(secrets.CASCADE_REPO_NAME).toBe('widgets');
	});

	it('does not inject repo owner/name when repo is missing', async () => {
		const project = makeProject({ repo: undefined });
		const secrets = await augmentProjectSecrets(project, 'implementation', {} as AgentInput);
		expect(secrets.CASCADE_REPO_OWNER).toBeUndefined();
		expect(secrets.CASCADE_REPO_NAME).toBeUndefined();
	});

	it('injects CASCADE_AGENT_TYPE', async () => {
		const project = makeProject();
		const secrets = await augmentProjectSecrets(project, 'review', {} as AgentInput);
		expect(secrets.CASCADE_AGENT_TYPE).toBe('review');
	});

	it('injects CASCADE_REVIEW_EVENT_POLICY when the agent policy is comment-only', async () => {
		const project = makeProject({
			agentReviewEventPolicies: { review: 'comment-only' },
		});
		const secrets = await augmentProjectSecrets(project, 'review', {} as AgentInput);
		expect(secrets.CASCADE_REVIEW_EVENT_POLICY).toBe('comment-only');
	});

	it('does not inject CASCADE_REVIEW_EVENT_POLICY under the default policy', async () => {
		const project = makeProject();
		const secrets = await augmentProjectSecrets(project, 'review', {} as AgentInput);
		expect(secrets.CASCADE_REVIEW_EVENT_POLICY).toBeUndefined();
	});

	it('does not inject CASCADE_REVIEW_EVENT_POLICY for agents without a comment-only policy', async () => {
		const project = makeProject({
			agentReviewEventPolicies: { review: 'comment-only' },
		});
		const secrets = await augmentProjectSecrets(project, 'implementation', {} as AgentInput);
		expect(secrets.CASCADE_REVIEW_EVENT_POLICY).toBeUndefined();
	});

	it('injects work item and PR runtime metadata from agent input', async () => {
		const project = makeProject();
		const secrets = await augmentProjectSecrets(project, 'review', {
			workItemId: 'card-123',
			workItemUrl: 'https://trello.com/c/card123',
			workItemTitle: 'Fix runtime context',
			prNumber: 42,
			prUrl: 'https://github.com/acme/widgets/pull/42',
			prTitle: 'fix: runtime context',
		} as AgentInput);

		expect(secrets).toMatchObject({
			CASCADE_WORK_ITEM_ID: 'card-123',
			CASCADE_WORK_ITEM_URL: 'https://trello.com/c/card123',
			CASCADE_WORK_ITEM_TITLE: 'Fix runtime context',
			CASCADE_PR_NUMBER: '42',
			CASCADE_PR_URL: 'https://github.com/acme/widgets/pull/42',
			CASCADE_PR_TITLE: 'fix: runtime context',
		});
	});

	it('omits CASCADE_PM_TYPE for SCM-only projects (no pm provider)', async () => {
		const project = makeProject();
		const secrets = await augmentProjectSecrets(project, 'implementation', {} as AgentInput);
		expect(secrets.CASCADE_PM_TYPE).toBeUndefined();
	});

	it('injects CASCADE_PM_TYPE from project.pm.type when set', async () => {
		const project = makeProject({ pm: { type: 'jira' } });
		const secrets = await augmentProjectSecrets(project, 'implementation', {} as AgentInput);
		expect(secrets.CASCADE_PM_TYPE).toBe('jira');
	});

	it('injects JIRA env vars when project.jira is set', async () => {
		const project = makeProject({
			jira: {
				projectKey: 'PROJ',
				baseUrl: 'https://acme.atlassian.net',
			},
		});
		const secrets = await augmentProjectSecrets(project, 'implementation', {} as AgentInput);
		expect(secrets.CASCADE_JIRA_PROJECT_KEY).toBe('PROJ');
		expect(secrets.CASCADE_JIRA_BASE_URL).toBe('https://acme.atlassian.net');
		expect(secrets.JIRA_BASE_URL).toBe('https://acme.atlassian.net');
	});

	it('injects CASCADE_JIRA_STATUSES as JSON when jira.statuses is set', async () => {
		const statuses = { todo: 'To Do', done: 'Done' };
		const project = makeProject({
			jira: {
				projectKey: 'PROJ',
				baseUrl: 'https://acme.atlassian.net',
				statuses,
			},
		});
		const secrets = await augmentProjectSecrets(project, 'implementation', {} as AgentInput);
		expect(secrets.CASCADE_JIRA_STATUSES).toBe(JSON.stringify(statuses));
	});

	it("defaults CASCADE_JIRA_AUTH_TYPE to 'basic' when jira.authType is absent (MNG-1741)", async () => {
		const project = makeProject({
			jira: {
				projectKey: 'PROJ',
				baseUrl: 'https://acme.atlassian.net',
			},
		});
		const secrets = await augmentProjectSecrets(project, 'implementation', {} as AgentInput);
		expect(secrets.CASCADE_JIRA_AUTH_TYPE).toBe('basic');
	});

	it("injects CASCADE_JIRA_AUTH_TYPE='scoped' when jira.authType is 'scoped' (MNG-1741)", async () => {
		const project = makeProject({
			jira: {
				projectKey: 'PROJ',
				baseUrl: 'https://acme.atlassian.net',
				authType: 'scoped',
			},
		});
		const secrets = await augmentProjectSecrets(project, 'implementation', {} as AgentInput);
		expect(secrets.CASCADE_JIRA_AUTH_TYPE).toBe('scoped');
	});

	it("injects CASCADE_JIRA_AUTH_TYPE='basic' when jira.authType is explicitly 'basic' (MNG-1741)", async () => {
		const project = makeProject({
			jira: {
				projectKey: 'PROJ',
				baseUrl: 'https://acme.atlassian.net',
				authType: 'basic',
			},
		});
		const secrets = await augmentProjectSecrets(project, 'implementation', {} as AgentInput);
		expect(secrets.CASCADE_JIRA_AUTH_TYPE).toBe('basic');
	});

	it('does NOT inject CASCADE_JIRA_AUTH_TYPE for non-JIRA projects (MNG-1741)', async () => {
		const trelloProject = makeProject(); // default Trello fixture
		const secrets = await augmentProjectSecrets(trelloProject, 'implementation', {} as AgentInput);
		expect(secrets).not.toHaveProperty('CASCADE_JIRA_AUTH_TYPE');
	});

	it('injects CASCADE_LINEAR_* env vars when project is Linear-backed', async () => {
		const statuses = { backlog: 'state-bl', todo: 'state-td' };
		const project = makeProject({
			pm: { type: 'linear' },
			linear: {
				teamId: 'team-uuid-1',
				projectId: 'proj-uuid-2',
				statuses,
				labels: {},
			},
		} as Partial<ProjectConfig>);
		const secrets = await augmentProjectSecrets(project, 'implementation', {} as AgentInput);

		expect(secrets.CASCADE_LINEAR_TEAM_ID).toBe('team-uuid-1');
		expect(secrets.CASCADE_LINEAR_PROJECT_ID).toBe('proj-uuid-2');
		expect(secrets.CASCADE_LINEAR_STATUSES).toBe(JSON.stringify(statuses));
	});

	it('injects CASCADE_GITHUB_PROJECTS_* env vars when project is GitHub-Projects-backed', async () => {
		const statuses = { todo: 'opt-todo', done: 'opt-done' };
		const project = makeProject({
			pm: { type: 'github-projects' },
			githubProjects: {
				projectId: 'PVT_project',
				owner: 'octocat',
				ownerType: 'user',
				statuses,
				labels: { processing: 'label-processing' },
			},
		} as Partial<ProjectConfig>);
		const secrets = await augmentProjectSecrets(project, 'implementation', {} as AgentInput);

		expect(secrets.CASCADE_GITHUB_PROJECTS_PROJECT_ID).toBe('PVT_project');
		expect(secrets.CASCADE_GITHUB_PROJECTS_OWNER).toBe('octocat');
		expect(secrets.CASCADE_GITHUB_PROJECTS_OWNER_TYPE).toBe('user');
		expect(secrets.CASCADE_GITHUB_PROJECTS_STATUSES).toBe(JSON.stringify(statuses));
		expect(secrets.CASCADE_GITHUB_PROJECTS_LABELS).toBe(
			JSON.stringify({ processing: 'label-processing' }),
		);
		expect(secrets.CASCADE_PM_TYPE).toBe('github-projects');
	});

	it('does NOT inject CASCADE_GITHUB_PROJECTS_* for Trello projects', async () => {
		const secrets = await augmentProjectSecrets(makeProject(), 'implementation', {} as AgentInput);
		expect(secrets).not.toHaveProperty('CASCADE_GITHUB_PROJECTS_PROJECT_ID');
	});

	it('omits CASCADE_LINEAR_PROJECT_ID when linear.projectId is not set', async () => {
		const project = makeProject({
			pm: { type: 'linear' },
			linear: { teamId: 'T1', statuses: {}, labels: {} },
		} as Partial<ProjectConfig>);
		const secrets = await augmentProjectSecrets(project, 'implementation', {} as AgentInput);

		expect(secrets.CASCADE_LINEAR_TEAM_ID).toBe('T1');
		expect(secrets).not.toHaveProperty('CASCADE_LINEAR_PROJECT_ID');
	});

	it('does NOT inject CASCADE_LINEAR_* for Trello/JIRA projects', async () => {
		const trelloProject = makeProject(); // default Trello fixture
		const trelloSecrets = await augmentProjectSecrets(
			trelloProject,
			'implementation',
			{} as AgentInput,
		);
		expect(trelloSecrets).not.toHaveProperty('CASCADE_LINEAR_TEAM_ID');
		expect(trelloSecrets).not.toHaveProperty('CASCADE_LINEAR_STATUSES');

		const jiraProject = makeProject({
			pm: { type: 'jira' },
			jira: { projectKey: 'PROJ', baseUrl: 'https://acme.atlassian.net' },
		});
		const jiraSecrets = await augmentProjectSecrets(
			jiraProject,
			'implementation',
			{} as AgentInput,
		);
		expect(jiraSecrets).not.toHaveProperty('CASCADE_LINEAR_TEAM_ID');
		expect(jiraSecrets).not.toHaveProperty('CASCADE_LINEAR_STATUSES');
	});

	it('merges existing project credentials with injected vars', async () => {
		mockGetAllProjectCredentials.mockResolvedValue({
			GITHUB_TOKEN: 'gh-token',
			TRELLO_API_KEY: 'trello-key',
		});
		const project = makeProject();
		const secrets = await augmentProjectSecrets(project, 'implementation', {} as AgentInput);
		expect(secrets.GITHUB_TOKEN).toBe('gh-token');
		expect(secrets.TRELLO_API_KEY).toBe('trello-key');
		expect(secrets.CASCADE_AGENT_TYPE).toBe('implementation');
	});

	it('calls getAllProjectCredentials with the project id', async () => {
		const project = makeProject({ id: 'my-project' });
		await augmentProjectSecrets(project, 'implementation', {} as AgentInput);
		expect(mockGetAllProjectCredentials).toHaveBeenCalledWith('my-project');
	});
});

describe('resolveGitHubToken', () => {
	it('returns undefined when profile.needsGitHubToken is false', async () => {
		const profile = makeProfile({ needsGitHubToken: false });
		const token = await resolveGitHubToken(profile, 'project-id', 'implementation');
		expect(token).toBeUndefined();
		expect(mockGetPersonaToken).not.toHaveBeenCalled();
	});

	it('returns persona token when profile.needsGitHubToken is true', async () => {
		mockGetPersonaToken.mockResolvedValue('persona-token-123');
		const profile = makeProfile({ needsGitHubToken: true });
		const token = await resolveGitHubToken(profile, 'project-id', 'implementation');
		expect(token).toBe('persona-token-123');
		expect(mockGetPersonaToken).toHaveBeenCalledWith('project-id', 'implementation');
	});

	it('propagates error when getPersonaToken throws', async () => {
		mockGetPersonaToken.mockRejectedValue(new Error('persona not found'));
		const profile = makeProfile({ needsGitHubToken: true });
		await expect(resolveGitHubToken(profile, 'project-id', 'implementation')).rejects.toThrow(
			'persona not found',
		);
	});
});

describe('injectProgressCommentId', () => {
	it('injects env var when workItemId and string ackCommentId are provided', () => {
		const secrets: Record<string, string> = {};
		injectProgressCommentId(secrets, 'card-123', 'ack-comment-456');
		expect(secrets[ENV_VAR_NAME]).toBe('card-123:ack-comment-456');
	});

	it('does not inject when ackCommentId is a number (GitHub ack comment)', () => {
		const secrets: Record<string, string> = {};
		injectProgressCommentId(secrets, 'card-123', 12345);
		expect(secrets[ENV_VAR_NAME]).toBeUndefined();
	});

	it('does not inject when workItemId is undefined', () => {
		const secrets: Record<string, string> = {};
		injectProgressCommentId(secrets, undefined, 'ack-comment-456');
		expect(secrets[ENV_VAR_NAME]).toBeUndefined();
	});

	it('does not inject when ackCommentId is undefined', () => {
		const secrets: Record<string, string> = {};
		injectProgressCommentId(secrets, 'card-123', undefined);
		expect(secrets[ENV_VAR_NAME]).toBeUndefined();
	});

	it('does not inject when ackCommentId is an empty string', () => {
		const secrets: Record<string, string> = {};
		injectProgressCommentId(secrets, 'card-123', '');
		expect(secrets[ENV_VAR_NAME]).toBeUndefined();
	});
});

describe('injectGitHubAckCommentId', () => {
	it('injects env var when isGitHubAck is true and ackCommentId is a number', () => {
		const secrets: Record<string, string> = {};
		injectGitHubAckCommentId(secrets, 12345, true);
		expect(secrets[GITHUB_ACK_COMMENT_ID_ENV_VAR]).toBe('12345');
	});

	it('does not inject when isGitHubAck is false (PM ack)', () => {
		const secrets: Record<string, string> = {};
		injectGitHubAckCommentId(secrets, 12345, false);
		expect(secrets[GITHUB_ACK_COMMENT_ID_ENV_VAR]).toBeUndefined();
	});

	it('does not inject when ackCommentId is a string (PM comment ID)', () => {
		const secrets: Record<string, string> = {};
		injectGitHubAckCommentId(secrets, 'string-id', true);
		expect(secrets[GITHUB_ACK_COMMENT_ID_ENV_VAR]).toBeUndefined();
	});

	it('does not inject when ackCommentId is undefined', () => {
		const secrets: Record<string, string> = {};
		injectGitHubAckCommentId(secrets, undefined, true);
		expect(secrets[GITHUB_ACK_COMMENT_ID_ENV_VAR]).toBeUndefined();
	});

	it('does not inject when ackCommentId is zero', () => {
		const secrets: Record<string, string> = {};
		injectGitHubAckCommentId(secrets, 0, true);
		expect(secrets[GITHUB_ACK_COMMENT_ID_ENV_VAR]).toBeUndefined();
	});

	it('uses the GITHUB_ACK_COMMENT_ID_ENV_VAR constant as the key', () => {
		expect(GITHUB_ACK_COMMENT_ID_ENV_VAR).toBe('CASCADE_GITHUB_ACK_COMMENT_ID');
	});
});
