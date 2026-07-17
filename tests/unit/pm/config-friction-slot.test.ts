import { describe, expect, it } from 'vitest';
import { jiraConfigSchema } from '../../../src/integrations/pm/jira/config-schema.js';
import { linearConfigSchema } from '../../../src/integrations/pm/linear/config-schema.js';
import { trelloConfigSchema } from '../../../src/integrations/pm/trello/config-schema.js';
import {
	getFrictionContainerId,
	getFrictionLabelId,
	getFrictionStatusDestination,
} from '../../../src/pm/config.js';
import type { ProjectConfig } from '../../../src/types/index.js';

function makeTrelloProject(overrides: Record<string, unknown> = {}): ProjectConfig {
	return {
		id: 'p1',
		pm: { type: 'trello' },
		trello: {
			boardId: 'board-1',
			lists: { todo: 'list-todo', friction: 'list-friction' },
			labels: {},
		},
		...overrides,
	} as unknown as ProjectConfig;
}

function makeJiraProject(overrides: Record<string, unknown> = {}): ProjectConfig {
	return {
		id: 'p1',
		pm: { type: 'jira' },
		jira: {
			projectKey: 'PROJ',
			baseUrl: 'https://acme.atlassian.net',
			statuses: { todo: 'To Do', friction: 'Friction' },
			labels: {},
		},
		...overrides,
	} as unknown as ProjectConfig;
}

function makeLinearProject(overrides: Record<string, unknown> = {}): ProjectConfig {
	return {
		id: 'p1',
		pm: { type: 'linear' },
		linear: {
			teamId: 'team-1',
			statuses: { todo: 'state-todo', friction: 'state-friction' },
		},
		...overrides,
	} as unknown as ProjectConfig;
}

function makeGitHubProjectsProject(overrides: Record<string, unknown> = {}): ProjectConfig {
	return {
		id: 'p1',
		pm: { type: 'github-projects' },
		githubProjects: {
			projectId: 'PVT_kwABC',
			owner: 'acme-org',
			ownerType: 'organization',
			statuses: { todo: 'Todo', friction: 'Friction' },
		},
		...overrides,
	} as unknown as ProjectConfig;
}

describe('getFrictionContainerId', () => {
	it('returns Trello list ID from project.trello.lists.friction', () => {
		expect(getFrictionContainerId(makeTrelloProject())).toBe('list-friction');
	});

	it('returns JIRA project key only when statuses.friction is configured', () => {
		expect(getFrictionContainerId(makeJiraProject())).toBe('PROJ');

		const project = makeJiraProject({
			jira: {
				projectKey: 'PROJ',
				baseUrl: 'https://acme.atlassian.net',
				statuses: { todo: 'To Do' },
				labels: {},
			},
		});
		expect(getFrictionContainerId(project)).toBeUndefined();
	});

	it('returns Linear team ID only when statuses.friction is configured', () => {
		expect(getFrictionContainerId(makeLinearProject())).toBe('team-1');

		const project = makeLinearProject({
			linear: { teamId: 'team-1', statuses: { todo: 'state-todo' } },
		});
		expect(getFrictionContainerId(project)).toBeUndefined();
	});

	it('returns GitHub Projects project ID only when statuses.friction is configured', () => {
		expect(getFrictionContainerId(makeGitHubProjectsProject())).toBe('PVT_kwABC');

		const project = makeGitHubProjectsProject({
			githubProjects: {
				projectId: 'PVT_kwABC',
				owner: 'acme-org',
				ownerType: 'organization',
				statuses: { todo: 'Todo' },
			},
		});
		expect(getFrictionContainerId(project)).toBeUndefined();
	});

	it('returns undefined when no PM config or Trello friction list is present', () => {
		expect(
			getFrictionContainerId({ id: 'p1', pm: undefined } as unknown as ProjectConfig),
		).toBeUndefined();

		const project = makeTrelloProject({
			trello: { boardId: 'board-1', lists: { todo: 'list-todo' }, labels: {} },
		});
		expect(getFrictionContainerId(project)).toBeUndefined();
	});
});

