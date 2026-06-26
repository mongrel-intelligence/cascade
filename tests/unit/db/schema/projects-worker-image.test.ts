import { describe, expect, it } from 'vitest';

import { projects } from '../../../../src/db/schema/projects.js';

/**
 * Spec 022 plan 1/4 — per-project worker image.
 *
 * Pins the four nullable worker-image columns on the Drizzle `projects` table.
 * The columns ship dormant (nothing resolves/launches against them yet); this
 * test only asserts the schema exposes them with the expected snake_case SQL
 * names so the migration, configMapper, and repository stay in lockstep.
 */
describe('projects schema — worker-image columns', () => {
	it('projects schema exposes the four columns with snake_case names', () => {
		expect(projects.workerImage.name).toBe('worker_image');
		expect(projects.workerImageDigest.name).toBe('worker_image_digest');
		expect(projects.workerImageStatus.name).toBe('worker_image_status');
		expect(projects.workerImageError.name).toBe('worker_image_error');
	});
});
