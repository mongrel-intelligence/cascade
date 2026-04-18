/**
 * JIRA manifest discovery (plan 009/3 task 2).
 *
 * Declares `discoveryCapabilities: { projects, states, labels, customFields }`
 * and wires `createDiscoveryProvider` to return a PMProvider whose
 * `discover(capability, args)` method serves each capability via the
 * existing jiraClient. Credentials scope is established via
 * `withJiraCredentials` so the singleton client doesn't need per-call
 * credential threading.
 *
 * NOTE: JIRA labels are free-form strings that JIRA auto-creates on
 * first use; there's no canonical "list labels on a project" endpoint.
 * discover('labels') returns [] — the provider declares the capability
 * so the wizard surface is uniform, but the wizard's label-mapping UI
 * is expected to accept free text for JIRA.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/jira/client.js', () => {
	const fakeProjects = [
		{ key: 'CASC', name: 'Cascade Dev' },
		{ key: 'OPS', name: 'Operations' },
	];
	const fakeStatuses = [
		{ id: '10000', name: 'To Do' },
		{ id: '10001', name: 'In Progress' },
		{ id: '10002', name: 'Done' },
	];
	const fakeFields = [
		{ id: 'customfield_10100', name: 'Cost', custom: true },
		{ id: 'customfield_10200', name: 'Epic Link', custom: true },
		{ id: 'summary', name: 'Summary', custom: false },
	];

	return {
		withJiraCredentials: vi.fn(async (_creds, fn) => fn()),
		jiraClient: {
			searchProjects: vi.fn(async () => fakeProjects),
			getProjectStatuses: vi.fn(async () => fakeStatuses),
			getFields: vi.fn(async () => fakeFields),
			getMyself: vi.fn(async () => ({
				accountId: 'jira-acct-xyz',
				displayName: 'JIRA User',
				emailAddress: 'jira@example.com',
			})),
		},
	};
});

import { jiraManifest } from '../../../../src/integrations/pm/jira/manifest.js';

describe('jiraManifest.discoveryCapabilities', () => {
	it('declares projects, states, labels, customFields, currentUser', () => {
		const caps = jiraManifest.discoveryCapabilities;
		expect(caps?.projects).toBe(true);
		expect(caps?.states).toBe(true);
		expect(caps?.labels).toBe(true);
		expect(caps?.customFields).toBe(true);
		expect(caps?.currentUser).toBe(true);
	});

	it('declares createDiscoveryProvider factory', () => {
		expect(typeof jiraManifest.createDiscoveryProvider).toBe('function');
	});
});

describe('jiraManifest.discover via createDiscoveryProvider', () => {
	function makeProvider() {
		if (!jiraManifest.createDiscoveryProvider) {
			throw new Error('createDiscoveryProvider missing on jiraManifest');
		}
		return jiraManifest.createDiscoveryProvider({
			credentials: {
				email: 'user@example.com',
				api_token: 'tok',
				// Base URL is a project-scoped config, not a credential — but
				// the factory accepts it here so discovery works before the
				// config is saved. Providers may also read from credentials
				// for backward compat during migration.
				base_url: 'https://example.atlassian.net',
			},
		});
	}

	it('discover("projects") returns { id, name }[] with ContainerId', async () => {
		const provider = makeProvider();
		const result = await provider.discover?.('projects', {});
		expect(Array.isArray(result)).toBe(true);
		expect(result?.length).toBe(2);
		expect(result?.[0]).toEqual(expect.objectContaining({ id: 'CASC', name: 'Cascade Dev' }));
	});

	it('discover("states", {containerId: projectKey}) returns StateId + category', async () => {
		const provider = makeProvider();
		const result = await provider.discover?.('states', { containerId: 'CASC' as never });
		expect(Array.isArray(result)).toBe(true);
		expect(result?.length).toBe(3);
		for (const s of result ?? []) {
			expect(['todo', 'in_progress', 'done', 'canceled', 'unknown']).toContain(
				(s as { category: string }).category,
			);
		}
	});

	it('discover("labels") returns empty array (JIRA has no curated labels endpoint)', async () => {
		const provider = makeProvider();
		const result = await provider.discover?.('labels', { containerId: 'CASC' as never });
		expect(Array.isArray(result)).toBe(true);
		expect(result?.length).toBe(0);
	});

	it('discover("customFields") returns only custom fields (not built-in like summary)', async () => {
		const provider = makeProvider();
		const result = await provider.discover?.('customFields', { containerId: 'CASC' as never });
		expect(Array.isArray(result)).toBe(true);
		expect(result?.length).toBe(2);
		const ids = (result ?? []).map((f) => (f as { id: string }).id);
		expect(ids).toContain('customfield_10100');
		expect(ids).toContain('customfield_10200');
		expect(ids).not.toContain('summary');
	});

	it('discover("currentUser") returns { id, name, displayName } mapped from getMyself (plan 010/2)', async () => {
		const provider = makeProvider();
		const result = await provider.discover?.('currentUser', {});
		expect(result).toEqual({
			id: 'jira-acct-xyz',
			name: 'JIRA User',
			displayName: 'jira@example.com',
		});
	});
});