describe('getFrictionStatusDestination', () => {
	it('returns provider-native friction destination values', () => {
		expect(getFrictionStatusDestination(makeTrelloProject())).toBe('list-friction');
		expect(getFrictionStatusDestination(makeJiraProject())).toBe('Friction');
		expect(getFrictionStatusDestination(makeLinearProject())).toBe('state-friction');
		expect(getFrictionStatusDestination(makeGitHubProjectsProject())).toBe('Friction');
	});

	it('returns undefined when friction is unconfigured', () => {
		const trelloProject = makeTrelloProject({
			trello: { boardId: 'board-1', lists: { todo: 'list-todo' }, labels: {} },
		});
		const jiraProject = makeJiraProject({
			jira: {
				projectKey: 'PROJ',
				baseUrl: 'https://acme.atlassian.net',
				statuses: { todo: 'To Do' },
				labels: {},
			},
		});
		const linearProject = makeLinearProject({
			linear: { teamId: 'team-1', statuses: { todo: 'state-todo' } },
		});
		const githubProjectsProject = makeGitHubProjectsProject({
			githubProjects: {
				projectId: 'PVT_kwABC',
				owner: 'acme-org',
				ownerType: 'organization',
				statuses: { todo: 'Todo' },
			},
		});

		expect(getFrictionStatusDestination(trelloProject)).toBeUndefined();
		expect(getFrictionStatusDestination(jiraProject)).toBeUndefined();
		expect(getFrictionStatusDestination(linearProject)).toBeUndefined();
		expect(getFrictionStatusDestination(githubProjectsProject)).toBeUndefined();
	});

	it('returns undefined for unknown PM provider types', () => {
		expect(
			getFrictionStatusDestination({ id: 'p1', pm: undefined } as unknown as ProjectConfig),
		).toBeUndefined();
	});
});

describe('getFrictionLabelId', () => {
	// 2026-05-10: opt-in label applied at materialize time. Mirrors the
	// `getAlertLabelId` pattern from spec 019. Operators add the label key
	// to the PM integration config to enable filtering/clustering of
	// friction cards in the PM UI; absent config means cards file unlabeled.
	it('returns Trello label ID from labels[cascade-friction] when configured', () => {
		const project = makeTrelloProject({
			trello: {
				boardId: 'board-1',
				lists: { todo: 'list-todo', friction: 'list-friction' },
				labels: { 'cascade-friction': 'trello-label-friction-id' },
			},
		});
		expect(getFrictionLabelId(project)).toBe('trello-label-friction-id');
	});

	it('returns JIRA label name from labels.cascadeFriction when configured', () => {
		const project = makeJiraProject({
			jira: {
				projectKey: 'PROJ',
				baseUrl: 'https://acme.atlassian.net',
				statuses: { todo: 'To Do', friction: 'Friction' },
				labels: { cascadeFriction: 'cascade-friction' },
			},
		});
		expect(getFrictionLabelId(project)).toBe('cascade-friction');
	});

	it('returns Linear label UUID from labels.cascadeFriction when configured', () => {
		const project = makeLinearProject({
			linear: {
				teamId: 'team-1',
				statuses: { todo: 'state-todo', friction: 'state-friction' },
				labels: { cascadeFriction: 'linear-label-uuid-friction' },
			},
		});
		expect(getFrictionLabelId(project)).toBe('linear-label-uuid-friction');
	});

	it('returns undefined when the cascade-friction label is unconfigured (back-compat)', () => {
		// Reflects current production cascade & ucho config.
		expect(getFrictionLabelId(makeTrelloProject())).toBeUndefined();
		expect(getFrictionLabelId(makeJiraProject())).toBeUndefined();
		expect(getFrictionLabelId(makeLinearProject())).toBeUndefined();
	});

	it('returns undefined for unknown PM provider types', () => {
		expect(
			getFrictionLabelId({ id: 'p1', pm: undefined } as unknown as ProjectConfig),
		).toBeUndefined();
	});
});

describe('PM config schemas — friction label', () => {
	it('jiraConfigSchema accepts labels.cascadeFriction', () => {
		const result = jiraConfigSchema.safeParse({
			projectKey: 'P',
			baseUrl: 'https://acme.atlassian.net',
			statuses: { friction: 'Friction' },
			labels: { cascadeFriction: 'cascade-friction' },
		});
		expect(result.success).toBe(true);
	});

	it('linearConfigSchema accepts labels.cascadeFriction', () => {
		const result = linearConfigSchema.safeParse({
			teamId: 'team-1',
			statuses: { friction: 'state-uuid' },
			labels: { cascadeFriction: 'linear-label-uuid' },
		});
		expect(result.success).toBe(true);
	});
});

describe('PM config schemas — friction slot', () => {
	it('trelloConfigSchema accepts lists.friction', () => {
		const result = trelloConfigSchema.safeParse({
			boardId: 'b1',
			lists: { friction: 'list-id-friction', todo: 'list-id-todo' },
			labels: {},
		});
		expect(result.success).toBe(true);
	});

	it('jiraConfigSchema accepts statuses.friction', () => {
		const result = jiraConfigSchema.safeParse({
			projectKey: 'P',
			baseUrl: 'https://acme.atlassian.net',
			statuses: { friction: 'Friction', todo: 'To Do' },
			labels: {},
		});
		expect(result.success).toBe(true);
	});

	it('linearConfigSchema accepts statuses.friction', () => {
		const result = linearConfigSchema.safeParse({
			teamId: 'team-1',
			statuses: { friction: 'state-uuid-friction', todo: 'state-uuid-todo' },
		});
		expect(result.success).toBe(true);
	});
});
