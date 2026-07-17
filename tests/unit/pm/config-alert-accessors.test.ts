import { describe, expect, it } from 'vitest';
import {
	getAlertLabelId,
	getAlertsContainerId,
	getAlertsStatusDestination,
	getAlertsStatusKey,
} from '../../../src/pm/config.js';
import type { ProjectConfig } from '../../../src/types/index.js';

function makeTrelloProject(overrides: Record<string, unknown> = {}): ProjectConfig {
	return {
		id: 'p1',
		pm: { type: 'trello' },
		trello: {
			boardId: 'board-1',
			lists: { todo: 'list-todo', alerts: 'list-alerts' },
			labels: { 'cascade-alert': 'lbl-alert' },
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
			statuses: { todo: 'To Do', alerts: 'In Triage' },
			labels: { cascadeAlert: 'cascade-alert' },
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
			statuses: { todo: 'state-todo', alerts: 'state-triage' },
			labels: { cascadeAlert: 'label-uuid' },
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
			statuses: { todo: 'Todo', alerts: 'Triage' },
		},
		...overrides,
	} as unknown as ProjectConfig;
}

describe('getAlertsContainerId', () => {
	it('returns Trello list ID from project.trello.lists.alerts', () => {
		expect(getAlertsContainerId(makeTrelloProject())).toBe('list-alerts');
	});

	it('returns JIRA project key for JIRA projects (container = projectKey, not a status)', () => {
		expect(getAlertsContainerId(makeJiraProject())).toBe('PROJ');
	});

	it('returns Linear team ID for Linear projects', () => {
		expect(getAlertsContainerId(makeLinearProject())).toBe('team-1');
	});

	it('returns GitHub Projects project ID for GitHub Projects projects', () => {
		expect(getAlertsContainerId(makeGitHubProjectsProject())).toBe('PVT_kwABC');
	});

	it('returns undefined for GitHub Projects projects when statuses.alerts is not configured', () => {
		const project = makeGitHubProjectsProject({
			githubProjects: {
				projectId: 'PVT_kwABC',
				owner: 'acme-org',
				ownerType: 'organization',
				statuses: { todo: 'Todo' },
			},
		});
		expect(getAlertsContainerId(project)).toBeUndefined();
	});

	it('returns undefined when no PM config is present', () => {
		const project = { id: 'p1', pm: undefined } as unknown as ProjectConfig;
		expect(getAlertsContainerId(project)).toBeUndefined();
	});

	it('returns undefined when alerts slot is not configured (Trello)', () => {
		const project = makeTrelloProject({
			trello: { boardId: 'b1', lists: { todo: 'l1' }, labels: {} },
		});
		// Trello container IS the alerts list — if missing, return undefined
		expect(getAlertsContainerId(project)).toBeUndefined();
	});

	it('returns undefined for JIRA projects when statuses.alerts is not configured', () => {
		// Without statuses.alerts, creating an issue would land in the project default
		// state and then fail pre-flight validation, leaving an alert card outside the
		// required alerts slot. getAlertsContainerId must gate on statuses.alerts.
		const project = makeJiraProject({
			jira: {
				projectKey: 'PROJ',
				baseUrl: 'https://acme.atlassian.net',
				statuses: { todo: 'To Do' },
				labels: {},
			},
		});
		expect(getAlertsContainerId(project)).toBeUndefined();
	});

	it('returns undefined for Linear projects when statuses.alerts is not configured', () => {
		const project = makeLinearProject({
			linear: { teamId: 'team-1', statuses: { todo: 'state-todo' } },
		});
		expect(getAlertsContainerId(project)).toBeUndefined();
	});
});

describe('getAlertLabelId', () => {
	it('returns Trello label ID from labels["cascade-alert"]', () => {
		expect(getAlertLabelId(makeTrelloProject())).toBe('lbl-alert');
	});

	it('returns JIRA label string from labels.cascadeAlert', () => {
		expect(getAlertLabelId(makeJiraProject())).toBe('cascade-alert');
	});

	it('returns Linear label ID from labels.cascadeAlert', () => {
		expect(getAlertLabelId(makeLinearProject())).toBe('label-uuid');
	});

	it('returns undefined for GitHub Projects projects (no cascade-alert label support)', () => {
		expect(getAlertLabelId(makeGitHubProjectsProject())).toBeUndefined();
	});

	it('returns undefined when label slot is not configured', () => {
		const p1 = makeTrelloProject({ trello: { boardId: 'b1', lists: {}, labels: {} } });
		expect(getAlertLabelId(p1)).toBeUndefined();

		const p2 = makeJiraProject({
			jira: { projectKey: 'P', baseUrl: 'https://x', statuses: {}, labels: {} },
		});
		expect(getAlertLabelId(p2)).toBeUndefined();

		const p3 = makeLinearProject({ linear: { teamId: 't1', statuses: {} } });
		expect(getAlertLabelId(p3)).toBeUndefined();
	});
});

describe('getAlertsStatusKey', () => {
	it('returns "alerts" when statuses.alerts is configured (JIRA)', () => {
		expect(getAlertsStatusKey(makeJiraProject())).toBe('alerts');
	});

	it('returns "alerts" when statuses.alerts is configured (Linear)', () => {
		expect(getAlertsStatusKey(makeLinearProject())).toBe('alerts');
	});

	it('returns "alerts" when lists.alerts is configured (Trello)', () => {
		expect(getAlertsStatusKey(makeTrelloProject())).toBe('alerts');
	});

	it('returns "alerts" when statuses.alerts is configured (GitHub Projects)', () => {
		expect(getAlertsStatusKey(makeGitHubProjectsProject())).toBe('alerts');
	});

	it('returns undefined when alerts slot is not configured', () => {
		const p = makeTrelloProject({ trello: { boardId: 'b1', lists: { todo: 'l1' }, labels: {} } });
		expect(getAlertsStatusKey(p)).toBeUndefined();
	});

	it('returns undefined for GitHub Projects projects when statuses.alerts is not configured', () => {
		const p = makeGitHubProjectsProject({
			githubProjects: {
				projectId: 'PVT_kwABC',
				owner: 'acme-org',
				ownerType: 'organization',
				statuses: { todo: 'Todo' },
			},
		});
		expect(getAlertsStatusKey(p)).toBeUndefined();
	});
});

describe('getAlertsStatusDestination', () => {
	it('returns Trello alerts list ID', () => {
		expect(getAlertsStatusDestination(makeTrelloProject())).toBe('list-alerts');
	});

	it('returns JIRA statuses.alerts value', () => {
		expect(getAlertsStatusDestination(makeJiraProject())).toBe('In Triage');
	});

	it('returns Linear statuses.alerts value', () => {
		expect(getAlertsStatusDestination(makeLinearProject())).toBe('state-triage');
	});

	it('returns GitHub Projects statuses.alerts value', () => {
		expect(getAlertsStatusDestination(makeGitHubProjectsProject())).toBe('Triage');
	});

	it('returns undefined when the alerts slot is not configured', () => {
		const project = makeGitHubProjectsProject({
			githubProjects: {
				projectId: 'PVT_kwABC',
				owner: 'acme-org',
				ownerType: 'organization',
				statuses: { todo: 'Todo' },
			},
		});
		expect(getAlertsStatusDestination(project)).toBeUndefined();
	});

	it('returns undefined for unknown PM provider types', () => {
		expect(
			getAlertsStatusDestination({ id: 'p1', pm: undefined } as unknown as ProjectConfig),
		).toBeUndefined();
	});
});
