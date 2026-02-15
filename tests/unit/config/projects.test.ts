import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the DB repositories
vi.mock('../../../src/db/repositories/configRepository.js', () => ({
	loadConfigFromDb: vi.fn(),
	findProjectByBoardIdFromDb: vi.fn(),
	findProjectByRepoFromDb: vi.fn(),
	findProjectByIdFromDb: vi.fn(),
}));

vi.mock('../../../src/db/repositories/secretsRepository.js', () => ({
	getProjectSecret: vi.fn(),
	getProjectSecrets: vi.fn(),
}));

import { getProjectGitHubToken } from '../../../src/config/projects.js';
import {
	findProjectByBoardId,
	findProjectById,
	findProjectByRepo,
	getProjectSecret,
	invalidateConfigCache,
	loadConfig,
} from '../../../src/config/provider.js';
import {
	findProjectByBoardIdFromDb,
	findProjectByIdFromDb,
	findProjectByRepoFromDb,
	loadConfigFromDb,
} from '../../../src/db/repositories/configRepository.js';
import { getProjectSecret as getProjectSecretFromDb } from '../../../src/db/repositories/secretsRepository.js';

describe('config provider', () => {
	const mockProject1 = {
		id: 'project1',
		name: 'Project 1',
		repo: 'owner/repo1',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: {
			boardId: 'board1',
			lists: { todo: 'list1' },
			labels: {},
		},
	};

	const mockProject2 = {
		id: 'project2',
		name: 'Project 2',
		repo: 'owner/repo2',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: {
			boardId: 'board2',
			lists: { todo: 'list2' },
			labels: {},
		},
	};

	const mockConfig = {
		defaults: {
			model: 'test-model',
			agentModels: {},
			maxIterations: 50,
			agentIterations: {},
			freshMachineTimeoutMs: 300000,
			watchdogTimeoutMs: 1800000,
			postJobGracePeriodMs: 5000,
			cardBudgetUsd: 5,
			agentBackend: 'llmist',
			progressModel: 'test-model',
			progressIntervalMinutes: 5,
		},
		projects: [mockProject1, mockProject2],
	};

	beforeEach(() => {
		vi.clearAllMocks();
		invalidateConfigCache();
	});

	afterEach(() => {
		invalidateConfigCache();
	});

	describe('loadConfig', () => {
		it('loads config from database', async () => {
			vi.mocked(loadConfigFromDb).mockResolvedValue(mockConfig);

			const result = await loadConfig();

			expect(loadConfigFromDb).toHaveBeenCalledTimes(1);
			expect(result).toEqual(mockConfig);
		});

		it('caches config after first load', async () => {
			vi.mocked(loadConfigFromDb).mockResolvedValue(mockConfig);

			await loadConfig();
			await loadConfig();

			expect(loadConfigFromDb).toHaveBeenCalledTimes(1);
		});

		it('reloads after cache invalidation', async () => {
			vi.mocked(loadConfigFromDb).mockResolvedValue(mockConfig);

			await loadConfig();
			invalidateConfigCache();
			await loadConfig();

			expect(loadConfigFromDb).toHaveBeenCalledTimes(2);
		});
	});

	describe('findProjectByBoardId', () => {
		it('finds project by board ID', async () => {
			vi.mocked(findProjectByBoardIdFromDb).mockResolvedValue(mockProject1);

			const result = await findProjectByBoardId('board1');
			expect(result?.id).toBe('project1');
		});

		it('returns undefined for unknown board ID', async () => {
			vi.mocked(findProjectByBoardIdFromDb).mockResolvedValue(undefined);

			const result = await findProjectByBoardId('unknown');
			expect(result).toBeUndefined();
		});
	});

	describe('findProjectById', () => {
		it('finds project by ID', async () => {
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject2);

			const result = await findProjectById('project2');
			expect(result?.id).toBe('project2');
		});

		it('returns undefined for unknown ID', async () => {
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(undefined);

			const result = await findProjectById('unknown');
			expect(result).toBeUndefined();
		});
	});

	describe('findProjectByRepo', () => {
		it('finds project by repo full name', async () => {
			vi.mocked(findProjectByRepoFromDb).mockResolvedValue(mockProject1);

			const result = await findProjectByRepo('owner/repo1');
			expect(result?.id).toBe('project1');
		});

		it('returns undefined for unknown repo', async () => {
			vi.mocked(findProjectByRepoFromDb).mockResolvedValue(undefined);

			const result = await findProjectByRepo('owner/unknown');
			expect(result).toBeUndefined();
		});
	});

	describe('getProjectSecret', () => {
		it('returns DB secret when available', async () => {
			vi.mocked(getProjectSecretFromDb).mockResolvedValue('db-secret-value');

			const result = await getProjectSecret('project1', 'TRELLO_API_KEY');
			expect(result).toBe('db-secret-value');
		});

		it('falls back to env var when DB has no value', async () => {
			vi.mocked(getProjectSecretFromDb).mockResolvedValue(null);
			process.env.TRELLO_API_KEY = 'env-api-key';

			const result = await getProjectSecret('project1', 'TRELLO_API_KEY');
			expect(result).toBe('env-api-key');
		});

		it('uses custom fallback env var', async () => {
			vi.mocked(getProjectSecretFromDb).mockResolvedValue(null);
			process.env.MY_CUSTOM_KEY = 'custom-value';

			const result = await getProjectSecret('project1', 'SOME_KEY', 'MY_CUSTOM_KEY');
			expect(result).toBe('custom-value');

			// biome-ignore lint/performance/noDelete: must actually remove env var
			delete process.env.MY_CUSTOM_KEY;
		});

		it('throws when no DB secret and no env var', async () => {
			vi.mocked(getProjectSecretFromDb).mockResolvedValue(null);
			// biome-ignore lint/performance/noDelete: must actually remove env var, not set to "undefined" string
			delete process.env.MISSING_KEY;

			await expect(getProjectSecret('project1', 'MISSING_KEY')).rejects.toThrow(
				"Secret 'MISSING_KEY' not found",
			);
		});
	});

	describe('getProjectGitHubToken', () => {
		const originalEnv = process.env;

		beforeEach(() => {
			process.env = { ...originalEnv };
		});

		afterEach(() => {
			process.env = originalEnv;
		});

		it('falls back to GITHUB_TOKEN env var', async () => {
			vi.mocked(getProjectSecretFromDb).mockResolvedValue(null);
			process.env.GITHUB_TOKEN = 'test-token-123';

			const result = await getProjectGitHubToken(mockConfig.projects[0]);
			expect(result).toBe('test-token-123');
		});

		it('throws when no token available', async () => {
			vi.mocked(getProjectSecretFromDb).mockResolvedValue(null);
			process.env.GITHUB_TOKEN = undefined;

			await expect(getProjectGitHubToken(mockConfig.projects[0])).rejects.toThrow(
				'Missing GitHub token for project project1',
			);
		});
	});
});
