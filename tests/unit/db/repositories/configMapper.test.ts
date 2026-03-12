import { describe, expect, it } from 'vitest';

import {
	type AgentConfigRow,
	type DefaultsRow,
	type IntegrationRow,
	type MapProjectInput,
	buildAgentMaps,
	extractIntegrationConfigs,
	mapDefaultsRow,
	mapProjectRow,
	orUndefined,
} from '../../../../src/db/repositories/configMapper.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const baseProjectRow = {
	id: 'proj1',
	orgId: 'org1',
	name: 'Test Project',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	model: null,
	workItemBudgetUsd: null,
	squintDbUrl: null,
	agentEngine: null,
	subscriptionCostZero: false,
};

const trelloConfig = {
	boardId: 'board123',
	lists: { todo: 'list-todo', done: 'list-done' },
	labels: { processing: 'label-proc' },
};

const jiraConfig = {
	projectKey: 'PROJ',
	baseUrl: 'https://test.atlassian.net',
	statuses: { splitting: 'Briefing', todo: 'To Do' },
};

const trelloIntegrationRow: IntegrationRow = {
	projectId: 'proj1',
	category: 'pm',
	provider: 'trello',
	config: trelloConfig,
};

const jiraIntegrationRow: IntegrationRow = {
	projectId: 'proj1',
	category: 'pm',
	provider: 'jira',
	config: jiraConfig,
};

const githubIntegrationRow: IntegrationRow = {
	projectId: 'proj1',
	category: 'scm',
	provider: 'github',
	config: {},
};

// ---------------------------------------------------------------------------
// orUndefined
// ---------------------------------------------------------------------------

