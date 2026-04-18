/**
 * Linear manifest discovery (plan 009/4 task 2).
 *
 * Declares `discoveryCapabilities: { teams, states, labels, projects }`
 * and wires `createDiscoveryProvider` to return a PMProvider whose
 * `discover(capability, args)` method delegates to the existing Linear
 * GraphQL client. Credentials are bound via `withLinearCredentials`.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/linear/client.js', () => {
	const fakeTeams = [
		{ id: 'team-1', name: 'Engineering', key: 'ENG' },
		{ id: 'team-2', name: 'Design', key: 'DES' },
	];
	const fakeStates = [
		{ id: 'state-triage', name: 'Triage', type: 'triage' },
		{ id: 'state-backlog', name: 'Backlog', type: 'backlog' },
		{ id: 'state-in-progress', name: 'In Progress', type: 'started' },
		{ id: 'state-done', name: 'Done', type: 'completed' },
		{ id: 'state-canceled', name: 'Canceled', type: 'canceled' },
	];
	const fakeLabels = [
		{ id: 'label-1', name: 'bug', color: '#ff0000' },
		{ id: 'label-2', name: 'feature', color: '#00ff00' },
	];
	const fakeProjects = [
		{ id: 'project-1', name: 'Q1 Roadmap', icon: null, color: null },
		{ id: 'project-2', name: 'Q2 Roadmap', icon: null, color: null },
	];
	return {
		withLinearCredentials: vi.fn(async (_creds: unknown, fn: () => unknown) => fn()),
		linearClient: {
			getTeams: vi.fn(async () => fakeTeams),
			getTeamWorkflowStates: vi.fn(async () => fakeStates),
			getTeamLabels: vi.fn(async () => fakeLabels),
			getTeamProjects: vi.fn(async () => fakeProjects),
			getMe: vi.fn(async () => ({
				id: 'linear-user-123',
				name: 'Linear User',
				displayName: 'linearuser',
			})),
		},
	};
});

import { linearManifest } from '../../../../src/integrations/pm/linear/manifest.js';

describe('linearManifest.discoveryCapabilities', () => {
	it('declares teams, states, labels, projects, currentUser', () => {
		const caps = linearManifest.discoveryCapabilities;
		expect(caps?.teams).toBe(true);
		expect(caps?.states).toBe(true);
		expect(caps?.labels).toBe(true);
		expect(caps?.projects).toBe(true);
		expect(caps?.currentUser).toBe(true);
	});

	it('declares createDiscoveryProvider factory', () => {
		expect(typeof linearManifest.createDiscoveryProvider).toBe('function');
	});
});

describe('linearManifest.discover', () => {
	function makeProvider() {
		if (!linearManifest.createDiscoveryProvider) {
			throw new Error('createDiscoveryProvider missing on linearManifest');
		}
		return linearManifest.createDiscoveryProvider({
			credentials: { api_key: 'lin_api_test' },
		});
	}

	it('discover("teams") returns { id, name }[]', async () => {
		const result = await makeProvider().discover?.('teams', {});
		expect(Array.isArray(result)).toBe(true);
		expect(result?.length).toBe(2);
		expect(result?.[0]).toEqual(expect.objectContaining({ id: 'team-1', name: 'Engineering' }));
	});

	it('discover("states", {containerId: teamId}) maps Linear types → CASCADE categories', async () => {
		const result = await makeProvider().discover?.('states', {
			containerId: 'team-1' as never,
		});
		expect(Array.isArray(result)).toBe(true);
		const byName = Object.fromEntries(
			(result ?? []).map((s) => [
				(s as { name: string }).name,
				(s as { category: string }).category,
			]),
		);
		expect(byName.Triage).toBe('todo');
		expect(byName.Backlog).toBe('todo');
		expect(byName['In Progress']).toBe('in_progress');
		expect(byName.Done).toBe('done');
		expect(byName.Canceled).toBe('canceled');
	});

	it('discover("labels", {containerId: teamId}) returns { id, name, color? }[]', async () => {
		const result = await makeProvider().discover?.('labels', {
			containerId: 'team-1' as never,
		});
		expect(Array.isArray(result)).toBe(true);
		expect(result?.length).toBe(2);
		expect(result?.[0]).toEqual(
			expect.objectContaining({ id: 'label-1', name: 'bug', color: '#ff0000' }),
		);
	});

	it('discover("projects", {containerId: teamId}) returns { id, name }[]', async () => {
		const result = await makeProvider().discover?.('projects', {
			containerId: 'team-1' as never,
		});
		expect(Array.isArray(result)).toBe(true);
		expect(result?.length).toBe(2);
	});

	it('discover("projects") with no containerId returns empty (team must be chosen first)', async () => {
		const result = await makeProvider().discover?.('projects', {});
		expect(result).toEqual([]);
	});

	it('discover("currentUser") returns { id, name, displayName } (plan 010/2)', async () => {
		const result = await makeProvider().discover?.('currentUser', {});
		expect(result).toEqual({
			id: 'linear-user-123',
			name: 'Linear User',
			displayName: 'linearuser',
		});
	});
});
