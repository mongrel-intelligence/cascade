import { describe, expect, it } from 'vitest';

import {
	ProjectConfigSchema,
	WorkerImageBuildStatusSchema,
	WorkerImageSourceSchema,
	WorkerImageStatusSchema,
} from '../../../src/config/schema.js';

/**
 * Spec 023 plan 1/5 — per-project worker Dockerfile (dormant).
 *
 * Pins the config-schema surface for the new plumbing:
 *   - WorkerImageStatusSchema widens to admit `building`.
 *   - WorkerImageBuildStatusSchema = building | failed.
 *   - WorkerImageSourceSchema = default | reference | dockerfile.
 *   - ProjectConfig exposes workerDockerfile / workerImageBuildHash /
 *     workerImageBuildStatus + the derived workerImageSource, all OPTIONAL with
 *     NO `.default()` so an unconfigured project parses to `undefined`.
 */

const baseConfig = {
	id: 'p1',
	orgId: 'org-1',
	name: 'Test Project',
	repo: 'owner/repo',
};

describe('WorkerImageStatusSchema — building widening', () => {
	it('accepts building alongside pending|verified|failed', () => {
		for (const status of ['pending', 'building', 'verified', 'failed'] as const) {
			expect(WorkerImageStatusSchema.parse(status)).toBe(status);
		}
	});

	it('ProjectConfig accepts workerImageStatus=building', () => {
		const result = ProjectConfigSchema.parse({ ...baseConfig, workerImageStatus: 'building' });
		expect(result.workerImageStatus).toBe('building');
	});
});

describe('WorkerImageBuildStatusSchema', () => {
	it('accepts building and failed only', () => {
		expect(WorkerImageBuildStatusSchema.parse('building')).toBe('building');
		expect(WorkerImageBuildStatusSchema.parse('failed')).toBe('failed');
	});

	it('rejects the runnable-image lifecycle values and bogus values', () => {
		for (const bad of ['pending', 'verified', 'idle', 'bogus']) {
			expect(() => WorkerImageBuildStatusSchema.parse(bad)).toThrow();
		}
	});
});

describe('WorkerImageSourceSchema', () => {
	it('accepts default|reference|dockerfile', () => {
		for (const source of ['default', 'reference', 'dockerfile'] as const) {
			expect(WorkerImageSourceSchema.parse(source)).toBe(source);
		}
	});

	it('rejects unknown sources', () => {
		expect(() => WorkerImageSourceSchema.parse('built')).toThrow();
	});
});

describe('ProjectConfigSchema — worker-dockerfile fields', () => {
	it('parses all fields when present', () => {
		const result = ProjectConfigSchema.parse({
			...baseConfig,
			workerDockerfile: 'RUN apt-get install -y jq\nENV FOO=bar',
			workerImageBuildHash: 'sha256-of-desired-content',
			workerImageBuildStatus: 'building',
			workerImageSource: 'dockerfile',
		});

		expect(result.workerDockerfile).toBe('RUN apt-get install -y jq\nENV FOO=bar');
		expect(result.workerImageBuildHash).toBe('sha256-of-desired-content');
		expect(result.workerImageBuildStatus).toBe('building');
		expect(result.workerImageSource).toBe('dockerfile');
	});

	it('omits fields when absent (no default injected)', () => {
		const result = ProjectConfigSchema.parse(baseConfig);

		expect(result.workerDockerfile).toBeUndefined();
		expect(result.workerImageBuildHash).toBeUndefined();
		expect(result.workerImageBuildStatus).toBeUndefined();
		expect(result.workerImageSource).toBeUndefined();
	});

	it('rejects an invalid workerImageBuildStatus', () => {
		expect(() =>
			ProjectConfigSchema.parse({ ...baseConfig, workerImageBuildStatus: 'verified' }),
		).toThrow();
	});

	it('rejects an invalid workerImageSource', () => {
		expect(() => ProjectConfigSchema.parse({ ...baseConfig, workerImageSource: 'nope' })).toThrow();
	});
});
