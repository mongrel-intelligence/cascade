import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock config provider to avoid DB connections
vi.mock('../../../src/config/provider.js', () => ({
	loadConfig: vi.fn(),
}));
vi.mock('../../../src/config/configCache.js', () => ({
	configCache: {
		getConfig: vi.fn().mockReturnValue(null),
		getProjectByBoardId: vi.fn().mockReturnValue(null),
		getProjectByRepo: vi.fn().mockReturnValue(null),
		setConfig: vi.fn(),
		setProjectByBoardId: vi.fn(),
		setProjectByRepo: vi.fn(),
		invalidate: vi.fn(),
	},
}));

import { loadConfig } from '../../../src/config/provider.js';
import { loadProjectConfig, routerConfig } from '../../../src/router/config.js';

const mockLoadConfig = vi.mocked(loadConfig);

describe('routerConfig', () => {
	it('has default Redis URL', () => {
		expect(routerConfig.redisUrl).toBe('redis://localhost:6379');
	});

	it('has default maxWorkers', () => {
		expect(routerConfig.maxWorkers).toBe(3);
	});

	it('has default workerMemoryMb', () => {
		expect(routerConfig.workerMemoryMb).toBe(4096);
	});

	it('has default dockerNetwork', () => {
		expect(routerConfig.dockerNetwork).toBe('services_default');
	});

	it('has default workerTimeoutMs of 30 minutes', () => {
		expect(routerConfig.workerTimeoutMs).toBe(30 * 60 * 1000);
	});
});

describe('loadProjectConfig', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.doMock('../../../src/config/provider.js', () => ({
			loadConfig: mockLoadConfig,
		}));
		vi.doMock('../../../src/config/configCache.js', () => ({
			configCache: {
				getConfig: vi.fn().mockReturnValue(null),
				setConfig: vi.fn(),
			},
		}));
	});

	it('maps trello project config correctly', async () => {
		mockLoadConfig.mockResolvedValueOnce({
			projects: [
				{
					id: 'p1',
					name: 'Project 1',
					repo: 'owner/repo',
					orgId: 'org1',
					baseBranch: 'main',
					branchPrefix: 'cascade/',
					pm: { type: 'trello' },
					trello: {
						boardId: 'board1',
						lists: { briefing: 'list1', planning: 'list2', todo: 'list3' },
						labels: { readyToProcess: 'label1', processed: 'label2' },
					},
				},
			],
		} as never);

		const { loadProjectConfig: freshLoad } = await import('../../../src/router/config.js');
		const result = await freshLoad();

		expect(result.projects).toHaveLength(1);
		expect(result.projects[0]).toMatchObject({
			id: 'p1',
			repo: 'owner/repo',
			pmType: 'trello',
			trello: {
				boardId: 'board1',
				lists: { briefing: 'list1', planning: 'list2', todo: 'list3' },
				labels: { readyToProcess: 'label1', processed: 'label2' },
			},
		});
	});

	it('maps jira project config correctly', async () => {
		mockLoadConfig.mockResolvedValueOnce({
			projects: [
				{
					id: 'p2',
					name: 'JIRA Project',
					repo: 'owner/jira-repo',
					orgId: 'org1',
					baseBranch: 'main',
					branchPrefix: 'cascade/',
					pm: { type: 'jira' },
					jira: {
						projectKey: 'MYPROJ',
						baseUrl: 'https://mycompany.atlassian.net',
					},
				},
			],
		} as never);

		const { loadProjectConfig: freshLoad } = await import('../../../src/router/config.js');
		const result = await freshLoad();

		expect(result.projects).toHaveLength(1);
		expect(result.projects[0]).toMatchObject({
			id: 'p2',
			repo: 'owner/jira-repo',
			pmType: 'jira',
			jira: {
				projectKey: 'MYPROJ',
				baseUrl: 'https://mycompany.atlassian.net',
			},
		});
	});

	it('defaults pmType to trello when pm.type is not set', async () => {
		mockLoadConfig.mockResolvedValueOnce({
			projects: [
				{
					id: 'p3',
					name: 'No PM type',
					repo: 'owner/repo3',
					orgId: 'org1',
					baseBranch: 'main',
					branchPrefix: 'cascade/',
					// No pm field
				},
			],
		} as never);

		const { loadProjectConfig: freshLoad } = await import('../../../src/router/config.js');
		const result = await freshLoad();

		expect(result.projects[0].pmType).toBe('trello');
	});

	it('always fetches fresh config from DB', async () => {
		const innerMock = vi.fn().mockResolvedValue({
			projects: [
				{
					id: 'p4',
					name: 'Fresh',
					repo: 'owner/fresh',
					orgId: 'org1',
					baseBranch: 'main',
					branchPrefix: 'cascade/',
				},
			],
		});

		vi.resetModules();
		vi.doMock('../../../src/config/provider.js', () => ({
			loadConfig: innerMock,
		}));
		vi.doMock('../../../src/config/configCache.js', () => ({
			configCache: {
				getConfig: vi.fn().mockReturnValue(null),
				setConfig: vi.fn(),
			},
		}));

		const { loadProjectConfig: freshLoad } = await import('../../../src/router/config.js');
		await freshLoad();
		await freshLoad();

		expect(innerMock).toHaveBeenCalledTimes(2);
	});
});
