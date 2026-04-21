/**
 * linearClient — unit tests for project/team scoping in listIssues and createIssue.
 *
 * Stubs global fetch to capture outgoing GraphQL variables so we can assert
 * the shape of the filter and mutation inputs without hitting the real API.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { linearClient, withLinearCredentials } from '../../../src/linear/client.js';

interface CapturedRequest {
	url: string;
	body: { query: string; variables?: Record<string, unknown> };
}

function stubFetch(responseData: unknown): { calls: CapturedRequest[] } {
	const calls: CapturedRequest[] = [];
	const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		const body = JSON.parse(init?.body as string) as CapturedRequest['body'];
		calls.push({ url: String(url), body });
		return new Response(JSON.stringify({ data: responseData }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	});
	// biome-ignore lint/suspicious/noExplicitAny: test stub
	globalThis.fetch = fetchMock as any;
	return { calls };
}

const ISSUE_NODE = {
	id: 'i1',
	identifier: 'TEAM-1',
	title: 't',
	description: '',
	url: 'https://linear.app/x/issue/TEAM-1',
	state: { id: 's', name: 'Todo', type: 'unstarted', color: '#fff' },
	labels: { nodes: [] },
	team: { id: 'T1', key: 'TEAM', name: 'Team' },
	assignee: null,
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-01T00:00:00Z',
};

describe('linearClient.listIssues — project scoping', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('includes project.id.eq when projectId passed', async () => {
		const { calls } = stubFetch({ issues: { nodes: [ISSUE_NODE] } });
		await withLinearCredentials({ apiKey: 'k' }, () =>
			linearClient.listIssues({ teamId: 'T1', projectId: 'P1' }),
		);
		const vars = calls[0].body.variables as { filter: Record<string, unknown> };
		expect(vars.filter).toEqual(
			expect.objectContaining({
				team: { id: { eq: 'T1' } },
				project: { id: { eq: 'P1' } },
			}),
		);
	});

	it('omits project filter when projectId absent', async () => {
		const { calls } = stubFetch({ issues: { nodes: [] } });
		await withLinearCredentials({ apiKey: 'k' }, () => linearClient.listIssues({ teamId: 'T1' }));
		const vars = calls[0].body.variables as { filter: Record<string, unknown> };
		expect(vars.filter).toEqual({ team: { id: { eq: 'T1' } } });
		expect(vars.filter).not.toHaveProperty('project');
	});

	it('sends filter undefined when no filter keys supplied', async () => {
		const { calls } = stubFetch({ issues: { nodes: [] } });
		await withLinearCredentials({ apiKey: 'k' }, () => linearClient.listIssues({}));
		const vars = calls[0].body.variables as { filter: Record<string, unknown> | undefined };
		expect(vars.filter).toBeUndefined();
	});
});

describe('linearClient.createIssue — projectId passthrough', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('forwards projectId in mutation input when supplied', async () => {
		const { calls } = stubFetch({ issueCreate: { issue: ISSUE_NODE } });
		await withLinearCredentials({ apiKey: 'k' }, () =>
			linearClient.createIssue({ teamId: 'T1', projectId: 'P1', title: 't' }),
		);
		const vars = calls[0].body.variables as { input: Record<string, unknown> };
		expect(vars.input).toEqual(
			expect.objectContaining({
				teamId: 'T1',
				projectId: 'P1',
				title: 't',
			}),
		);
	});

	it('omits projectId when not supplied', async () => {
		const { calls } = stubFetch({ issueCreate: { issue: ISSUE_NODE } });
		await withLinearCredentials({ apiKey: 'k' }, () =>
			linearClient.createIssue({ teamId: 'T1', title: 't' }),
		);
		const vars = calls[0].body.variables as { input: Record<string, unknown> };
		expect(vars.input).not.toHaveProperty('projectId');
		expect(vars.input).toEqual(expect.objectContaining({ teamId: 'T1', title: 't' }));
	});
});

describe('linearClient.getIssueProjectId', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('returns issue project id', async () => {
		const { calls } = stubFetch({ issue: { project: { id: 'P1' } } });

		const projectId = await withLinearCredentials({ apiKey: 'k' }, () =>
			linearClient.getIssueProjectId('issue-1'),
		);

		expect(projectId).toBe('P1');
		expect(calls[0].body.query).toContain('query GetIssueProject');
		expect(calls[0].body.variables).toEqual({ id: 'issue-1' });
	});

	it('returns null when issue has no project', async () => {
		stubFetch({ issue: { project: null } });

		const projectId = await withLinearCredentials({ apiKey: 'k' }, () =>
			linearClient.getIssueProjectId('issue-1'),
		);

		expect(projectId).toBeNull();
	});
});

describe('linearClient.getTeamProjects', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('returns mapped projects', async () => {
		const { calls } = stubFetch({
			team: {
				projects: {
					nodes: [
						{ id: 'P1', name: 'Alpha', icon: 'rocket', color: '#ff0000' },
						{ id: 'P2', name: 'Beta', icon: null, color: null },
					],
				},
			},
		});
		const projects = await withLinearCredentials({ apiKey: 'k' }, () =>
			linearClient.getTeamProjects('T1'),
		);
		expect(projects).toEqual([
			{ id: 'P1', name: 'Alpha', icon: 'rocket', color: '#ff0000' },
			{ id: 'P2', name: 'Beta', icon: null, color: null },
		]);
		expect(calls[0].body.variables).toEqual({ id: 'T1', first: 250 });
	});

	it('returns empty array when team has no projects', async () => {
		stubFetch({ team: { projects: { nodes: [] } } });
		const projects = await withLinearCredentials({ apiKey: 'k' }, () =>
			linearClient.getTeamProjects('T1'),
		);
		expect(projects).toEqual([]);
	});

	it('sends teamId + default first=250 as GraphQL variables', async () => {
		const { calls } = stubFetch({ team: { projects: { nodes: [] } } });
		await withLinearCredentials({ apiKey: 'k' }, () => linearClient.getTeamProjects('T42'));
		expect(calls[0].body.variables).toEqual({ id: 'T42', first: 250 });
	});

	it('accepts a custom first argument for pagination', async () => {
		const { calls } = stubFetch({ team: { projects: { nodes: [] } } });
		await withLinearCredentials({ apiKey: 'k' }, () => linearClient.getTeamProjects('T1', 50));
		expect(calls[0].body.variables).toEqual({ id: 'T1', first: 50 });
	});
});
