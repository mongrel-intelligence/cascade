import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/db/client.js', () => ({
	getDb: vi.fn(),
}));

import { getDb } from '../../../../src/db/client.js';
import {
	findProjectByBoardIdFromDb,
	findProjectByIdFromDb,
	findProjectByRepoFromDb,
	loadConfigFromDb,
} from '../../../../src/db/repositories/configRepository.js';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const defaultsRow = {
	orgId: 'default',
	model: 'test-model',
	maxIterations: 50,
	watchdogTimeoutMs: 1800000,
	cardBudgetUsd: '5.00',
	agentBackend: 'llmist',
	progressModel: 'progress-model',
	progressIntervalMinutes: '5',
	createdAt: new Date(),
	updatedAt: new Date(),
};

const projectRow = {
	id: 'proj1',
	orgId: 'default',
	name: 'Project One',
	repo: 'owner/repo1',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	model: null,
	cardBudgetUsd: null,
	agentBackend: null,
	subscriptionCostZero: false,
	createdAt: new Date(),
	updatedAt: new Date(),
};

const projectRowWithBackend = {
	...projectRow,
	id: 'proj2',
	name: 'Project Two',
	repo: 'owner/repo2',
	agentBackend: 'claude-code',
	subscriptionCostZero: true,
};

const trelloIntegration = {
	id: 1,
	projectId: 'proj1',
	category: 'pm' as const,
	provider: 'trello' as const,
	config: {
		boardId: 'board123',
		lists: { todo: 'list-todo', done: 'list-done' },
		labels: { processing: 'label-proc' },
		customFields: { cost: 'cf-cost' },
	},
	triggers: {},
	createdAt: new Date(),
	updatedAt: new Date(),
};

const jiraIntegration = {
	id: 3,
	projectId: 'proj1',
	category: 'pm' as const,
	provider: 'jira' as const,
	config: {
		projectKey: 'PROJ',
		baseUrl: 'https://test.atlassian.net',
		statuses: { briefing: 'Briefing', planning: 'Planning', todo: 'To Do' },
		labels: { processing: 'my-proc', readyToProcess: 'my-ready' },
	},
	triggers: {},
	createdAt: new Date(),
	updatedAt: new Date(),
};

const globalAgentConfig = {
	id: 1,
	orgId: null,
	projectId: null,
	agentType: 'review',
	model: 'global-review-model',
	maxIterations: 30,
	agentBackend: null,
	prompt: null,
	createdAt: new Date(),
	updatedAt: new Date(),
};

const projectAgentConfig = {
	id: 2,
	orgId: null,
	projectId: 'proj1',
	agentType: 'implementation',
	model: 'impl-model',
	maxIterations: null,
	agentBackend: 'claude-code',
	prompt: 'Write clean code',
	createdAt: new Date(),
	updatedAt: new Date(),
};

const orgAgentConfig = {
	id: 3,
	orgId: 'default',
	projectId: null,
	agentType: 'briefing',
	model: 'org-briefing-model',
	maxIterations: 20,
	agentBackend: null,
	prompt: null,
	createdAt: new Date(),
	updatedAt: new Date(),
};

// ---------------------------------------------------------------------------
// Mock DB helper
//
// Uses sequential result returning: each from() call returns the next result
// in the queue. This works because the select().from() calls are set up in a
// deterministic order within each function.
//
// loadConfigFromDb order (Promise.all): cascadeDefaults, projects, agentConfigs, integrations
// findProjectFromDb order: projects (initial), then Promise.all: agentConfigs x3, defaults, integrations
// ---------------------------------------------------------------------------

type QueryResult = Record<string, unknown>[];

function createSequentialMockDb(results: QueryResult[]) {
	let callIndex = 0;

	const makeTerminal = () => {
		const idx = callIndex++;
		const data = results[idx] ?? [];
		// biome-ignore lint/suspicious/noThenProperty: mock must be thenable for Promise.all
		const limitResult = { then: (fn: (r: QueryResult) => unknown) => Promise.resolve(fn(data)) };
		return {
			where: vi.fn().mockImplementation(() => Promise.resolve(data)),
			limit: vi.fn().mockReturnValue(limitResult),
			// biome-ignore lint/suspicious/noThenProperty: mock must be thenable for Promise.all
			then: (fn: (r: QueryResult) => unknown) => Promise.resolve(fn(data)),
		};
	};

	const db = {
		select: vi.fn().mockReturnValue({
			from: vi.fn().mockImplementation(() => makeTerminal()),
		}),
	};

	return db;
}

