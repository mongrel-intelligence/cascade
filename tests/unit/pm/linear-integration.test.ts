/**
 * LinearIntegration.resolveLifecycleConfig — unit tests.
 *
 * Verifies the normalized ProjectPMConfig produced from a project's Linear
 * config passes through all 8 CASCADE stages Linear operators can map
 * (backlog, splitting, planning, todo, inProgress, inReview, done, merged).
 */

import { describe, expect, it } from 'vitest';
import { LinearIntegration } from '../../../src/pm/linear/integration.js';
import type { ProjectConfig } from '../../../src/types/index.js';

function makeProject(statuses: Record<string, string>): ProjectConfig {
	return {
		id: 'test',
		name: 'test',
		repo: 'owner/repo',
		pm: { type: 'linear' },
		linear: {
			teamId: 'team-1',
			statuses,
		},
	} as unknown as ProjectConfig;
}

describe('LinearIntegration.resolveLifecycleConfig', () => {
	const integration = new LinearIntegration();

	it('returns all 8 status keys from pm.config.statuses', () => {
		const project = makeProject({
			backlog: 's-bl',
			splitting: 's-sp',
			planning: 's-pl',
			todo: 's-td',
			inProgress: 's-ip',
			inReview: 's-ir',
			done: 's-dn',
			merged: 's-mg',
		});
		const cfg = integration.resolveLifecycleConfig(project);
		expect(cfg.statuses.backlog).toBe('s-bl');
		expect(cfg.statuses.splitting).toBe('s-sp');
		expect(cfg.statuses.planning).toBe('s-pl');
		expect(cfg.statuses.todo).toBe('s-td');
		expect(cfg.statuses.inProgress).toBe('s-ip');
		expect(cfg.statuses.inReview).toBe('s-ir');
		expect(cfg.statuses.done).toBe('s-dn');
		expect(cfg.statuses.merged).toBe('s-mg');
	});

	it('preserves undefined for keys not provided in the project config', () => {
		const project = makeProject({ inProgress: 's-ip' });
		const cfg = integration.resolveLifecycleConfig(project);
		expect(cfg.statuses.inProgress).toBe('s-ip');
		expect(cfg.statuses.backlog).toBeUndefined();
		expect(cfg.statuses.splitting).toBeUndefined();
		expect(cfg.statuses.planning).toBeUndefined();
		expect(cfg.statuses.todo).toBeUndefined();
		expect(cfg.statuses.inReview).toBeUndefined();
		expect(cfg.statuses.done).toBeUndefined();
		expect(cfg.statuses.merged).toBeUndefined();
	});

	it('does not surface debug from Linear config (Linear has no debug slot)', () => {
		const project = makeProject({ debug: 's-dbg', inProgress: 's-ip' });
		const cfg = integration.resolveLifecycleConfig(project);
		expect(cfg.statuses.debug).toBeUndefined();
		expect(cfg.statuses.inProgress).toBe('s-ip');
	});
});
