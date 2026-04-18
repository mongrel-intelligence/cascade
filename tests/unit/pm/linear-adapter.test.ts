/**
 * LinearPMProvider — unit tests for project-scope propagation.
 *
 * Verifies listWorkItems, createWorkItem, and addChecklistItem honor
 * LinearConfig.projectId when set, and preserve current behavior when not.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { linearClient } from '../../../src/linear/client.js';
import type { LinearConfig } from '../../../src/pm/config.js';
import { LinearPMProvider } from '../../../src/pm/linear/adapter.js';

const ISSUE = {
	id: 'i1',
	identifier: 'TEAM-1',
	title: 't',
	description: '',
	url: 'https://linear.app/x/issue/TEAM-1',
	state: { id: 's', name: 'Todo', type: 'unstarted', color: '#fff' },
	labels: [],
	team: { id: 'T1', key: 'TEAM', name: 'Team' },
	assignee: null,
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-01T00:00:00Z',
};

function configOf(overrides: Partial<LinearConfig> = {}): LinearConfig {
	return {
		teamId: 'T1',
		statuses: {},
		...overrides,
	};
}

describe('LinearPMProvider.listWorkItems — project scope', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('passes projectId to linearClient.listIssues when configured', async () => {
		const spy = vi.spyOn(linearClient, 'listIssues').mockResolvedValue([]);
		const provider = new LinearPMProvider(configOf({ projectId: 'P1' }));
		await provider.listWorkItems('T1');
		expect(spy).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'T1', projectId: 'P1' }));
	});

	it('omits projectId when not configured', async () => {
		const spy = vi.spyOn(linearClient, 'listIssues').mockResolvedValue([]);
		const provider = new LinearPMProvider(configOf());
		await provider.listWorkItems('T1');
		const call = spy.mock.calls[0][0] ?? {};
		expect(call).not.toHaveProperty('projectId');
		expect(call).toMatchObject({ teamId: 'T1' });
	});

	it('passes projectId alongside status filter when both are configured', async () => {
		const spy = vi.spyOn(linearClient, 'listIssues').mockResolvedValue([]);
		const provider = new LinearPMProvider(
			configOf({ projectId: 'P1', statuses: { backlog: 'S-BL' } }),
		);
		await provider.listWorkItems('T1', { status: 'backlog' });
		expect(spy).toHaveBeenCalledWith(
			expect.objectContaining({ teamId: 'T1', projectId: 'P1', stateId: 'S-BL' }),
		);
	});
});

describe('LinearPMProvider.listWorkItems — self-resolution from config', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('uses config.teamId when containerId is omitted', async () => {
		const spy = vi.spyOn(linearClient, 'listIssues').mockResolvedValue([]);
		const provider = new LinearPMProvider(
			configOf({ teamId: 'T-from-config', statuses: { backlog: 'S-BL' } }),
		);
		await provider.listWorkItems(undefined, { status: 'backlog' });
		expect(spy).toHaveBeenCalledWith(
			expect.objectContaining({ teamId: 'T-from-config', stateId: 'S-BL' }),
		);
	});

	it('uses config.teamId AND config.projectId AND status filter when all set, no containerId', async () => {
		const spy = vi.spyOn(linearClient, 'listIssues').mockResolvedValue([]);
		const provider = new LinearPMProvider(
			configOf({ teamId: 'T1', projectId: 'P1', statuses: { todo: 'S-TODO' } }),
		);
		await provider.listWorkItems(undefined, { status: 'todo' });
		expect(spy).toHaveBeenCalledWith(
			expect.objectContaining({ teamId: 'T1', projectId: 'P1', stateId: 'S-TODO' }),
		);
	});

	it('returns [] when neither containerId nor config.teamId is set', async () => {
		const spy = vi.spyOn(linearClient, 'listIssues').mockResolvedValue([]);
		const provider = new LinearPMProvider(configOf({ teamId: '' }));
		const result = await provider.listWorkItems(undefined, { status: 'backlog' });
		expect(result).toEqual([]);
		expect(spy).not.toHaveBeenCalled();
	});
});

describe('LinearPMProvider.createWorkItem — project scope', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('sets projectId on new issue when configured', async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const spy = vi.spyOn(linearClient, 'createIssue').mockResolvedValue(ISSUE as any);
		const provider = new LinearPMProvider(configOf({ projectId: 'P1' }));
		await provider.createWorkItem({ title: 'x' });
		expect(spy).toHaveBeenCalledWith(
			expect.objectContaining({ teamId: 'T1', projectId: 'P1', title: 'x' }),
		);
	});

	it('omits projectId on new issue when not configured', async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const spy = vi.spyOn(linearClient, 'createIssue').mockResolvedValue(ISSUE as any);
		const provider = new LinearPMProvider(configOf());
		await provider.createWorkItem({ title: 'x' });
		const call = spy.mock.calls[0][0];
		expect(call).not.toHaveProperty('projectId');
	});
});

// Note: addChecklistItem no longer creates sub-issues (spec 008 — inline markdown).
// projectId propagation for createWorkItem is covered by tests above.
