import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the DB repositories
vi.mock('../../../src/db/repositories/configRepository.js', () => ({
	loadConfigFromDb: vi.fn(),
	findProjectByBoardIdFromDb: vi.fn(),
	findProjectByRepoFromDb: vi.fn(),
	findProjectByIdFromDb: vi.fn(),
}));

vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	resolveCredential: vi.fn(),
	resolveAgentCredential: vi.fn(),
	resolveAllCredentials: vi.fn(),
}));

import { getProjectGitHubToken } from '../../../src/config/projects.js';
import {
	findProjectByBoardId,
	findProjectById,
	findProjectByRepo,
	getProjectSecret,
	getProjectSecretOrNull,
	getProjectSecrets,
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
	resolveAllCredentials,
	resolveCredential,
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
		it('returns DB credential when available', async () => {
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject1);
			vi.mocked(resolveCredential).mockResolvedValue('db-secret-value');

			const result = await getProjectSecret('project1', 'TRELLO_API_KEY');
			expect(result).toBe('db-secret-value');
		});

		it('throws when secret not found in DB', async () => {
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject1);
			vi.mocked(resolveCredential).mockResolvedValue(null);

			await expect(getProjectSecret('project1', 'MISSING_KEY')).rejects.toThrow(
				"Secret 'MISSING_KEY' not found for project 'project1' in database",
			);
		});
	});

	describe('getProjectSecret - cached secrets path', () => {
		it('returns from cached secrets without hitting resolveCredential', async () => {
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject1);
			vi.mocked(resolveAllCredentials).mockResolvedValue({
				TRELLO_API_KEY: 'cached-value',
				GITHUB_TOKEN: 'cached-gh-token',
			});

			// Populate the secrets cache via getProjectSecrets
			await getProjectSecrets('project1');

			vi.clearAllMocks();

			// Now getProjectSecret should use the cached secrets
			const result = await getProjectSecret('project1', 'TRELLO_API_KEY');
			expect(result).toBe('cached-value');

			// resolveCredential should NOT have been called (cache hit)
			expect(resolveCredential).not.toHaveBeenCalled();
		});
	});

	describe('getProjectSecretOrNull', () => {
		it('returns credential value when found', async () => {
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject1);
			vi.mocked(resolveCredential).mockResolvedValue('secret-value');

			const result = await getProjectSecretOrNull('project1', 'TRELLO_API_KEY');
			expect(result).toBe('secret-value');
		});

		it('returns null when no credential found', async () => {
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject1);
			vi.mocked(resolveCredential).mockResolvedValue(null);

			const result = await getProjectSecretOrNull('project1', 'NO_SUCH_KEY');
			expect(result).toBeNull();
		});
	});

	describe('getProjectSecrets', () => {
		it('resolves all credentials via org ID', async () => {
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject1);
			vi.mocked(resolveAllCredentials).mockResolvedValue({
				GITHUB_TOKEN: 'ghp_abc',
				TRELLO_API_KEY: 'trello123',
			});

			const result = await getProjectSecrets('project1');
			expect(result).toEqual({
				GITHUB_TOKEN: 'ghp_abc',
				TRELLO_API_KEY: 'trello123',
			});
			expect(resolveAllCredentials).toHaveBeenCalledWith('project1', 'default');
		});

		it('caches secrets after first call', async () => {
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject1);
			vi.mocked(resolveAllCredentials).mockResolvedValue({ KEY: 'val' });

			await getProjectSecrets('project1');
			await getProjectSecrets('project1');

			// resolveAllCredentials called only once
			expect(resolveAllCredentials).toHaveBeenCalledTimes(1);
		});

		it('returns empty object when no credentials exist', async () => {
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject2);
			vi.mocked(resolveAllCredentials).mockResolvedValue({});

			const result = await getProjectSecrets('project2');
			expect(result).toEqual({});
		});
	});

	describe('orgId resolution', () => {
		it('caches org ID after first lookup', async () => {
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject1);
			vi.mocked(resolveCredential).mockResolvedValue('value1');

			// Two calls for the same project
			await getProjectSecret('project1', 'KEY1');
			await getProjectSecret('project1', 'KEY2');

			// findProjectByIdFromDb called once (for orgId), not twice
			expect(findProjectByIdFromDb).toHaveBeenCalledTimes(1);
		});

		it('throws when project not found', async () => {
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(undefined);

			await expect(getProjectSecret('nonexistent', 'KEY')).rejects.toThrow(
				'Project not found: nonexistent',
			);
		});

		it('uses project-specific org ID', async () => {
			const customOrgProject = { ...mockProject1, orgId: 'acme-corp' };
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(customOrgProject);
			vi.mocked(resolveCredential).mockResolvedValue('value1');

			await getProjectSecret('project1', 'KEY');

			expect(resolveCredential).toHaveBeenCalledWith('project1', 'acme-corp', 'KEY');
		});
	});

	describe('getProjectGitHubToken', () => {
		it('returns GITHUB_TOKEN_IMPLEMENTER when available', async () => {
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject1);
			vi.mocked(resolveCredential).mockResolvedValue('implementer-token');

			const result = await getProjectGitHubToken(mockConfig.projects[0]);
			expect(result).toBe('implementer-token');
		});

		it('falls back to legacy GITHUB_TOKEN when IMPLEMENTER token is missing', async () => {
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject1);
			vi.mocked(resolveCredential)
				.mockResolvedValueOnce(null) // GITHUB_TOKEN_IMPLEMENTER not found
				.mockResolvedValueOnce('legacy-token'); // GITHUB_TOKEN found

			const result = await getProjectGitHubToken(mockConfig.projects[0]);
			expect(result).toBe('legacy-token');
		});

		it('throws when neither IMPLEMENTER nor legacy token exists', async () => {
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject1);
			vi.mocked(resolveCredential).mockResolvedValue(null);

			await expect(getProjectGitHubToken(mockConfig.projects[0])).rejects.toThrow(
				"Missing GITHUB_TOKEN_IMPLEMENTER (or legacy GITHUB_TOKEN) in database for project 'project1'",
			);
		});
	});
});
