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

// Stubs fetch to return different raw GraphQL response envelopes per call.
// Unlike stubFetch, responses are returned verbatim (no { data: ... } wrapping)
// so callers can mix { data: ... } success responses with { errors: [...] } error responses.
function stubFetchSequence(responses: unknown[]): { calls: CapturedRequest[] } {
	const calls: CapturedRequest[] = [];
	let i = 0;
	const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		const body = JSON.parse(init?.body as string) as CapturedRequest['body'];
		calls.push({ url: String(url), body });
		const response = responses[i++] ?? responses[responses.length - 1];
		return new Response(JSON.stringify(response), {
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

describe('linearClient.createLabel — duplicate idempotency', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('returns the new label when Linear accepts the create', async () => {
		stubFetch({
			issueLabelCreate: {
				success: true,
				issueLabel: { id: 'L1', name: 'cascade-ready', color: '#0284C7' },
			},
		});
		const label = await withLinearCredentials({ apiKey: 'k' }, () =>
			linearClient.createLabel('T1', 'cascade-ready', '#0284C7'),
		);
		expect(label).toEqual({ id: 'L1', name: 'cascade-ready', color: '#0284C7' });
	});

	it('falls back to existing label when Linear returns duplicate label name error', async () => {
		const { calls } = stubFetchSequence([
			// first call: create → duplicate error (top-level GraphQL errors)
			{ errors: [{ message: 'duplicate label name' }] },
			// second call: getTeamLabels → success
			{
				data: {
					team: {
						labels: {
							nodes: [
								{ id: 'L99', name: 'cascade-ready', color: '#0284C7' },
								{ id: 'L100', name: 'cascade-error', color: '#DC2626' },
							],
						},
					},
				},
			},
		]);
		const label = await withLinearCredentials({ apiKey: 'k' }, () =>
			linearClient.createLabel('T1', 'cascade-ready', '#0284C7'),
		);
		expect(label).toEqual({ id: 'L99', name: 'cascade-ready', color: '#0284C7' });
		expect(calls).toHaveLength(2);
	});

	it('throws when duplicate error occurs but label is not found in team labels', async () => {
		stubFetchSequence([
			{ errors: [{ message: 'duplicate label name' }] },
			{
				data: {
					team: {
						labels: { nodes: [{ id: 'L100', name: 'other-label', color: '#000' }] },
					},
				},
			},
		]);
		await expect(
			withLinearCredentials({ apiKey: 'k' }, () =>
				linearClient.createLabel('T1', 'cascade-ready', '#0284C7'),
			),
		).rejects.toThrow('cascade-ready');
	});

	it('re-throws non-duplicate Linear errors without falling back', async () => {
		stubFetchSequence([{ errors: [{ message: 'team not found' }] }]);
		await expect(
			withLinearCredentials({ apiKey: 'k' }, () => linearClient.createLabel('T1', 'cascade-ready')),
		).rejects.toThrow('team not found');
	});
});

// ===== downloadAttachment =====

describe('linearClient.downloadAttachment', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('sends bare Authorization header (no Bearer prefix) and returns buffer + mimeType', async () => {
		const imageBytes = Buffer.from('linear-image-data');
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(imageBytes, {
				status: 200,
				headers: { 'Content-Type': 'image/png' },
			}),
		);

		const result = await withLinearCredentials({ apiKey: 'lin_api_testkey' }, () =>
			linearClient.downloadAttachment('https://uploads.linear.app/abc/screenshot.png'),
		);

		expect(result).not.toBeNull();
		// biome-ignore lint/style/noNonNullAssertion: guarded by expect above
		expect(result!.mimeType).toBe('image/png');
		// biome-ignore lint/style/noNonNullAssertion: guarded by expect above
		expect(result!.buffer).toBeInstanceOf(Buffer);

		const [url, options] = fetchSpy.mock.calls[0];
		expect(url).toBe('https://uploads.linear.app/abc/screenshot.png');
		// Linear personal keys are bare — no "Bearer" prefix
		expect(options?.headers).toEqual({ Authorization: 'lin_api_testkey' });
		// Content-Type is NOT included (this is a GET download, not a GraphQL mutation)
		expect((options?.headers as Record<string, string>)?.['Content-Type']).toBeUndefined();
	});

	it('returns null on non-OK response', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Forbidden', { status: 403 }));

		const result = await withLinearCredentials({ apiKey: 'lin_api_testkey' }, () =>
			linearClient.downloadAttachment('https://uploads.linear.app/abc/screenshot.png'),
		);

		expect(result).toBeNull();
	});

	it('throws when called outside withLinearCredentials scope', async () => {
		await expect(
			linearClient.downloadAttachment('https://uploads.linear.app/abc/screenshot.png'),
		).rejects.toThrow('No Linear credentials in scope');
	});
});
