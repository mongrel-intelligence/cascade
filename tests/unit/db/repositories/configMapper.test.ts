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
	cardBudgetUsd: null,
	squintDbUrl: null,
	agentBackend: null,
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
	statuses: { briefing: 'Briefing', todo: 'To Do' },
};

const trelloIntegrationRow: IntegrationRow = {
	projectId: 'proj1',
	category: 'pm',
	provider: 'trello',
	config: trelloConfig,
	triggers: {},
};

const jiraIntegrationRow: IntegrationRow = {
	projectId: 'proj1',
	category: 'pm',
	provider: 'jira',
	config: jiraConfig,
	triggers: {},
};

const githubIntegrationRow: IntegrationRow = {
	projectId: 'proj1',
	category: 'scm',
	provider: 'github',
	config: {},
	triggers: { ownPrsOnly: true },
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
		expect(result.prompts).toEqual({});
		expect(result.backends).toEqual({});
	});

	it('maps model, iterations, prompt, and backend for each agent type', () => {
		const configs: AgentConfigRow[] = [
			{
				orgId: null,
				projectId: 'proj1',
				agentType: 'implementation',
				model: 'claude-3-7-sonnet',
				maxIterations: 30,
				agentBackend: 'claude-code',
				prompt: 'Write clean code',
			},
			{
				orgId: null,
				projectId: 'proj1',
				agentType: 'review',
				model: 'claude-3-opus',
				maxIterations: null,
				agentBackend: null,
				prompt: null,
			},
		];

		const result = buildAgentMaps(configs);
		expect(result.models).toEqual({ implementation: 'claude-3-7-sonnet', review: 'claude-3-opus' });
		expect(result.iterations).toEqual({ implementation: 30 });
		expect(result.prompts).toEqual({ implementation: 'Write clean code' });
		expect(result.backends).toEqual({ implementation: 'claude-code' });
	});

	it('skips null values', () => {
		const configs: AgentConfigRow[] = [
			{
				orgId: null,
				projectId: null,
				agentType: 'briefing',
				model: null,
				maxIterations: null,
				agentBackend: null,
				prompt: null,
			},
		];

		const result = buildAgentMaps(configs);
		expect(Object.keys(result.models)).toHaveLength(0);
		expect(Object.keys(result.iterations)).toHaveLength(0);
		expect(Object.keys(result.prompts)).toHaveLength(0);
		expect(Object.keys(result.backends)).toHaveLength(0);
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
		cardBudgetUsd: '5.00',
		agentBackend: 'llmist',
		progressModel: 'progress-model',
		progressIntervalMinutes: '5',
	};

	it('maps all fields from row', () => {
		const result = mapDefaultsRow(defaultsRow, []);
		expect(result.model).toBe('test-model');
		expect(result.maxIterations).toBe(50);
		expect(result.watchdogTimeoutMs).toBe(1800000);
		expect(result.cardBudgetUsd).toBe(5);
		expect(result.agentBackend).toBe('llmist');
		expect(result.progressModel).toBe('progress-model');
		expect(result.progressIntervalMinutes).toBe(5);
	});

	it('converts cardBudgetUsd string to number', () => {
		const result = mapDefaultsRow({ ...defaultsRow, cardBudgetUsd: '10.50' }, []);
		expect(result.cardBudgetUsd).toBe(10.5);
	});

	it('converts progressIntervalMinutes string to number', () => {
		const result = mapDefaultsRow({ ...defaultsRow, progressIntervalMinutes: '15' }, []);
		expect(result.progressIntervalMinutes).toBe(15);
	});

	it('handles undefined defaults row gracefully', () => {
		const result = mapDefaultsRow(undefined, []);
		expect(result.model).toBeUndefined();
		expect(result.cardBudgetUsd).toBeUndefined();
	});

	it('builds agentModels and agentIterations from agent configs', () => {
		const agentConfigs: AgentConfigRow[] = [
			{
				orgId: null,
				projectId: null,
				agentType: 'review',
				model: 'review-model',
				maxIterations: 20,
				agentBackend: null,
				prompt: null,
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

	it('extracts github triggers from integration rows', () => {
		const result = extractIntegrationConfigs([githubIntegrationRow]);
		expect(result.githubTriggers).toEqual({ ownPrsOnly: true });
	});

	it('extracts trello triggers', () => {
		const withTriggers: IntegrationRow = {
			...trelloIntegrationRow,
			triggers: { cardMovedToTodo: true },
		};
		const result = extractIntegrationConfigs([withTriggers]);
		expect(result.trelloTriggers).toEqual({ cardMovedToTodo: true });
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
		expect(result.githubTriggers).toEqual({ ownPrsOnly: true });
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

	it('includes trello triggers when non-empty', () => {
		const result = mapProjectRow(makeInput({ trelloTriggers: { cardMovedToTodo: true } }));
		expect(result.trello?.triggers).toEqual({ cardMovedToTodo: true });
	});

	it('omits trello triggers when empty object', () => {
		const result = mapProjectRow(makeInput({ trelloTriggers: {} }));
		expect(result.trello?.triggers).toBeUndefined();
	});

	it('builds jira config', () => {
		const result = mapProjectRow(makeInput({ trelloConfig: undefined, jiraConfig }));
		expect(result.jira?.projectKey).toBe('PROJ');
		expect(result.jira?.baseUrl).toBe('https://test.atlassian.net');
		expect(result.jira?.statuses).toEqual({ briefing: 'Briefing', todo: 'To Do' });
	});

	it('includes jira triggers when non-empty', () => {
		const result = mapProjectRow(
			makeInput({ trelloConfig: undefined, jiraConfig, jiraTriggers: { issueTransitioned: true } }),
		);
		expect(result.jira?.triggers).toEqual({ issueTransitioned: true });
	});

	it('builds github section when githubTriggers is non-empty', () => {
		const result = mapProjectRow(makeInput({ githubTriggers: { ownPrsOnly: true } }));
		expect(result.github?.triggers).toEqual({ ownPrsOnly: true });
	});

	it('omits github section when githubTriggers is empty', () => {
		const result = mapProjectRow(makeInput({ githubTriggers: {} }));
		expect(result.github).toBeUndefined();
	});

	it('omits agentBackend when neither row.agentBackend nor agent overrides are set', () => {
		const result = mapProjectRow(makeInput());
		expect(result.agentBackend).toBeUndefined();
	});

	it('builds agentBackend from project row', () => {
		const result = mapProjectRow(
			makeInput({
				row: { ...baseProjectRow, agentBackend: 'claude-code', subscriptionCostZero: true },
			}),
		);
		expect(result.agentBackend?.default).toBe('claude-code');
		expect(result.agentBackend?.subscriptionCostZero).toBe(true);
	});

	it('builds agentBackend overrides from project agent configs', () => {
		const agentConfigs: AgentConfigRow[] = [
			{
				orgId: null,
				projectId: 'proj1',
				agentType: 'implementation',
				model: 'impl-model',
				maxIterations: null,
				agentBackend: 'claude-code',
				prompt: null,
			},
		];
		const result = mapProjectRow(makeInput({ projectAgentConfigs: agentConfigs }));
		expect(result.agentBackend?.overrides).toEqual({ implementation: 'claude-code' });
	});

	it('converts cardBudgetUsd from string to number', () => {
		const result = mapProjectRow(makeInput({ row: { ...baseProjectRow, cardBudgetUsd: '7.50' } }));
		expect(result.cardBudgetUsd).toBe(7.5);
	});

	it('includes squintDbUrl when set', () => {
		const result = mapProjectRow(
			makeInput({ row: { ...baseProjectRow, squintDbUrl: 'file://.squint.db' } }),
		);
		expect(result.squintDbUrl).toBe('file://.squint.db');
	});

	it('includes prompts from agent configs', () => {
		const agentConfigs: AgentConfigRow[] = [
			{
				orgId: null,
				projectId: 'proj1',
				agentType: 'implementation',
				model: null,
				maxIterations: null,
				agentBackend: null,
				prompt: 'Write clean code',
			},
		];
		const result = mapProjectRow(makeInput({ projectAgentConfigs: agentConfigs }));
		expect(result.prompts).toEqual({ implementation: 'Write clean code' });
	});
});
