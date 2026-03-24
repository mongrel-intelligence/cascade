import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockDbClientModule, mockGetDb } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/db/client.js', () => mockDbClientModule);

import {
	findProjectByBoardIdFromDb,
	findProjectByIdFromDb,
	findProjectByRepoFromDb,
	loadConfigFromDb,
} from '../../../../src/db/repositories/configRepository.js';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const projectRow = {
	id: 'proj1',
	orgId: 'default',
	name: 'Project One',
	repo: 'owner/repo1',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	model: null,
	workItemBudgetUsd: null,
	agentEngine: null,
	createdAt: new Date(),
	updatedAt: new Date(),
};

const projectRowWithBackend = {
	...projectRow,
	id: 'proj2',
	name: 'Project Two',
	repo: 'owner/repo2',
	agentEngine: 'claude-code',
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
		statuses: { splitting: 'Splitting', planning: 'Planning', todo: 'To Do' },
		labels: { processing: 'my-proc', readyToProcess: 'my-ready' },
	},
	triggers: {},
	createdAt: new Date(),
	updatedAt: new Date(),
};

const projectAgentConfig = {
	id: 2,
	projectId: 'proj1',
	agentType: 'implementation',
	model: 'impl-model',
	maxIterations: null,
	agentEngine: 'claude-code',
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
// loadConfigFromDb order (Promise.all): projects, agentConfigs, integrations
// findProjectFromDb order: projects (initial), then Promise.all: agentConfigs, integrations
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
	describe('loadConfigFromDb', () => {
		it('loads config with Trello integration from project_integrations', async () => {
			// loadConfigFromDb Promise.all order: defaults, projects, agentConfigs, integrations
			const mockDb = createSequentialMockDb([
				[projectRow], // projects
				[], // agentConfigs (loadAgentConfigs)
				[trelloIntegration], // projectIntegrations
			]);
			mockGetDb.mockReturnValue(mockDb as never);

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
			const mockDb = createSequentialMockDb([[projectRow], [], [jiraIntegration]]);
			mockGetDb.mockReturnValue(mockDb as never);

			const config = await loadConfigFromDb();

			expect(config.projects).toHaveLength(1);
			const proj = config.projects[0];
			expect(proj.pm?.type).toBe('jira');
			expect(proj.jira?.projectKey).toBe('PROJ');
			expect(proj.jira?.baseUrl).toBe('https://test.atlassian.net');
			expect(proj.jira?.statuses).toEqual({
				splitting: 'Splitting',
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
					statuses: { splitting: 'Splitting' },
				},
			};
			const mockDb = createSequentialMockDb([[projectRow], [], [jiraNoLabels]]);
			mockGetDb.mockReturnValue(mockDb as never);

			const config = await loadConfigFromDb();
			const proj = config.projects[0];
			expect(proj.jira?.labels).toBeUndefined();
		});

		it('uses Zod schema defaults for project fields when not set in DB', async () => {
			const mockDb = createSequentialMockDb([[projectRow], [], [trelloIntegration]]);
			mockGetDb.mockReturnValue(mockDb as never);

			const config = await loadConfigFromDb();

			// Schema defaults apply from ProjectConfigSchema
			const proj = config.projects[0];
			expect(proj.model).toBe('openrouter:google/gemini-3-flash-preview');
			expect(proj.maxIterations).toBe(50);
			expect(proj.workItemBudgetUsd).toBe(5);
			expect(proj.progressModel).toBe('openrouter:google/gemini-2.5-flash-lite');
			expect(proj.progressIntervalMinutes).toBe(5);
			expect(proj.watchdogTimeoutMs).toBe(30 * 60 * 1000);
		});

		it('maps agentEngine from project row when set', async () => {
			const mockDb = createSequentialMockDb([
				[projectRowWithBackend],
				[],
				[{ ...trelloIntegration, projectId: 'proj2' }],
			]);
			mockGetDb.mockReturnValue(mockDb as never);

			const config = await loadConfigFromDb();
			const proj = config.projects[0];

			expect(proj.agentEngine).toBeDefined();
			expect(proj.agentEngine?.default).toBe('claude-code');
		});

		it('builds agent engine overrides from agentEngine column in agent_configs', async () => {
			const mockDb = createSequentialMockDb([
				[projectRowWithBackend],
				[{ ...projectAgentConfig, projectId: 'proj2' }],
				[{ ...trelloIntegration, projectId: 'proj2' }],
			]);
			mockGetDb.mockReturnValue(mockDb as never);

			const config = await loadConfigFromDb();
			const proj = config.projects[0];

			expect(proj.agentEngine?.overrides).toEqual({
				implementation: 'claude-code',
			});
			expect(proj.agentModels).toEqual({ implementation: 'impl-model' });
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
				[projectRow, projectRowWithBackend],
				[],
				[trelloIntegration, proj2Integration],
			]);
			mockGetDb.mockReturnValue(mockDb as never);

			const config = await loadConfigFromDb();

			expect(config.projects).toHaveLength(2);
			expect(config.projects[0].trello.boardId).toBe('board123');
			expect(config.projects[1].trello.boardId).toBe('board456');
		});

		it('queries 3 tables via Promise.all', async () => {
			const mockDb = createSequentialMockDb([[projectRow], [], [trelloIntegration]]);
			mockGetDb.mockReturnValue(mockDb as never);

			await loadConfigFromDb();

			// 3 select() calls: projects, agentConfigs, integrations
			expect(mockDb.select).toHaveBeenCalledTimes(3);
		});

		it('omits agentEngine from project when not set', async () => {
			const mockDb = createSequentialMockDb([
				[projectRow], // agentEngine is null
				[],
				[trelloIntegration],
			]);
			mockGetDb.mockReturnValue(mockDb as never);

			const config = await loadConfigFromDb();

			expect(config.projects[0].agentEngine).toBeUndefined();
		});

		it('preserves agent_config engine overrides even when project agentEngine is null', async () => {
			const mockDb = createSequentialMockDb([
				[projectRow], // agentEngine is null
				[projectAgentConfig], // has agentEngine: 'claude-code' for implementation
				[trelloIntegration],
			]);
			mockGetDb.mockReturnValue(mockDb as never);

			const config = await loadConfigFromDb();
			const proj = config.projects[0];

			expect(proj.agentEngine).toBeDefined();
			expect(proj.agentEngine?.default).toBe('claude-code'); // Zod default
			expect(proj.agentEngine?.overrides).toEqual({
				implementation: 'claude-code',
			});
		});
	});

	describe('findProjectByIdFromDb', () => {
		it('returns project with Trello integration from integrations table', async () => {
			// findProjectFromDb order: projects (initial), then Promise.all:
			// projectAcs, defaults, integrations
			const mockDb = createSequentialMockDb([
				[projectRow], // project lookup
				[projectAgentConfig], // project agent configs
				[trelloIntegration], // integrations
			]);
			mockGetDb.mockReturnValue(mockDb as never);

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
			mockGetDb.mockReturnValue(mockDb as never);

			const result = await findProjectByIdFromDb('nonexistent');

			expect(result).toBeUndefined();
		});

		it('maps agent configs with agentEngine column', async () => {
			const mockDb = createSequentialMockDb([
				[projectRowWithBackend],
				[projectAgentConfig], // has agentEngine: 'claude-code'
				[{ ...trelloIntegration, projectId: 'proj2' }],
			]);
			mockGetDb.mockReturnValue(mockDb as never);

			const result = await findProjectByIdFromDb('proj2');

			expect(result).toBeDefined();
			expect(result?.agentEngine?.default).toBe('claude-code');
			expect(result?.agentEngine?.overrides).toEqual({
				implementation: 'claude-code',
			});
		});

		it('maps agent configs with backend override for project', async () => {
			const mockDb = createSequentialMockDb([
				[projectRow],
				[projectAgentConfig], // has agentEngine: 'claude-code'
				[trelloIntegration],
			]);
			mockGetDb.mockReturnValue(mockDb as never);

			const result = await findProjectByIdFromDb('proj1');

			expect(result).toBeDefined();
			expect(result?.agentEngine?.overrides).toEqual({ implementation: 'claude-code' });
			// prompts are no longer stored in agent_configs (moved to agent_definitions)
			expect(result && Object.hasOwn(result, 'prompts')).toBe(false);
		});

		it('runs 2 sub-queries in parallel after initial project lookup', async () => {
			const mockDb = createSequentialMockDb([[projectRow], [], [trelloIntegration]]);
			mockGetDb.mockReturnValue(mockDb as never);

			await findProjectByIdFromDb('proj1');

			// 1 initial project lookup + 2 parallel sub-queries = 3 select() calls
			expect(mockDb.select).toHaveBeenCalledTimes(3);
		});

		it('maps workItemBudgetUsd from DB row (config-layer rename pending)', async () => {
			const projWithBudget = { ...projectRow, workItemBudgetUsd: '10.50' };

			const mockDb = createSequentialMockDb([[projWithBudget], [], [trelloIntegration]]);
			mockGetDb.mockReturnValue(mockDb as never);

			const result = await findProjectByIdFromDb('proj1');

			// The mapper reads from row.workItemBudgetUsd (DB column) and outputs as
			// workItemBudgetUsd (config schema key).
			expect(result?.workItemBudgetUsd).toBe(10.5);
		});

		it('handles Trello integration with customFields', async () => {
			const mockDb = createSequentialMockDb([
				[projectRow],
				[],
				[trelloIntegration], // has customFields: { cost: 'cf-cost' }
			]);
			mockGetDb.mockReturnValue(mockDb as never);

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

			const mockDb = createSequentialMockDb([[projectRow], [], [noCustomFields]]);
			mockGetDb.mockReturnValue(mockDb as never);

			const result = await findProjectByIdFromDb('proj1');

			expect(result?.trello.customFields).toBeUndefined();
		});
	});

	describe('findProjectByRepoFromDb', () => {
		it('returns project found by repo', async () => {
			const mockDb = createSequentialMockDb([[projectRow], [], [trelloIntegration]]);
			mockGetDb.mockReturnValue(mockDb as never);

			const result = await findProjectByRepoFromDb('owner/repo1');

			expect(result).toBeDefined();
			expect(result?.id).toBe('proj1');
			expect(result?.repo).toBe('owner/repo1');
		});

		it('returns undefined for unknown repo', async () => {
			const mockDb = createSequentialMockDb([[]]);
			mockGetDb.mockReturnValue(mockDb as never);

			const result = await findProjectByRepoFromDb('owner/unknown');

			expect(result).toBeUndefined();
		});
	});

	describe('findProjectByBoardIdFromDb', () => {
		it('returns project found via integrations board ID subquery', async () => {
			const mockDb = createSequentialMockDb([
				[projectRow], // subquery finds project
				[],
				[trelloIntegration],
			]);
			mockGetDb.mockReturnValue(mockDb as never);

			const result = await findProjectByBoardIdFromDb('board123');

			expect(result).toBeDefined();
			expect(result?.id).toBe('proj1');
			expect(result?.trello.boardId).toBe('board123');
		});

		it('returns undefined when no project has matching board ID', async () => {
			const mockDb = createSequentialMockDb([[]]);
			mockGetDb.mockReturnValue(mockDb as never);

			const result = await findProjectByBoardIdFromDb('nonexistent-board');

			expect(result).toBeUndefined();
		});
	});
});
