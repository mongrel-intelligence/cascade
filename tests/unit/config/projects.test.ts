import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the DB repositories
vi.mock('../../../src/db/repositories/configRepository.js', () => ({
	loadConfigFromDb: vi.fn(),
	findProjectByBoardIdFromDb: vi.fn(),
	findProjectByRepoFromDb: vi.fn(),
	findProjectByIdFromDb: vi.fn(),
}));

vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	resolveIntegrationCredential: vi.fn(),
	resolveAllIntegrationCredentials: vi.fn(),
	resolveOrgCredential: vi.fn(),
	resolveAllOrgCredentials: vi.fn(),
}));

import { getProjectGitHubToken } from '../../../src/config/projects.js';
import {
	findProjectByBoardId,
	findProjectById,
	findProjectByRepo,
	getAllProjectCredentials,
	getIntegrationCredential,
	getIntegrationCredentialOrNull,
	invalidateConfigCache,
	loadConfig,
} from '../../../src/config/provider.js';
import {
	findProjectByBoardIdFromDb,
	findProjectByIdFromDb,
	findProjectByRepoFromDb,
	loadConfigFromDb,
} from '../../../src/db/repositories/configRepository.js';
import {
	resolveAllIntegrationCredentials,
	resolveAllOrgCredentials,
	resolveIntegrationCredential,
} from '../../../src/db/repositories/credentialsRepository.js';

describe('config provider', () => {
	const mockProject1 = {
		id: 'project1',
		orgId: 'default',
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
		orgId: 'default',
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
			watchdogTimeoutMs: 1800000,
			cardBudgetUsd: 5,
			agentBackend: 'llmist',
			progressModel: 'test-model',
			progressIntervalMinutes: 5,
		},
		projects: [mockProject1, mockProject2],
	};

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

	describe('getIntegrationCredential', () => {
		// These tests go through getIntegrationCredentialOrNull which checks process.env first.
		// Use vi.stubEnv to prevent any env vars from shadowing the DB mock.
		beforeEach(() => {
			vi.stubEnv('TRELLO_API_KEY', '');
		});
		it('resolves credential from DB', async () => {
			vi.mocked(resolveIntegrationCredential).mockResolvedValue('db-secret-value');

			const result = await getIntegrationCredential('project1', 'pm', 'api_key');
			expect(result).toBe('db-secret-value');
		});

		it('throws when credential not found', async () => {
			vi.mocked(resolveIntegrationCredential).mockResolvedValue(null);

			await expect(getIntegrationCredential('project1', 'pm', 'api_key')).rejects.toThrow(
				"Integration credential 'pm/api_key' not found for project 'project1'",
			);
		});
	});

	describe('getIntegrationCredentialOrNull', () => {
		// Clear any env vars that might shadow the mock (implementer_token maps to GITHUB_TOKEN_IMPLEMENTER).
		beforeEach(() => {
			vi.stubEnv('GITHUB_TOKEN_IMPLEMENTER', '');
		});
		it('returns credential value when found', async () => {
			vi.mocked(resolveIntegrationCredential).mockResolvedValue('secret-value');

			const result = await getIntegrationCredentialOrNull('project1', 'scm', 'implementer_token');
			expect(result).toBe('secret-value');
		});

		it('returns null when no credential found', async () => {
			vi.mocked(resolveIntegrationCredential).mockResolvedValue(null);

			const result = await getIntegrationCredentialOrNull('project1', 'scm', 'implementer_token');
			expect(result).toBeNull();
		});
	});

	describe('getAllProjectCredentials', () => {
		it('resolves all credentials via integration + org defaults', async () => {
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject1);
			vi.mocked(resolveAllIntegrationCredentials).mockResolvedValue([
				{ category: 'pm', provider: 'trello', role: 'api_key', value: 'trello123' },
			]);
			vi.mocked(resolveAllOrgCredentials).mockResolvedValue({});

			const result = await getAllProjectCredentials('project1');
			expect(result).toEqual({
				TRELLO_API_KEY: 'trello123',
			});
		});

		it('returns empty object when no credentials exist', async () => {
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject2);
			vi.mocked(resolveAllIntegrationCredentials).mockResolvedValue([]);
			vi.mocked(resolveAllOrgCredentials).mockResolvedValue({});

			const result = await getAllProjectCredentials('project2');
			expect(result).toEqual({});
		});
	});

	describe('getProjectGitHubToken', () => {
		// getProjectGitHubToken calls getIntegrationCredentialOrNull which checks process.env first.
		// Use vi.stubEnv to prevent the env var from shadowing the mock.
		beforeEach(() => {
			vi.stubEnv('GITHUB_TOKEN_IMPLEMENTER', '');
		});
		it('returns implementer token when available', async () => {
			vi.mocked(resolveIntegrationCredential).mockResolvedValue('implementer-token');

			const result = await getProjectGitHubToken(mockConfig.projects[0]);
			expect(result).toBe('implementer-token');
		});

		it('throws when implementer token is missing', async () => {
			vi.mocked(resolveIntegrationCredential).mockResolvedValue(null);

			await expect(getProjectGitHubToken(mockConfig.projects[0])).rejects.toThrow(
				"Missing implementer token (SCM integration) for project 'project1'",
			);
		});
	});
});