describe('configRepository', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('loadConfigFromDb', () => {
		it('loads config with Trello integration from project_integrations', async () => {
			// loadConfigFromDb Promise.all order: defaults, projects, agentConfigs, integrations
			const mockDb = createSequentialMockDb([
				[defaultsRow], // cascadeDefaults
				[projectRow], // projects
				[], // agentConfigs (loadAgentConfigs)
				[trelloIntegration], // projectIntegrations
			]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const config = await loadConfigFromDb();

			expect(config.projects).toHaveLength(1);
			const proj = config.projects[0];
			expect(proj.id).toBe('proj1');
			expect(proj.trello.boardId).toBe('board123');
			expect(proj.trello.lists).toEqual({ todo: 'list-todo', done: 'list-done' });
			expect(proj.trello.labels).toEqual({ processing: 'label-proc' });
			expect(proj.trello.customFields).toEqual({ cost: 'cf-cost' });
		});

		it('loads config with JIRA integration including labels', async () => {
			const mockDb = createSequentialMockDb([[defaultsRow], [projectRow], [], [jiraIntegration]]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const config = await loadConfigFromDb();

			expect(config.projects).toHaveLength(1);
			const proj = config.projects[0];
			expect(proj.pm?.type).toBe('jira');
			expect(proj.jira?.projectKey).toBe('PROJ');
			expect(proj.jira?.baseUrl).toBe('https://test.atlassian.net');
			expect(proj.jira?.statuses).toEqual({
				briefing: 'Briefing',
				planning: 'Planning',
				todo: 'To Do',
			});
			expect(proj.jira?.labels?.processing).toBe('my-proc');
			expect(proj.jira?.labels?.readyToProcess).toBe('my-ready');
		});

		it('loads JIRA integration without labels (optional field)', async () => {
			const jiraNoLabels = {
				...jiraIntegration,
				config: {
					projectKey: 'PROJ',
					baseUrl: 'https://test.atlassian.net',
					statuses: { briefing: 'Briefing' },
				},
			};
			const mockDb = createSequentialMockDb([[defaultsRow], [projectRow], [], [jiraNoLabels]]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const config = await loadConfigFromDb();
			const proj = config.projects[0];
			expect(proj.jira?.labels).toBeUndefined();
		});

		it('maps defaults correctly from DB row', async () => {
			const mockDb = createSequentialMockDb([[defaultsRow], [projectRow], [], [trelloIntegration]]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const config = await loadConfigFromDb();

			expect(config.defaults.model).toBe('test-model');
			expect(config.defaults.maxIterations).toBe(50);
			expect(config.defaults.agentBackend).toBe('llmist');
			expect(config.defaults.cardBudgetUsd).toBe(5);
			expect(config.defaults.progressModel).toBe('progress-model');
			expect(config.defaults.progressIntervalMinutes).toBe(5);
		});

		it('maps agentBackend from project row when set', async () => {
			const mockDb = createSequentialMockDb([
				[defaultsRow],
				[projectRowWithBackend],
				[],
				[{ ...trelloIntegration, projectId: 'proj2' }],
			]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const config = await loadConfigFromDb();
			const proj = config.projects[0];

			expect(proj.agentBackend).toBeDefined();
			expect(proj.agentBackend?.default).toBe('claude-code');
			expect(proj.agentBackend?.subscriptionCostZero).toBe(true);
		});

		it('builds agent backend overrides from agentBackend column in agent_configs', async () => {
			const mockDb = createSequentialMockDb([
				[defaultsRow],
				[projectRowWithBackend],
				[{ ...projectAgentConfig, projectId: 'proj2' }],
				[{ ...trelloIntegration, projectId: 'proj2' }],
			]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const config = await loadConfigFromDb();
			const proj = config.projects[0];

			expect(proj.agentBackend?.overrides).toEqual({
				implementation: 'claude-code',
			});
			expect(proj.agentModels).toEqual({ implementation: 'impl-model' });
		});

		it('merges global and org-level agent configs into defaults', async () => {
			const mockDb = createSequentialMockDb([
				[defaultsRow],
				[projectRow],
				[globalAgentConfig, orgAgentConfig],
				[trelloIntegration],
			]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const config = await loadConfigFromDb();

			expect(config.defaults.agentModels).toEqual({
				review: 'global-review-model',
				briefing: 'org-briefing-model',
			});
			expect(config.defaults.agentIterations).toEqual({
				review: 30,
				briefing: 20,
			});
		});

		it('handles multiple projects with separate integrations', async () => {
			const proj2Integration = {
				...trelloIntegration,
				id: 2,
				projectId: 'proj2',
				config: {
					boardId: 'board456',
					lists: { todo: 'list-todo-2' },
					labels: { error: 'label-error' },
				},
			};

			const mockDb = createSequentialMockDb([
				[defaultsRow],
				[projectRow, projectRowWithBackend],
				[],
				[trelloIntegration, proj2Integration],
			]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const config = await loadConfigFromDb();

			expect(config.projects).toHaveLength(2);
			expect(config.projects[0].trello.boardId).toBe('board123');
			expect(config.projects[1].trello.boardId).toBe('board456');
		});

		it('queries 4 tables via Promise.all', async () => {
			const mockDb = createSequentialMockDb([[defaultsRow], [projectRow], [], [trelloIntegration]]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			await loadConfigFromDb();

			// 4 select() calls: defaults, projects, agentConfigs, integrations
			expect(mockDb.select).toHaveBeenCalledTimes(4);
		});

		it('omits agentBackend from project when not set', async () => {
			const mockDb = createSequentialMockDb([
				[defaultsRow],
				[projectRow], // agentBackend is null
				[],
				[trelloIntegration],
			]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const config = await loadConfigFromDb();

			expect(config.projects[0].agentBackend).toBeUndefined();
		});

		it('preserves agent_config backend overrides even when project agentBackend is null', async () => {
			const mockDb = createSequentialMockDb([
				[defaultsRow],
				[projectRow], // agentBackend is null
				[projectAgentConfig], // has agentBackend: 'claude-code' for implementation
				[trelloIntegration],
			]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const config = await loadConfigFromDb();
			const proj = config.projects[0];

			expect(proj.agentBackend).toBeDefined();
			expect(proj.agentBackend?.default).toBe('llmist'); // Zod default
			expect(proj.agentBackend?.overrides).toEqual({
				implementation: 'claude-code',
			});
		});
	});

	describe('findProjectByIdFromDb', () => {
		it('returns project with Trello integration from integrations table', async () => {
			// findProjectFromDb order: projects (initial), then Promise.all:
			// projectAcs, orgAcs, globalAcs, defaults, integrations
			const mockDb = createSequentialMockDb([
				[projectRow], // project lookup
				[projectAgentConfig], // project agent configs
				[], // org agent configs
				[globalAgentConfig], // global agent configs
				[defaultsRow], // defaults
				[trelloIntegration], // integrations
			]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const result = await findProjectByIdFromDb('proj1');

			expect(result).toBeDefined();
			expect(result?.id).toBe('proj1');
			expect(result?.trello.boardId).toBe('board123');
			expect(result?.trello.lists).toEqual({ todo: 'list-todo', done: 'list-done' });
			expect(result?.trello.labels).toEqual({ processing: 'label-proc' });
		});

		it('returns undefined when project not found', async () => {
			const mockDb = createSequentialMockDb([
				[], // no project found
			]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const result = await findProjectByIdFromDb('nonexistent');

			expect(result).toBeUndefined();
		});

		it('maps agent configs with agentBackend column (renamed from backend)', async () => {
			const mockDb = createSequentialMockDb([
				[projectRowWithBackend],
				[projectAgentConfig], // has agentBackend: 'claude-code'
				[],
				[],
				[defaultsRow],
				[{ ...trelloIntegration, projectId: 'proj2' }],
			]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const result = await findProjectByIdFromDb('proj2');

			expect(result).toBeDefined();
			expect(result?.agentBackend?.default).toBe('claude-code');
			expect(result?.agentBackend?.overrides).toEqual({
				implementation: 'claude-code',
			});
		});

		it('includes prompts from agent configs', async () => {
			const mockDb = createSequentialMockDb([
				[projectRow],
				[projectAgentConfig], // has prompt: 'Write clean code'
				[],
				[],
				[defaultsRow],
				[trelloIntegration],
			]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const result = await findProjectByIdFromDb('proj1');

			expect(result).toBeDefined();
			expect(result?.prompts).toEqual({ implementation: 'Write clean code' });
		});

		it('runs 5 sub-queries in parallel after initial project lookup', async () => {
			const mockDb = createSequentialMockDb([
				[projectRow],
				[],
				[],
				[],
				[defaultsRow],
				[trelloIntegration],
			]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			await findProjectByIdFromDb('proj1');

			// 1 initial project lookup + 5 parallel sub-queries = 6 select() calls
			expect(mockDb.select).toHaveBeenCalledTimes(6);
		});

		it('converts cardBudgetUsd from string to number', async () => {
			const projWithBudget = { ...projectRow, cardBudgetUsd: '10.50' };

			const mockDb = createSequentialMockDb([
				[projWithBudget],
				[],
				[],
				[],
				[defaultsRow],
				[trelloIntegration],
			]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const result = await findProjectByIdFromDb('proj1');

			expect(result?.cardBudgetUsd).toBe(10.5);
		});

		it('handles Trello integration with customFields', async () => {
			const mockDb = createSequentialMockDb([
				[projectRow],
				[],
				[],
				[],
				[defaultsRow],
				[trelloIntegration], // has customFields: { cost: 'cf-cost' }
			]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const result = await findProjectByIdFromDb('proj1');

			expect(result?.trello.customFields).toEqual({ cost: 'cf-cost' });
		});

		it('handles Trello integration without customFields', async () => {
			const noCustomFields = {
				...trelloIntegration,
				config: {
					boardId: 'board123',
					lists: { todo: 'list-todo' },
					labels: { processing: 'label-proc' },
				},
			};

			const mockDb = createSequentialMockDb([
				[projectRow],
				[],
				[],
				[],
				[defaultsRow],
				[noCustomFields],
			]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const result = await findProjectByIdFromDb('proj1');

			expect(result?.trello.customFields).toBeUndefined();
		});
	});

	describe('findProjectByRepoFromDb', () => {
		it('returns project found by repo', async () => {
			const mockDb = createSequentialMockDb([
				[projectRow],
				[],
				[],
				[],
				[defaultsRow],
				[trelloIntegration],
			]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const result = await findProjectByRepoFromDb('owner/repo1');

			expect(result).toBeDefined();
			expect(result?.id).toBe('proj1');
			expect(result?.repo).toBe('owner/repo1');
		});

		it('returns undefined for unknown repo', async () => {
			const mockDb = createSequentialMockDb([[]]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const result = await findProjectByRepoFromDb('owner/unknown');

			expect(result).toBeUndefined();
		});
	});

	describe('findProjectByBoardIdFromDb', () => {
		it('returns project found via integrations board ID subquery', async () => {
			const mockDb = createSequentialMockDb([
				[projectRow], // subquery finds project
				[],
				[],
				[],
				[defaultsRow],
				[trelloIntegration],
			]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const result = await findProjectByBoardIdFromDb('board123');

			expect(result).toBeDefined();
			expect(result?.id).toBe('proj1');
			expect(result?.trello.boardId).toBe('board123');
		});

		it('returns undefined when no project has matching board ID', async () => {
			const mockDb = createSequentialMockDb([[]]);
			vi.mocked(getDb).mockReturnValue(mockDb as never);

			const result = await findProjectByBoardIdFromDb('nonexistent-board');

			expect(result).toBeUndefined();
		});
	});
});
