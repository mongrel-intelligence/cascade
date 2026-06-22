import { describe, expect, it } from 'vitest';
import { NO_PM_PROVIDER } from '../../../src/pm/no-pm-provider.js';
import { pmRegistry } from '../../../src/pm/registry.js';
import { createMockGitHubOnlyProject } from '../../helpers/factories.js';

describe('SCM-only projects (no PM provider)', () => {
	it('pmRegistry.createProvider returns NO_PM_PROVIDER when project.pm is undefined', () => {
		expect(pmRegistry.createProvider(createMockGitHubOnlyProject())).toBe(NO_PM_PROVIDER);
	});

	it('pmRegistry.resolveLifecycleConfig returns an empty config when project.pm is undefined', () => {
		expect(pmRegistry.resolveLifecycleConfig(createMockGitHubOnlyProject())).toEqual({
			labels: {},
			statuses: {},
		});
	});

	it('NO_PM_PROVIDER reports type "none"', () => {
		expect(NO_PM_PROVIDER.type).toBe('none');
	});

	it('NO_PM_PROVIDER PM operations throw a clear error', async () => {
		await expect(NO_PM_PROVIDER.createWorkItem({ containerId: 'x', title: 't' })).rejects.toThrow(
			/no PM provider/i,
		);
		await expect(NO_PM_PROVIDER.moveWorkItem('1', 'dest')).rejects.toThrow(/no PM provider/i);
		await expect(NO_PM_PROVIDER.getWorkItem('1')).rejects.toThrow(/no PM provider/i);
	});
});
