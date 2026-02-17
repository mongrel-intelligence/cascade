import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock DB repositories first (must be before imports)
vi.mock('../../../src/db/repositories/configRepository.js', () => ({
	loadConfigFromDb: vi.fn(),
	findProjectByBoardIdFromDb: vi.fn(),
	findProjectByRepoFromDb: vi.fn(),
	findProjectByJiraProjectKeyFromDb: vi.fn(),
	findProjectByIdFromDb: vi.fn(),
}));

vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	resolveCredential: vi.fn(),
	resolveAgentCredential: vi.fn(),
	resolveAllCredentials: vi.fn(),
}));

// Mock configCache
vi.mock('../../../src/config/configCache.js', () => ({
	configCache: {
		getConfig: vi.fn(),
		setConfig: vi.fn(),
		getProjectByBoardId: vi.fn(),
		setProjectByBoardId: vi.fn(),
		getProjectByRepo: vi.fn(),
		setProjectByRepo: vi.fn(),
		getProjectByJiraKey: vi.fn(),
		setProjectByJiraKey: vi.fn(),
		getOrgIdForProject: vi.fn(),
		setOrgIdForProject: vi.fn(),
		getSecrets: vi.fn(),
		setSecrets: vi.fn(),
		invalidate: vi.fn(),
	},
}));

import { configCache } from '../../../src/config/configCache.js';
import {
	findProjectByBoardId,
	findProjectById,
	findProjectByJiraProjectKey,
	findProjectByRepo,
	getAgentCredential,
	getProjectSecret,
	getProjectSecretOrNull,
	getProjectSecrets,
	invalidateConfigCache,
	loadConfig,
} from '../../../src/config/provider.js';
import {
	findProjectByBoardIdFromDb,
	findProjectByIdFromDb,
	findProjectByJiraProjectKeyFromDb,
	findProjectByRepoFromDb,
	loadConfigFromDb,
} from '../../../src/db/repositories/configRepository.js';
import {
	resolveAgentCredential,
	resolveAllCredentials,
	resolveCredential,
} from '../../../src/db/repositories/credentialsRepository.js';
import type { CascadeConfig, ProjectConfig } from '../../../src/types/index.js';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const mockConfig: CascadeConfig = {
	defaults: {
		model: 'test-model',
		maxIterations: 50,
	},
	projects: [
		{
			id: 'proj1',
			orgId: 'org1',
			name: 'Project One',
			repo: 'owner/repo1',
			baseBranch: 'main',
			branchPrefix: 'feature/',
			pm: { type: 'trello' },
			trello: {
				boardId: 'board123',
				lists: { todo: 'list-todo' },
				labels: { processing: 'label-proc' },
			},
		},
	] as ProjectConfig[],
};

const mockProject: ProjectConfig = {
	id: 'proj1',
	orgId: 'org1',
	name: 'Project One',
	repo: 'owner/repo1',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	pm: { type: 'trello' },
	trello: {
		boardId: 'board123',
		lists: { todo: 'list-todo' },
		labels: { processing: 'label-proc' },
	},
};

