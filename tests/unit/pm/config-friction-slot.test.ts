import { describe, expect, it } from 'vitest';
import { jiraConfigSchema } from '../../../src/integrations/pm/jira/config-schema.js';
import { linearConfigSchema } from '../../../src/integrations/pm/linear/config-schema.js';
import { trelloConfigSchema } from '../../../src/integrations/pm/trello/config-schema.js';
import { getFrictionContainerId, getFrictionStatusDestination } from '../../../src/pm/config.js';
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

		expect(getFrictionStatusDestination(trelloProject)).toBeUndefined();
		expect(getFrictionStatusDestination(jiraProject)).toBeUndefined();
		expect(getFrictionStatusDestination(linearProject)).toBeUndefined();
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