describe('orUndefined', () => {
	it('returns the object when it has keys', () => {
		expect(orUndefined({ a: '1' })).toEqual({ a: '1' });
	});

	it('returns undefined for an empty object', () => {
		expect(orUndefined({})).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// buildAgentMaps
// ---------------------------------------------------------------------------

describe('buildAgentMaps', () => {
	it('returns empty maps for empty input', () => {
		const result = buildAgentMaps([]);
		expect(result.models).toEqual({});
		expect(result.iterations).toEqual({});
		expect(result.engines).toEqual({});
	});

	it('maps model, iterations, and engine for each agent type', () => {
		const configs: AgentConfigRow[] = [
			{
				orgId: null,
				projectId: 'proj1',
				agentType: 'implementation',
				model: 'claude-3-7-sonnet',
				maxIterations: 30,
				agentEngine: 'claude-code',
			},
			{
				orgId: null,
				projectId: 'proj1',
				agentType: 'review',
				model: 'claude-3-opus',
				maxIterations: null,
				agentEngine: null,
			},
		];

		const result = buildAgentMaps(configs);
		expect(result.models).toEqual({ implementation: 'claude-3-7-sonnet', review: 'claude-3-opus' });
		expect(result.iterations).toEqual({ implementation: 30 });
		expect(result.engines).toEqual({ implementation: 'claude-code' });
	});

	it('skips null values', () => {
		const configs: AgentConfigRow[] = [
			{
				orgId: null,
				projectId: null,
				agentType: 'splitting',
				model: null,
				maxIterations: null,
				agentEngine: null,
			},
		];

		const result = buildAgentMaps(configs);
		expect(Object.keys(result.models)).toHaveLength(0);
		expect(Object.keys(result.iterations)).toHaveLength(0);
		expect(Object.keys(result.engines)).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// mapDefaultsRow
// ---------------------------------------------------------------------------

describe('mapDefaultsRow', () => {
	const defaultsRow: DefaultsRow = {
		model: 'test-model',
		maxIterations: 50,
		watchdogTimeoutMs: 1800000,
		workItemBudgetUsd: '5.00',
		agentEngine: 'llmist',
		progressModel: 'progress-model',
		progressIntervalMinutes: '5',
	};

	it('maps all fields from row', () => {
		const result = mapDefaultsRow(defaultsRow, []);
		expect(result.model).toBe('test-model');
		expect(result.maxIterations).toBe(50);
		expect(result.watchdogTimeoutMs).toBe(1800000);
		expect(result.workItemBudgetUsd).toBe(5);
		expect(result.agentEngine).toBe('llmist');
		expect(result.progressModel).toBe('progress-model');
		expect(result.progressIntervalMinutes).toBe(5);
	});

	it('converts workItemBudgetUsd string to number', () => {
		const result = mapDefaultsRow({ ...defaultsRow, workItemBudgetUsd: '10.50' }, []);
		expect(result.workItemBudgetUsd).toBe(10.5);
	});

	it('converts progressIntervalMinutes string to number', () => {
		const result = mapDefaultsRow({ ...defaultsRow, progressIntervalMinutes: '15' }, []);
		expect(result.progressIntervalMinutes).toBe(15);
	});

	it('handles undefined defaults row gracefully', () => {
		const result = mapDefaultsRow(undefined, []);
		expect(result.model).toBeUndefined();
		expect(result.workItemBudgetUsd).toBeUndefined();
	});

	it('builds agentModels and agentIterations from agent configs', () => {
		const agentConfigs: AgentConfigRow[] = [
			{
				orgId: null,
				projectId: null,
				agentType: 'review',
				model: 'review-model',
				maxIterations: 20,
				agentEngine: null,
			},
		];
		const result = mapDefaultsRow(defaultsRow, agentConfigs);
		expect(result.agentModels).toEqual({ review: 'review-model' });
		expect(result.agentIterations).toEqual({ review: 20 });
	});
});

// ---------------------------------------------------------------------------
// extractIntegrationConfigs
// ---------------------------------------------------------------------------

describe('extractIntegrationConfigs', () => {
	it('extracts trello config from integration rows', () => {
		const result = extractIntegrationConfigs([trelloIntegrationRow]);
		expect(result.trelloConfig).toEqual(trelloConfig);
		expect(result.jiraConfig).toBeUndefined();
		expect(result.githubConfig).toBeUndefined();
	});

	it('extracts jira config from integration rows', () => {
		const result = extractIntegrationConfigs([jiraIntegrationRow]);
		expect(result.jiraConfig).toEqual(jiraConfig);
		expect(result.trelloConfig).toBeUndefined();
	});

	it('extracts github config from integration rows', () => {
		const result = extractIntegrationConfigs([githubIntegrationRow]);
		expect(result.githubConfig).toEqual({});
	});

	it('handles empty integration list', () => {
		const result = extractIntegrationConfigs([]);
		expect(result.trelloConfig).toBeUndefined();
		expect(result.jiraConfig).toBeUndefined();
		expect(result.githubConfig).toBeUndefined();
	});

	it('extracts all providers from mixed integration list', () => {
		const rows = [trelloIntegrationRow, githubIntegrationRow];
		const result = extractIntegrationConfigs(rows);
		expect(result.trelloConfig).toEqual(trelloConfig);
		expect(result.githubConfig).toEqual({});
		expect(result.jiraConfig).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// mapProjectRow
// ---------------------------------------------------------------------------

describe('mapProjectRow', () => {
	function makeInput(overrides: Partial<MapProjectInput> = {}): MapProjectInput {
		return {
			row: baseProjectRow,
			projectAgentConfigs: [],
			trelloConfig,
			...overrides,
		};
	}

	it('maps base project fields', () => {
		const result = mapProjectRow(makeInput());
		expect(result.id).toBe('proj1');
		expect(result.orgId).toBe('org1');
		expect(result.name).toBe('Test Project');
		expect(result.repo).toBe('owner/repo');
		expect(result.baseBranch).toBe('main');
		expect(result.branchPrefix).toBe('feature/');
	});

	it('defaults baseBranch to main when null', () => {
		const result = mapProjectRow(makeInput({ row: { ...baseProjectRow, baseBranch: null } }));
		expect(result.baseBranch).toBe('main');
	});

	it('defaults branchPrefix to feature/ when null', () => {
		const result = mapProjectRow(makeInput({ row: { ...baseProjectRow, branchPrefix: null } }));
		expect(result.branchPrefix).toBe('feature/');
	});

	it('sets pm.type to trello when trelloConfig is provided', () => {
		const result = mapProjectRow(makeInput({ trelloConfig }));
		expect(result.pm.type).toBe('trello');
	});

	it('sets pm.type to jira when jiraConfig is provided', () => {
		const result = mapProjectRow(makeInput({ trelloConfig: undefined, jiraConfig }));
		expect(result.pm.type).toBe('jira');
	});

	it('builds trello config with boardId, lists, labels', () => {
		const result = mapProjectRow(makeInput());
		expect(result.trello?.boardId).toBe('board123');
		expect(result.trello?.lists).toEqual({ todo: 'list-todo', done: 'list-done' });
		expect(result.trello?.labels).toEqual({ processing: 'label-proc' });
	});

	it('builds jira config', () => {
		const result = mapProjectRow(makeInput({ trelloConfig: undefined, jiraConfig }));
		expect(result.jira?.projectKey).toBe('PROJ');
		expect(result.jira?.baseUrl).toBe('https://test.atlassian.net');
		expect(result.jira?.statuses).toEqual({ splitting: 'Briefing', todo: 'To Do' });
	});

	it('omits agentEngine when neither row.agentEngine nor agent overrides are set', () => {
		const result = mapProjectRow(makeInput());
		expect(result.agentEngine).toBeUndefined();
	});

	it('builds agentEngine from project row', () => {
		const result = mapProjectRow(
			makeInput({
				row: { ...baseProjectRow, agentEngine: 'claude-code', subscriptionCostZero: true },
			}),
		);
		expect(result.agentEngine?.default).toBe('claude-code');
		expect(result.agentEngine?.subscriptionCostZero).toBe(true);
	});

	it('builds agentEngine overrides from project agent configs', () => {
		const agentConfigs: AgentConfigRow[] = [
			{
				orgId: null,
				projectId: 'proj1',
				agentType: 'implementation',
				model: 'impl-model',
				maxIterations: null,
				agentEngine: 'claude-code',
			},
		];
		const result = mapProjectRow(makeInput({ projectAgentConfigs: agentConfigs }));
		expect(result.agentEngine?.overrides).toEqual({ implementation: 'claude-code' });
	});

	it('converts workItemBudgetUsd from string to number', () => {
		const result = mapProjectRow(
			makeInput({ row: { ...baseProjectRow, workItemBudgetUsd: '7.50' } }),
		);
		expect(result.workItemBudgetUsd).toBe(7.5);
	});

	it('includes squintDbUrl when set', () => {
		const result = mapProjectRow(
			makeInput({ row: { ...baseProjectRow, squintDbUrl: 'file://.squint.db' } }),
		);
		expect(result.squintDbUrl).toBe('file://.squint.db');
	});

	it('does not include prompts field (prompts are now in agent definitions)', () => {
		const agentConfigs: AgentConfigRow[] = [
			{
				orgId: null,
				projectId: 'proj1',
				agentType: 'implementation',
				model: null,
				maxIterations: null,
				agentEngine: null,
			},
		];
		const result = mapProjectRow(makeInput({ projectAgentConfigs: agentConfigs }));
		expect(Object.hasOwn(result, 'prompts')).toBe(false);
	});
});
