/**
 * LinearIntegration.resolveLifecycleConfig — unit tests.
 *
 * Verifies the normalized ProjectPMConfig produced from a project's Linear
 * config passes through every configured Linear status mapping, including
 * custom workflow status keys.
 */

import { describe, expect, it } from 'vitest';
import { getLinearConfig } from '../../../src/pm/config.js';
import { LinearIntegration } from '../../../src/pm/linear/integration.js';
import type { ProjectConfig } from '../../../src/types/index.js';

function makeProject(
	statuses: Record<string, string>,
	overrides?: { projectId?: string },
): ProjectConfig {
	return {
		id: 'test',
		name: 'test',
		repo: 'owner/repo',
		pm: { type: 'linear' },
		linear: {
			teamId: 'team-1',
			statuses,
			...(overrides?.projectId !== undefined ? { projectId: overrides.projectId } : {}),
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

	it('preserves custom workflow status keys for lifecycle moves', () => {
		const project = makeProject({
			prd: 's-prd',
			story: 's-story',
			'phased-plan': 's-phased-plan',
			inProgress: 's-ip',
		});
		const cfg = integration.resolveLifecycleConfig(project);

		expect(cfg.statuses.prd).toBe('s-prd');
		expect(cfg.statuses.story).toBe('s-story');
		expect(cfg.statuses['phased-plan']).toBe('s-phased-plan');
		expect(cfg.statuses.inProgress).toBe('s-ip');
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

	it('preserves arbitrary configured Linear status keys', () => {
		const project = makeProject({ debug: 's-dbg', inProgress: 's-ip' });
		const cfg = integration.resolveLifecycleConfig(project);
		expect(cfg.statuses.debug).toBe('s-dbg');
		expect(cfg.statuses.inProgress).toBe('s-ip');
	});
});

describe('LinearConfig.projectId', () => {
	it('getLinearConfig — returns config with projectId when set', () => {
		const project = makeProject({ inProgress: 's-ip' }, { projectId: 'P1' });
		expect(getLinearConfig(project)?.projectId).toBe('P1');
	});

	it('getLinearConfig — returns config without projectId when absent', () => {
		const project = makeProject({ inProgress: 's-ip' });
		expect(getLinearConfig(project)?.projectId).toBeUndefined();
	});

	it('LinearIntegration.createProvider — forwards projectId from LinearConfig to LinearPMProvider', () => {
		const integration = new LinearIntegration();
		const project = makeProject({ inProgress: 's-ip' }, { projectId: 'P1' });
		const provider = integration.createProvider(project) as unknown as {
			config: { projectId?: string };
		};
		expect(provider.config.projectId).toBe('P1');
	});

	it('LinearIntegration.createProvider — provider has undefined projectId when config has none', () => {
		const integration = new LinearIntegration();
		const project = makeProject({ inProgress: 's-ip' });
		const provider = integration.createProvider(project) as unknown as {
			config: { projectId?: string };
		};
		expect(provider.config.projectId).toBeUndefined();
	});
});
