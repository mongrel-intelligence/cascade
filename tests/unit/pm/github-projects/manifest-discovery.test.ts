/**
 * GitHub Projects manifest discovery.
 *
 * The manifest must declare `states` (the wizard's status-mapping step queries
 * capability 'states'; the generic pm.discovery endpoint rejects undeclared
 * capabilities) and must NOT declare the dead `containers` capability.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/github-projects/client.js', () => {
	const fakeUserProjects = [
		{
			id: 'PVT_1',
			number: 1,
			title: 'My Project',
			url: 'https://github.com/users/octocat/projects/1',
		},
	];
	const fakeOrgProjects = [
		{
			id: 'PVT_org',
			number: 2,
			title: 'Org Project',
			url: 'https://github.com/orgs/acme/projects/2',
		},
	];
	return {
		withGitHubProjectsCredentials: vi.fn(async (_creds, fn) => fn()),
		getUserProjects: vi.fn(async () => fakeUserProjects),
		getOrganizationProjects: vi.fn(async () => fakeOrgProjects),
		getStatusField: vi.fn(async () => ({
			id: 'PVTSSF_status',
			options: [
				{ id: 'opt-todo', name: 'Todo' },
				{ id: 'opt-inprogress', name: 'In Progress' },
				{ id: 'opt-done', name: 'Done' },
			],
		})),
		getViewer: vi.fn(async () => ({ id: 'U_1', login: 'octocat', name: 'The Octocat' })),
	};
});

import { githubProjectsManifest } from '../../../../src/integrations/pm/github-projects/manifest.js';

describe('githubProjectsManifest.discoveryCapabilities', () => {
	it('declares projects, states, currentUser', () => {
		const caps = githubProjectsManifest.discoveryCapabilities;
		expect(caps?.projects).toBe(true);
		expect(caps?.states).toBe(true);
		expect(caps?.currentUser).toBe(true);
	});

	it('does not declare the dead containers capability', () => {
		expect(githubProjectsManifest.discoveryCapabilities?.containers).toBeUndefined();
	});

	it('declares a createDiscoveryProvider factory', () => {
		expect(typeof githubProjectsManifest.createDiscoveryProvider).toBe('function');
	});
});

describe('githubProjectsManifest.discover via createDiscoveryProvider', () => {
	function makeProvider() {
		if (!githubProjectsManifest.createDiscoveryProvider) {
			throw new Error('createDiscoveryProvider missing');
		}
		return githubProjectsManifest.createDiscoveryProvider({ credentials: { token: 'ghp_x' } });
	}

	it('discover("projects", {containerId: "octocat:user"}) returns user projects', async () => {
		const result = await makeProvider().discover?.('projects', {
			containerId: 'octocat:user',
		} as never);
		expect(result).toEqual([expect.objectContaining({ id: 'PVT_1', name: 'My Project' })]);
	});

	it('discover("projects", {containerId: "acme:organization"}) returns org projects', async () => {
		const result = await makeProvider().discover?.('projects', {
			containerId: 'acme:organization',
		} as never);
		expect(result).toEqual([expect.objectContaining({ id: 'PVT_org', name: 'Org Project' })]);
	});

	it('discover("states", {containerId: projectId}) returns Status options with categories', async () => {
		const result = (await makeProvider().discover?.('states', {
			containerId: 'PVT_1',
		} as never)) as Array<{ id: string; name: string; category: string }>;

		expect(result).toHaveLength(3);
		expect(result[0]).toEqual(
			expect.objectContaining({ id: 'opt-todo', name: 'Todo', category: 'todo' }),
		);
		expect(result[1]).toEqual(
			expect.objectContaining({
				id: 'opt-inprogress',
				name: 'In Progress',
				category: 'in_progress',
			}),
		);
		expect(result[2]).toEqual(
			expect.objectContaining({ id: 'opt-done', name: 'Done', category: 'done' }),
		);
	});

	it('discover("currentUser") returns { id, name, displayName }', async () => {
		const result = await makeProvider().discover?.('currentUser', {} as never);
		expect(result).toEqual({ id: 'U_1', name: 'The Octocat', displayName: 'The Octocat' });
	});

	it('discover("containers") throws (capability removed)', async () => {
		await expect(makeProvider().discover?.('containers', {} as never)).rejects.toThrow(
			/does not support discovery capability/,
		);
	});
});
