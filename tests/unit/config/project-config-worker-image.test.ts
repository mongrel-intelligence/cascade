import { describe, expect, it } from 'vitest';

import { ProjectConfigSchema } from '../../../src/config/schema.js';

/**
 * Spec 022 plan 1/4 — per-project worker image.
 *
 * Pins the four optional worker-image fields on `ProjectConfigSchema`:
 *   - workerImage / workerImageDigest / workerImageError → optional strings
 *   - workerImageStatus → optional enum (pending | verified | failed)
 *
 * They must stay OPTIONAL with NO `.default()` so an unconfigured project parses
 * to `undefined` for all four (mirroring watchdogTimeoutMs / snapshotEnabled).
 */

const baseConfig = {
	id: 'p1',
	orgId: 'org-1',
	name: 'Test Project',
	repo: 'owner/repo',
};

describe('ProjectConfigSchema — worker-image fields', () => {
	it('parses worker-image fields when present', () => {
		const result = ProjectConfigSchema.parse({
			...baseConfig,
			workerImage: 'ghcr.io/acme/cascade-worker:latest',
			workerImageDigest: 'ghcr.io/acme/cascade-worker@sha256:abcdef',
			workerImageStatus: 'verified',
			workerImageError: 'previous pull failed',
		});

		expect(result.workerImage).toBe('ghcr.io/acme/cascade-worker:latest');
		expect(result.workerImageDigest).toBe('ghcr.io/acme/cascade-worker@sha256:abcdef');
		expect(result.workerImageStatus).toBe('verified');
		expect(result.workerImageError).toBe('previous pull failed');
	});

	it('omits fields when absent (no default injected)', () => {
		const result = ProjectConfigSchema.parse(baseConfig);

		expect(result.workerImage).toBeUndefined();
		expect(result.workerImageDigest).toBeUndefined();
		expect(result.workerImageStatus).toBeUndefined();
		expect(result.workerImageError).toBeUndefined();
	});

	it('workerImageStatus only accepts pending|verified|failed', () => {
		for (const status of ['pending', 'verified', 'failed'] as const) {
			const result = ProjectConfigSchema.parse({ ...baseConfig, workerImageStatus: status });
			expect(result.workerImageStatus).toBe(status);
		}

		expect(() =>
			ProjectConfigSchema.parse({ ...baseConfig, workerImageStatus: 'bogus' }),
		).toThrow();
	});
});