describe('config/provider', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('loadConfig', () => {
		it('returns cached config when available', async () => {
			vi.mocked(configCache.getConfig).mockReturnValue(mockConfig);

			const result = await loadConfig();

			expect(result).toBe(mockConfig);
			expect(loadConfigFromDb).not.toHaveBeenCalled();
			expect(configCache.setConfig).not.toHaveBeenCalled();
		});

		it('loads config from DB when not cached', async () => {
			vi.mocked(configCache.getConfig).mockReturnValue(null);
			vi.mocked(loadConfigFromDb).mockResolvedValue(mockConfig);

			const result = await loadConfig();

			expect(result).toBe(mockConfig);
			expect(loadConfigFromDb).toHaveBeenCalledTimes(1);
			expect(configCache.setConfig).toHaveBeenCalledWith(mockConfig);
		});

		it('caches loaded config for subsequent calls', async () => {
			vi.mocked(configCache.getConfig).mockReturnValue(null);
			vi.mocked(loadConfigFromDb).mockResolvedValue(mockConfig);

			await loadConfig();

			expect(configCache.setConfig).toHaveBeenCalledWith(mockConfig);
		});
	});

	describe('findProjectByBoardId', () => {
		it('returns cached project when available', async () => {
			vi.mocked(configCache.getProjectByBoardId).mockReturnValue(mockProject);

			const result = await findProjectByBoardId('board123');

			expect(result).toBe(mockProject);
			expect(findProjectByBoardIdFromDb).not.toHaveBeenCalled();
			expect(configCache.setProjectByBoardId).not.toHaveBeenCalled();
		});

		it('returns cached undefined when explicitly cached as not found', async () => {
			vi.mocked(configCache.getProjectByBoardId).mockReturnValue(undefined);

			const result = await findProjectByBoardId('nonexistent');

			expect(result).toBeUndefined();
			expect(findProjectByBoardIdFromDb).not.toHaveBeenCalled();
		});

		it('loads project from DB when not cached', async () => {
			vi.mocked(configCache.getProjectByBoardId).mockReturnValue(null);
			vi.mocked(findProjectByBoardIdFromDb).mockResolvedValue(mockProject);

			const result = await findProjectByBoardId('board123');

			expect(result).toBe(mockProject);
			expect(findProjectByBoardIdFromDb).toHaveBeenCalledWith('board123');
			expect(configCache.setProjectByBoardId).toHaveBeenCalledWith('board123', mockProject);
		});

		it('caches undefined when project not found', async () => {
			vi.mocked(configCache.getProjectByBoardId).mockReturnValue(null);
			vi.mocked(findProjectByBoardIdFromDb).mockResolvedValue(undefined);

			const result = await findProjectByBoardId('nonexistent');

			expect(result).toBeUndefined();
			expect(configCache.setProjectByBoardId).toHaveBeenCalledWith('nonexistent', undefined);
		});
	});

	describe('findProjectByRepo', () => {
		it('returns cached project when available', async () => {
			vi.mocked(configCache.getProjectByRepo).mockReturnValue(mockProject);

			const result = await findProjectByRepo('owner/repo1');

			expect(result).toBe(mockProject);
			expect(findProjectByRepoFromDb).not.toHaveBeenCalled();
		});

		it('loads project from DB when not cached', async () => {
			vi.mocked(configCache.getProjectByRepo).mockReturnValue(null);
			vi.mocked(findProjectByRepoFromDb).mockResolvedValue(mockProject);

			const result = await findProjectByRepo('owner/repo1');

			expect(result).toBe(mockProject);
			expect(findProjectByRepoFromDb).toHaveBeenCalledWith('owner/repo1');
			expect(configCache.setProjectByRepo).toHaveBeenCalledWith('owner/repo1', mockProject);
		});

		it('caches undefined when project not found', async () => {
			vi.mocked(configCache.getProjectByRepo).mockReturnValue(null);
			vi.mocked(findProjectByRepoFromDb).mockResolvedValue(undefined);

			const result = await findProjectByRepo('owner/unknown');

			expect(result).toBeUndefined();
			expect(configCache.setProjectByRepo).toHaveBeenCalledWith('owner/unknown', undefined);
		});
	});

	describe('findProjectByJiraProjectKey', () => {
		it('returns cached project when available', async () => {
			vi.mocked(configCache.getProjectByJiraKey).mockReturnValue(mockProject);

			const result = await findProjectByJiraProjectKey('PROJ');

			expect(result).toBe(mockProject);
			expect(findProjectByJiraProjectKeyFromDb).not.toHaveBeenCalled();
		});

		it('loads project from DB when not cached', async () => {
			vi.mocked(configCache.getProjectByJiraKey).mockReturnValue(null);
			vi.mocked(findProjectByJiraProjectKeyFromDb).mockResolvedValue(mockProject);

			const result = await findProjectByJiraProjectKey('PROJ');

			expect(result).toBe(mockProject);
			expect(findProjectByJiraProjectKeyFromDb).toHaveBeenCalledWith('PROJ');
			expect(configCache.setProjectByJiraKey).toHaveBeenCalledWith('PROJ', mockProject);
		});

		it('caches undefined when project not found', async () => {
			vi.mocked(configCache.getProjectByJiraKey).mockReturnValue(null);
			vi.mocked(findProjectByJiraProjectKeyFromDb).mockResolvedValue(undefined);

			const result = await findProjectByJiraProjectKey('NONEXIST');

			expect(result).toBeUndefined();
			expect(configCache.setProjectByJiraKey).toHaveBeenCalledWith('NONEXIST', undefined);
		});
	});

	describe('findProjectById', () => {
		it('does not use cache for by-id lookups', async () => {
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject);

			const result = await findProjectById('proj1');

			expect(result).toBe(mockProject);
			expect(findProjectByIdFromDb).toHaveBeenCalledWith('proj1');
			// No cache interactions
			expect(configCache.getProjectByBoardId).not.toHaveBeenCalled();
			expect(configCache.setProjectByBoardId).not.toHaveBeenCalled();
		});

		it('returns undefined when project not found', async () => {
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(undefined);

			const result = await findProjectById('nonexistent');

			expect(result).toBeUndefined();
		});
	});

	describe('getProjectSecret', () => {
		beforeEach(() => {
			// Mock getOrgIdForProject helper
			vi.mocked(configCache.getOrgIdForProject).mockReturnValue(null);
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject);
		});

		it('returns cached secret when available', async () => {
			vi.mocked(configCache.getSecrets).mockReturnValue({
				GITHUB_TOKEN: 'ghp_cached',
			});

			const result = await getProjectSecret('proj1', 'GITHUB_TOKEN');

			expect(result).toBe('ghp_cached');
			expect(resolveCredential).not.toHaveBeenCalled();
		});

		it('resolves from credentials repository when not cached', async () => {
			vi.mocked(configCache.getSecrets).mockReturnValue(null);
			vi.mocked(resolveCredential).mockResolvedValue('ghp_resolved');

			const result = await getProjectSecret('proj1', 'GITHUB_TOKEN');

			expect(result).toBe('ghp_resolved');
			expect(resolveCredential).toHaveBeenCalledWith('proj1', 'org1', 'GITHUB_TOKEN');
		});

		it('caches org ID for project on first resolution', async () => {
			vi.mocked(configCache.getSecrets).mockReturnValue(null);
			vi.mocked(configCache.getOrgIdForProject).mockReturnValue(null);
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject);
			vi.mocked(resolveCredential).mockResolvedValue('ghp_token');

			await getProjectSecret('proj1', 'GITHUB_TOKEN');

			expect(configCache.setOrgIdForProject).toHaveBeenCalledWith('proj1', 'org1');
		});

		it('reuses cached org ID for subsequent secret resolutions', async () => {
			vi.mocked(configCache.getSecrets).mockReturnValue(null);
			vi.mocked(configCache.getOrgIdForProject).mockReturnValue('org1');
			vi.mocked(resolveCredential).mockResolvedValue('ghp_token');

			await getProjectSecret('proj1', 'GITHUB_TOKEN');

			expect(findProjectByIdFromDb).not.toHaveBeenCalled();
			expect(resolveCredential).toHaveBeenCalledWith('proj1', 'org1', 'GITHUB_TOKEN');
		});

		it('throws error when secret not found', async () => {
			vi.mocked(configCache.getSecrets).mockReturnValue(null);
			vi.mocked(configCache.getOrgIdForProject).mockReturnValue('org1');
			vi.mocked(resolveCredential).mockResolvedValue(null);

			await expect(getProjectSecret('proj1', 'MISSING_KEY')).rejects.toThrow(
				"Secret 'MISSING_KEY' not found for project 'proj1' in database",
			);
		});

		it('throws when project not found', async () => {
			vi.mocked(configCache.getSecrets).mockReturnValue(null);
			vi.mocked(configCache.getOrgIdForProject).mockReturnValue(null);
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(undefined);

			await expect(getProjectSecret('proj1', 'GITHUB_TOKEN')).rejects.toThrow(
				'Project not found: proj1',
			);
		});
	});

	describe('getProjectSecretOrNull', () => {
		beforeEach(() => {
			vi.mocked(configCache.getOrgIdForProject).mockReturnValue('org1');
		});

		it('returns secret when found', async () => {
			vi.mocked(configCache.getSecrets).mockReturnValue({ KEY: 'value' });

			const result = await getProjectSecretOrNull('proj1', 'KEY');

			expect(result).toBe('value');
		});

		it('returns null when secret not found', async () => {
			vi.mocked(configCache.getSecrets).mockReturnValue(null);
			vi.mocked(resolveCredential).mockResolvedValue(null);

			const result = await getProjectSecretOrNull('proj1', 'MISSING');

			expect(result).toBeNull();
		});

		it('returns null when getProjectSecret throws', async () => {
			vi.mocked(configCache.getSecrets).mockReturnValue(null);
			vi.mocked(resolveCredential).mockRejectedValue(new Error('DB error'));

			const result = await getProjectSecretOrNull('proj1', 'KEY');

			expect(result).toBeNull();
		});
	});

	describe('getProjectSecrets', () => {
		beforeEach(() => {
			vi.mocked(configCache.getOrgIdForProject).mockReturnValue(null);
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject);
		});

		it('returns cached secrets when available', async () => {
			const secrets = { GITHUB_TOKEN: 'ghp_123', TRELLO_API_KEY: 'trello_abc' };
			vi.mocked(configCache.getSecrets).mockReturnValue(secrets);

			const result = await getProjectSecrets('proj1');

			expect(result).toBe(secrets);
			expect(resolveAllCredentials).not.toHaveBeenCalled();
		});

		it('loads all credentials from repository when not cached', async () => {
			const secrets = { GITHUB_TOKEN: 'ghp_123', TRELLO_API_KEY: 'trello_abc' };
			vi.mocked(configCache.getSecrets).mockReturnValue(null);
			vi.mocked(resolveAllCredentials).mockResolvedValue(secrets);

			const result = await getProjectSecrets('proj1');

			expect(result).toEqual(secrets);
			expect(resolveAllCredentials).toHaveBeenCalledWith('proj1', 'org1');
			expect(configCache.setSecrets).toHaveBeenCalledWith('proj1', secrets);
		});

		it('caches resolved secrets for future access', async () => {
			const secrets = { KEY: 'value' };
			vi.mocked(configCache.getSecrets).mockReturnValue(null);
			vi.mocked(configCache.getOrgIdForProject).mockReturnValue('org1');
			vi.mocked(resolveAllCredentials).mockResolvedValue(secrets);

			await getProjectSecrets('proj1');

			expect(configCache.setSecrets).toHaveBeenCalledWith('proj1', secrets);
		});

		it('resolves org ID once and caches it', async () => {
			vi.mocked(configCache.getSecrets).mockReturnValue(null);
			vi.mocked(configCache.getOrgIdForProject).mockReturnValue(null);
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject);
			vi.mocked(resolveAllCredentials).mockResolvedValue({});

			await getProjectSecrets('proj1');

			expect(configCache.setOrgIdForProject).toHaveBeenCalledWith('proj1', 'org1');
		});
	});

	describe('getAgentCredential', () => {
		beforeEach(() => {
			vi.mocked(configCache.getOrgIdForProject).mockReturnValue(null);
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject);
		});

		it('resolves agent-specific credential', async () => {
			vi.mocked(resolveAgentCredential).mockResolvedValue('ghp_agent_token');

			const result = await getAgentCredential('proj1', 'review', 'GITHUB_TOKEN');

			expect(result).toBe('ghp_agent_token');
			expect(resolveAgentCredential).toHaveBeenCalledWith(
				'proj1',
				'org1',
				'review',
				'GITHUB_TOKEN',
			);
		});

		it('returns null when agent credential not found', async () => {
			vi.mocked(resolveAgentCredential).mockResolvedValue(null);

			const result = await getAgentCredential('proj1', 'review', 'MISSING_KEY');

			expect(result).toBeNull();
		});

		it('caches org ID for subsequent agent credential resolutions', async () => {
			vi.mocked(configCache.getOrgIdForProject).mockReturnValue(null);
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject);
			vi.mocked(resolveAgentCredential).mockResolvedValue('token');

			await getAgentCredential('proj1', 'review', 'GITHUB_TOKEN');

			expect(configCache.setOrgIdForProject).toHaveBeenCalledWith('proj1', 'org1');
		});

		it('uses cached org ID when available', async () => {
			vi.mocked(configCache.getOrgIdForProject).mockReturnValue('org1');
			vi.mocked(resolveAgentCredential).mockResolvedValue('token');

			await getAgentCredential('proj1', 'review', 'GITHUB_TOKEN');

			expect(findProjectByIdFromDb).not.toHaveBeenCalled();
			expect(resolveAgentCredential).toHaveBeenCalledWith(
				'proj1',
				'org1',
				'review',
				'GITHUB_TOKEN',
			);
		});

		it('resolves for different agent types independently', async () => {
			vi.mocked(configCache.getOrgIdForProject).mockReturnValue('org1');
			vi.mocked(resolveAgentCredential)
				.mockResolvedValueOnce('token_review')
				.mockResolvedValueOnce('token_impl');

			const result1 = await getAgentCredential('proj1', 'review', 'GITHUB_TOKEN');
			const result2 = await getAgentCredential('proj1', 'implementation', 'GITHUB_TOKEN');

			expect(result1).toBe('token_review');
			expect(result2).toBe('token_impl');
			expect(resolveAgentCredential).toHaveBeenNthCalledWith(
				1,
				'proj1',
				'org1',
				'review',
				'GITHUB_TOKEN',
			);
			expect(resolveAgentCredential).toHaveBeenNthCalledWith(
				2,
				'proj1',
				'org1',
				'implementation',
				'GITHUB_TOKEN',
			);
		});
	});

	describe('invalidateConfigCache', () => {
		it('calls configCache.invalidate', () => {
			invalidateConfigCache();

			expect(configCache.invalidate).toHaveBeenCalledTimes(1);
		});

		it('clears all cached data', () => {
			// Setup caches
			vi.mocked(configCache.getConfig).mockReturnValue(mockConfig);
			vi.mocked(configCache.getProjectByBoardId).mockReturnValue(mockProject);
			vi.mocked(configCache.getSecrets).mockReturnValue({ KEY: 'val' });

			invalidateConfigCache();

			expect(configCache.invalidate).toHaveBeenCalled();
		});
	});
});
