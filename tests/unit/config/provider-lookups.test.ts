/**
 * Spec 024 plan 1 — payload-aware project lookups.
 *
 * These are the seam plans 2 and 4 route through: the full sibling list for a
 * shared board key, the primary project for a shared repository, and the
 * PR->project link. All dormant in this plan.
 *
 * The pre-existing `provider.test.ts` covers the legacy singular lookups, which
 * this plan deliberately leaves untouched — that suite passing unedited is the
 * AC #12 evidence that today's single-project deployments are unaffected.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/db/repositories/configRepository.js', () => ({
	loadConfigFromDb: vi.fn(),
	findProjectByBoardIdFromDb: vi.fn(),
	findProjectByRepoFromDb: vi.fn(),
	findProjectByJiraProjectKeyFromDb: vi.fn(),
	findProjectByLinearTeamIdFromDb: vi.fn(),
	findProjectByIdFromDb: vi.fn(),
	findProjectWithConfigByLinearTeamId: vi.fn(),
	findProjectsByJiraProjectKeyFromDb: vi.fn(),
	findPrimaryProjectByRepoFromDb: vi.fn(),
}));

vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	resolveProjectCredential: vi.fn(),
	resolveAllProjectCredentials: vi.fn(),
}));

vi.mock('../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	findProjectIdByRepoPrFromDb: vi.fn(),
}));

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
		getProjectByLinearTeamId: vi.fn(),
		setProjectByLinearTeamId: vi.fn(),
		getOrgIdForProject: vi.fn(),
		setOrgIdForProject: vi.fn(),
		getProjectsByJiraKey: vi.fn(),
		setProjectsByJiraKey: vi.fn(),
		getPrimaryProjectByRepo: vi.fn(),
		setPrimaryProjectByRepo: vi.fn(),
		invalidate: vi.fn(),
	},
}));

import { configCache } from '../../../src/config/configCache.js';
import {
	findPrimaryProjectByRepo,
	findProjectIdByRepoPr,
	findProjectsByJiraProjectKey,
} from '../../../src/config/provider.js';
import {
	findPrimaryProjectByRepoFromDb,
	findProjectsByJiraProjectKeyFromDb,
} from '../../../src/db/repositories/configRepository.js';
import { findProjectIdByRepoPrFromDb } from '../../../src/db/repositories/prWorkItemsRepository.js';

const projectA = { id: 'be', name: 'BE' } as never;
const projectB = { id: 'fe', name: 'FE' } as never;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('findProjectsByJiraProjectKey', () => {
	it('returns every project sharing the board key', async () => {
		vi.mocked(configCache.getProjectsByJiraKey).mockReturnValue(null);
		vi.mocked(findProjectsByJiraProjectKeyFromDb).mockResolvedValue([projectA, projectB]);

		const result = await findProjectsByJiraProjectKey('CLFX');

		expect(result).toEqual([projectA, projectB]);
		expect(findProjectsByJiraProjectKeyFromDb).toHaveBeenCalledWith('CLFX');
	});

	it('caches the sibling list and short-circuits on a hit', async () => {
		vi.mocked(configCache.getProjectsByJiraKey).mockReturnValue(null);
		vi.mocked(findProjectsByJiraProjectKeyFromDb).mockResolvedValue([projectA]);
		await findProjectsByJiraProjectKey('CLFX');
		expect(configCache.setProjectsByJiraKey).toHaveBeenCalledWith('CLFX', [projectA]);

		vi.mocked(configCache.getProjectsByJiraKey).mockReturnValue([projectA, projectB]);
		const cached = await findProjectsByJiraProjectKey('CLFX');

		expect(cached).toEqual([projectA, projectB]);
		expect(findProjectsByJiraProjectKeyFromDb).toHaveBeenCalledTimes(1);
	});

	it('returns an empty list when no project holds the key', async () => {
		vi.mocked(configCache.getProjectsByJiraKey).mockReturnValue(null);
		vi.mocked(findProjectsByJiraProjectKeyFromDb).mockResolvedValue([]);

		expect(await findProjectsByJiraProjectKey('NOPE')).toEqual([]);
	});
});

describe('findPrimaryProjectByRepo', () => {
	it('returns the primary sibling for a shared repository', async () => {
		vi.mocked(configCache.getPrimaryProjectByRepo).mockReturnValue(null);
		vi.mocked(findPrimaryProjectByRepoFromDb).mockResolvedValue(projectA);

		const result = await findPrimaryProjectByRepo('acme/web');

		expect(result).toBe(projectA);
		expect(findPrimaryProjectByRepoFromDb).toHaveBeenCalledWith('acme/web');
		expect(configCache.setPrimaryProjectByRepo).toHaveBeenCalledWith('acme/web', projectA);
	});

	it('caches a miss so an unknown repository is not re-queried', async () => {
		vi.mocked(configCache.getPrimaryProjectByRepo).mockReturnValue(null);
		vi.mocked(findPrimaryProjectByRepoFromDb).mockResolvedValue(undefined);

		expect(await findPrimaryProjectByRepo('acme/unknown')).toBeUndefined();
		expect(configCache.setPrimaryProjectByRepo).toHaveBeenCalledWith('acme/unknown', undefined);
	});
});

describe('findProjectIdByRepoPr', () => {
	it('returns the project that owns the PR', async () => {
		vi.mocked(findProjectIdByRepoPrFromDb).mockResolvedValue('be');

		expect(await findProjectIdByRepoPr('acme/web', 42)).toBe('be');
		expect(findProjectIdByRepoPrFromDb).toHaveBeenCalledWith('acme/web', 42);
	});

	it('returns null for a PR with no link', async () => {
		vi.mocked(findProjectIdByRepoPrFromDb).mockResolvedValue(null);

		expect(await findProjectIdByRepoPr('acme/web', 99)).toBeNull();
	});

	it('is never cached — a PR gains its link mid-life', async () => {
		vi.mocked(findProjectIdByRepoPrFromDb).mockResolvedValueOnce(null).mockResolvedValueOnce('be');

		expect(await findProjectIdByRepoPr('acme/web', 7)).toBeNull();
		expect(await findProjectIdByRepoPr('acme/web', 7)).toBe('be');
		expect(findProjectIdByRepoPrFromDb).toHaveBeenCalledTimes(2);
	});
});

describe('configCache topology entries', () => {
	it('clears the shared-topology caches on invalidate', async () => {
		// A stale sibling list would route events using retired configuration —
		// the exact silent-misrouting class spec 024 exists to remove. Uses the
		// real cache (not the module mock) to pin invalidate()'s coverage.
		const { configCache: cache } = await vi.importActual<
			typeof import('../../../src/config/configCache.js')
		>('../../../src/config/configCache.js');

		cache.setProjectsByJiraKey('CLFX', [projectA, projectB]);
		cache.setPrimaryProjectByRepo('acme/web', projectA);
		expect(cache.getProjectsByJiraKey('CLFX')).toHaveLength(2);
		expect(cache.getPrimaryProjectByRepo('acme/web')).toBe(projectA);

		cache.invalidate();

		expect(cache.getProjectsByJiraKey('CLFX')).toBeNull();
		expect(cache.getPrimaryProjectByRepo('acme/web')).toBeNull();
	});
});
