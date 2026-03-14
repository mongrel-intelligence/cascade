import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configCache } from '../../../src/config/configCache.js';

describe('configCache', () => {
	beforeEach(() => {
		configCache.invalidate();
	});

	afterEach(() => {
		configCache.invalidate();
	});

	describe('orgIdByProject', () => {
		it('returns null when no cached org ID', () => {
			expect(configCache.getOrgIdForProject('project1')).toBeNull();
		});

		it('caches and retrieves org ID', () => {
			configCache.setOrgIdForProject('project1', 'acme-corp');
			expect(configCache.getOrgIdForProject('project1')).toBe('acme-corp');
		});

		it('caches different org IDs per project', () => {
			configCache.setOrgIdForProject('project1', 'acme-corp');
			configCache.setOrgIdForProject('project2', 'other-org');

			expect(configCache.getOrgIdForProject('project1')).toBe('acme-corp');
			expect(configCache.getOrgIdForProject('project2')).toBe('other-org');
		});

		it('is cleared by invalidate()', () => {
			configCache.setOrgIdForProject('project1', 'acme-corp');
			configCache.invalidate();
			expect(configCache.getOrgIdForProject('project1')).toBeNull();
		});

		it('expires after TTL', () => {
			vi.useFakeTimers();
			try {
				configCache.setOrgIdForProject('project1', 'acme-corp');
				expect(configCache.getOrgIdForProject('project1')).toBe('acme-corp');

				// Advance past the default 60s TTL
				vi.advanceTimersByTime(61_000);
				expect(configCache.getOrgIdForProject('project1')).toBeNull();
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe('config cache', () => {
		it('returns null when no cached config', () => {
			expect(configCache.getConfig()).toBeNull();
		});

		it('is cleared by invalidate()', () => {
			const config = {
				projects: [] as never,
			};
			configCache.setConfig(config);
			expect(configCache.getConfig()).toBe(config);
			configCache.invalidate();
			expect(configCache.getConfig()).toBeNull();
		});
	});

	describe('project lookups', () => {
		it('clears projectByBoardId on invalidate', () => {
			configCache.setProjectByBoardId('board1', undefined);
			configCache.invalidate();
			expect(configCache.getProjectByBoardId('board1')).toBeNull();
		});

		it('clears projectByRepo on invalidate', () => {
			configCache.setProjectByRepo('owner/repo', undefined);
			configCache.invalidate();
			expect(configCache.getProjectByRepo('owner/repo')).toBeNull();
		});
	});
});
