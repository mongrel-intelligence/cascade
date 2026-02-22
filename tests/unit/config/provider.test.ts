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
	resolveIntegrationCredential: vi.fn(),
	resolveAllIntegrationCredentials: vi.fn(),
	resolveOrgCredential: vi.fn(),
	resolveAllOrgCredentials: vi.fn(),
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
		invalidate: vi.fn(),
	},
}));

import { configCache } from '../../../src/config/configCache.js';
import {
	findProjectByBoardId,
	findProjectById,
	findProjectByJiraProjectKey,
	findProjectByRepo,
	getAllProjectCredentials,
	getIntegrationCredential,
	getIntegrationCredentialOrNull,
	getOrgCredential,
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
	resolveAllIntegrationCredentials,
	resolveAllOrgCredentials,
	resolveIntegrationCredential,
	resolveOrgCredential,
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
	const envKeysToClean: string[] = [];

	function setEnvCredential(key: string, value: string): void {
		process.env[key] = value;
		envKeysToClean.push(key);
	}

	beforeEach(() => {
		invalidateConfigCache();
		vi.clearAllMocks();
	});

	afterEach(() => {
		for (const key of envKeysToClean) {
			delete process.env[key];
		}
		envKeysToClean.length = 0;
		invalidateConfigCache();
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

	describe('getIntegrationCredential', () => {
		it('returns credential from process.env', async () => {
			setEnvCredential('TRELLO_API_KEY', 'env-key');

			const result = await getIntegrationCredential('proj1', 'pm', 'api_key');

			expect(result).toBe('env-key');
			expect(resolveIntegrationCredential).not.toHaveBeenCalled();
		});

		it('resolves from DB when not in secrets store', async () => {
			vi.mocked(resolveIntegrationCredential).mockResolvedValue('db-value');

			const result = await getIntegrationCredential('proj1', 'pm', 'api_key');

			expect(result).toBe('db-value');
			expect(resolveIntegrationCredential).toHaveBeenCalledWith('proj1', 'pm', 'api_key');
		});

		it('throws when credential not found', async () => {
			vi.mocked(resolveIntegrationCredential).mockResolvedValue(null);

			await expect(getIntegrationCredential('proj1', 'pm', 'api_key')).rejects.toThrow(
				"Integration credential 'pm/api_key' not found for project 'proj1'",
			);
		});

		it('throws without DB fallback when CASCADE_CREDENTIAL_KEYS is set (worker context)', async () => {
			setEnvCredential('CASCADE_CREDENTIAL_KEYS', 'OTHER_KEY');

			await expect(getIntegrationCredential('proj1', 'pm', 'api_key')).rejects.toThrow(
				"Integration credential 'pm/api_key' not found for project 'proj1'",
			);
			expect(resolveIntegrationCredential).not.toHaveBeenCalled();
		});
	});

	describe('getIntegrationCredentialOrNull', () => {
		it('returns credential from process.env', async () => {
			setEnvCredential('GITHUB_TOKEN_IMPLEMENTER', 'env-token');

			const result = await getIntegrationCredentialOrNull('proj1', 'scm', 'implementer_token');

			expect(result).toBe('env-token');
		});

		it('returns null when credential not found', async () => {
			vi.mocked(resolveIntegrationCredential).mockResolvedValue(null);

			const result = await getIntegrationCredentialOrNull('proj1', 'scm', 'implementer_token');

			expect(result).toBeNull();
		});

		it('returns value from DB when found', async () => {
			vi.mocked(resolveIntegrationCredential).mockResolvedValue('db-token');

			const result = await getIntegrationCredentialOrNull('proj1', 'scm', 'implementer_token');

			expect(result).toBe('db-token');
		});

		it('returns null without DB fallback when CASCADE_CREDENTIAL_KEYS is set (worker context)', async () => {
			setEnvCredential('CASCADE_CREDENTIAL_KEYS', 'OTHER_KEY');

			const result = await getIntegrationCredentialOrNull('proj1', 'scm', 'implementer_token');

			expect(result).toBeNull();
			expect(resolveIntegrationCredential).not.toHaveBeenCalled();
		});
	});

	describe('getOrgCredential', () => {
		beforeEach(() => {
			vi.mocked(configCache.getOrgIdForProject).mockReturnValue(null);
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject);
		});

		it('returns credential from process.env', async () => {
			setEnvCredential('OPENROUTER_API_KEY', 'env-or-key');

			const result = await getOrgCredential('proj1', 'OPENROUTER_API_KEY');

			expect(result).toBe('env-or-key');
			expect(resolveOrgCredential).not.toHaveBeenCalled();
		});

		it('resolves from DB via org ID', async () => {
			vi.mocked(resolveOrgCredential).mockResolvedValue('org-value');

			const result = await getOrgCredential('proj1', 'OPENROUTER_API_KEY');

			expect(result).toBe('org-value');
			expect(resolveOrgCredential).toHaveBeenCalledWith('org1', 'OPENROUTER_API_KEY');
		});

		it('returns null when credential not found', async () => {
			vi.mocked(resolveOrgCredential).mockResolvedValue(null);

			const result = await getOrgCredential('proj1', 'MISSING');

			expect(result).toBeNull();
		});

		it('throws when project not found', async () => {
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(undefined);

			await expect(getOrgCredential('proj1', 'KEY')).rejects.toThrow('Project not found: proj1');
		});

		it('returns null without DB fallback when CASCADE_CREDENTIAL_KEYS is set (worker context)', async () => {
			setEnvCredential('CASCADE_CREDENTIAL_KEYS', 'OTHER_KEY');

			const result = await getOrgCredential('proj1', 'OPENROUTER_API_KEY');

			expect(result).toBeNull();
			expect(resolveOrgCredential).not.toHaveBeenCalled();
		});
	});

	describe('getAllProjectCredentials', () => {
		beforeEach(() => {
			vi.mocked(configCache.getOrgIdForProject).mockReturnValue(null);
			vi.mocked(findProjectByIdFromDb).mockResolvedValue(mockProject);
		});

		it('loads all credentials from repositories', async () => {
			vi.mocked(resolveAllIntegrationCredentials).mockResolvedValue([
				{ category: 'pm', provider: 'trello', role: 'api_key', value: 'trello-key' },
				{ category: 'pm', provider: 'trello', role: 'token', value: 'trello-token' },
				{ category: 'scm', provider: 'github', role: 'implementer_token', value: 'ghp_impl' },
			]);
			vi.mocked(resolveAllOrgCredentials).mockResolvedValue({
				OPENROUTER_API_KEY: 'or-key',
			});

			const result = await getAllProjectCredentials('proj1');

			expect(result).toEqual({
				OPENROUTER_API_KEY: 'or-key',
				TRELLO_API_KEY: 'trello-key',
				TRELLO_TOKEN: 'trello-token',
				GITHUB_TOKEN_IMPLEMENTER: 'ghp_impl',
			});
		});

		it('returns empty object when no credentials exist', async () => {
			vi.mocked(resolveAllIntegrationCredentials).mockResolvedValue([]);
			vi.mocked(resolveAllOrgCredentials).mockResolvedValue({});

			const result = await getAllProjectCredentials('proj1');
			expect(result).toEqual({});
		});

		it('reconstructs credentials from env vars when CASCADE_CREDENTIAL_KEYS is set (worker context)', async () => {
			setEnvCredential('CASCADE_CREDENTIAL_KEYS', 'TRELLO_API_KEY,OPENROUTER_API_KEY');
			setEnvCredential('TRELLO_API_KEY', 'env-key');
			setEnvCredential('OPENROUTER_API_KEY', 'env-or');

			const result = await getAllProjectCredentials('proj1');

			expect(result).toEqual({ TRELLO_API_KEY: 'env-key', OPENROUTER_API_KEY: 'env-or' });
			expect(resolveAllIntegrationCredentials).not.toHaveBeenCalled();
			expect(resolveAllOrgCredentials).not.toHaveBeenCalled();
		});
	});

	describe('invalidateConfigCache', () => {
		it('calls configCache.invalidate', () => {
			invalidateConfigCache();

			expect(configCache.invalidate).toHaveBeenCalledTimes(1);
		});
	});
});
