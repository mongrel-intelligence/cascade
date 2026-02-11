import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
}));

vi.mock('../../../src/config/schema.js', () => ({
	validateConfig: vi.fn((config: unknown) => config),
}));

import { existsSync, readFileSync } from 'node:fs';
import {
	clearConfigCache,
	findProjectByBoardId,
	findProjectById,
	findProjectByRepo,
	getProjectGitHubToken,
	loadProjectsConfig,
} from '../../../src/config/projects.js';

describe('projects config', () => {
	const mockConfig = {
		defaults: {
			model: 'test-model',
			maxIterations: 50,
		},
		projects: [
			{
				id: 'project1',
				name: 'Project 1',
				repo: 'owner/repo1',
				baseBranch: 'main',
				branchPrefix: 'feature/',
				githubTokenEnv: 'GITHUB_TOKEN_1',
				trello: {
					boardId: 'board1',
					lists: { todo: 'list1' },
					labels: {},
				},
			},
			{
				id: 'project2',
				name: 'Project 2',
				repo: 'owner/repo2',
				baseBranch: 'main',
				branchPrefix: 'feature/',
				githubTokenEnv: 'GITHUB_TOKEN',
				trello: {
					boardId: 'board2',
					lists: { todo: 'list2' },
					labels: {},
				},
			},
		],
	};

	beforeEach(() => {
		vi.clearAllMocks();
		clearConfigCache();
	});

	afterEach(() => {
		clearConfigCache();
	});

	describe('loadProjectsConfig', () => {
		it('loads and validates config from file', () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

			const result = loadProjectsConfig('/path/to/config.json');

			expect(existsSync).toHaveBeenCalledWith('/path/to/config.json');
			expect(readFileSync).toHaveBeenCalledWith('/path/to/config.json', 'utf-8');
			expect(result).toEqual(mockConfig);
		});

		it('throws when config file does not exist', () => {
			vi.mocked(existsSync).mockReturnValue(false);

			expect(() => loadProjectsConfig('/missing/config.json')).toThrow(
				'Config file not found: /missing/config.json',
			);
		});

		it('caches config after first load', () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

			loadProjectsConfig('/path/to/config.json');
			loadProjectsConfig('/path/to/config.json');

			expect(readFileSync).toHaveBeenCalledTimes(1);
		});

		it('reloads config after cache is cleared', () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

			loadProjectsConfig('/path/to/config.json');
			clearConfigCache();
			loadProjectsConfig('/path/to/config.json');

			expect(readFileSync).toHaveBeenCalledTimes(2);
		});
	});

	describe('findProjectByBoardId', () => {
		it('finds project by board ID', () => {
			const result = findProjectByBoardId(mockConfig, 'board1');
			expect(result?.id).toBe('project1');
		});

		it('returns undefined for unknown board ID', () => {
			const result = findProjectByBoardId(mockConfig, 'unknown');
			expect(result).toBeUndefined();
		});
	});

	describe('findProjectById', () => {
		it('finds project by ID', () => {
			const result = findProjectById(mockConfig, 'project2');
			expect(result?.id).toBe('project2');
		});

		it('returns undefined for unknown ID', () => {
			const result = findProjectById(mockConfig, 'unknown');
			expect(result).toBeUndefined();
		});
	});

	describe('findProjectByRepo', () => {
		it('finds project by repo full name', () => {
			const result = findProjectByRepo(mockConfig, 'owner/repo1');
			expect(result?.id).toBe('project1');
		});

		it('returns undefined for unknown repo', () => {
			const result = findProjectByRepo(mockConfig, 'owner/unknown');
			expect(result).toBeUndefined();
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

		it('returns token from environment variable', () => {
			process.env.GITHUB_TOKEN_1 = 'test-token-123';

			const result = getProjectGitHubToken(mockConfig.projects[0]);

			expect(result).toBe('test-token-123');
		});

		it('uses GITHUB_TOKEN as default when githubTokenEnv is not set', () => {
			process.env.GITHUB_TOKEN = 'default-token';

			const project = { ...mockConfig.projects[0], githubTokenEnv: undefined };
			const result = getProjectGitHubToken(project);

			expect(result).toBe('default-token');
		});

		it('throws when token environment variable is not set', () => {
			process.env.GITHUB_TOKEN_1 = undefined;

			expect(() => getProjectGitHubToken(mockConfig.projects[0])).toThrow(
				'Missing GitHub token for project project1: GITHUB_TOKEN_1 not set',
			);
		});
	});
});
