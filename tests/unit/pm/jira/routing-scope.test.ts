/**
 * Spec 024 plan 3 — a discriminator-scoped project sees and produces only its
 * own slice of a shared JIRA board.
 *
 * Plan 2 made events route to the right sibling. Without this, a scoped
 * project's agents still LIST the sibling team's issues (backlog-manager would
 * happily pick one up) and CREATE issues carrying no attribute, so the events
 * those issues later emit cannot route back. Reads and writes have to be
 * symmetric or routing is only half true.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraClient, mockMarkdownToAdf } = vi.hoisted(() => ({
	mockJiraClient: {
		createIssue: vi.fn(),
		searchIssues: vi.fn(),
		getTransitions: vi.fn(),
		transitionIssue: vi.fn(),
	},
	mockMarkdownToAdf: vi.fn().mockReturnValue({ type: 'doc' }),
}));

vi.mock('../../../../src/jira/client.js', () => ({ jiraClient: mockJiraClient }));
vi.mock('../../../../src/pm/jira/adf.js', () => ({
	markdownToAdf: mockMarkdownToAdf,
	adfToPlainText: vi.fn().mockReturnValue(''),
	extractAdfMediaNodes: vi.fn().mockReturnValue([]),
}));
vi.mock('../../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../../src/sentry.js', () => ({ captureException: vi.fn() }));

import { JiraPMProvider } from '../../../../src/pm/jira/adapter.js';

type Discriminator = { kind: 'label' | 'component'; value: string };

const provider = (discriminator?: Discriminator, statuses: Record<string, string> = {}) =>
	new JiraPMProvider({
		projectKey: 'SHARED',
		baseUrl: 'https://test.atlassian.net',
		statuses,
		...(discriminator ? { routing: { discriminator } } : {}),
	} as never);

const jqlFor = async (p: ReturnType<typeof provider>, filter?: { status?: string }) => {
	mockJiraClient.searchIssues.mockResolvedValue([]);
	await p.listWorkItems(undefined, filter as never);
	return mockJiraClient.searchIssues.mock.calls[0][0] as string;
};

/**
 * JQL requires ORDER BY last, so every filter clause must land before it.
 * Appending a discriminator to the end of the finished string would produce
 * invalid JQL — hence full-string assertions rather than `toContain`.
 */
const ORDER = ' ORDER BY created DESC';

const createdFields = async (
	p: ReturnType<typeof provider>,
	labels?: string[],
): Promise<Record<string, unknown>> => {
	mockJiraClient.createIssue.mockResolvedValue({ key: 'SHARED-1' });
	await p.createWorkItem({ title: 'T', ...(labels ? { labels } : {}) } as never);
	return mockJiraClient.createIssue.mock.calls[0][0] as Record<string, unknown>;
};

describe('JIRA read scoping (listWorkItems JQL)', () => {
	beforeEach(() => vi.clearAllMocks());

	it('produces exactly today’s JQL when no discriminator is configured', async () => {
		// AC #12 pin: every existing project is this case. Byte-identical, not
		// merely equivalent — a stray clause would silently change what agents see.
		expect(await jqlFor(provider())).toBe(`project = "SHARED"${ORDER}`);
	});

	it('appends a labels clause for a label discriminator', async () => {
		const jql = await jqlFor(provider({ kind: 'label', value: 'team-be' }));
		expect(jql).toBe(`project = "SHARED" AND labels = "team-be"${ORDER}`);
	});

	it('appends a component clause for a component discriminator', async () => {
		const jql = await jqlFor(provider({ kind: 'component', value: 'Backend' }));
		expect(jql).toBe(`project = "SHARED" AND component = "Backend"${ORDER}`);
	});

	it('composes with a status filter in a stable order', async () => {
		const p = provider({ kind: 'label', value: 'team-be' }, { todo: 'To Do' });
		expect(await jqlFor(p, { status: 'todo' })).toBe(
			`project = "SHARED" AND status = "To Do" AND labels = "team-be"${ORDER}`,
		);
	});

	it('quotes a discriminator value containing spaces', async () => {
		// Unquoted, JQL would parse the second word as an operator and either
		// error or — worse — match something else entirely.
		const jql = await jqlFor(provider({ kind: 'component', value: 'Payments API' }));
		expect(jql).toBe(`project = "SHARED" AND component = "Payments API"${ORDER}`);
	});
});

describe('JIRA write stamping (createWorkItem)', () => {
	beforeEach(() => vi.clearAllMocks());

	it('sends today’s exact payload when no discriminator is configured', async () => {
		// AC #12 pin, including the ABSENCE of a components key: JIRA rejects
		// `components: []` on projects without components configured.
		const fields = await createdFields(provider(), ['cascade-auto']);
		expect(fields.labels).toEqual(['cascade-auto']);
		expect(fields).not.toHaveProperty('components');
	});

	it('appends a label discriminator to caller-supplied labels', async () => {
		const p = provider({ kind: 'label', value: 'team-be' });
		expect((await createdFields(p, ['cascade-auto'])).labels).toEqual(['cascade-auto', 'team-be']);
	});

	it('stamps a label discriminator when the caller supplies none', async () => {
		const p = provider({ kind: 'label', value: 'team-be' });
		expect((await createdFields(p)).labels).toEqual(['team-be']);
	});

	it('stamps onto an empty caller labels array', async () => {
		// The shape both materializers actually pass: the alert materializer sends
		// labels: [] unconditionally, and friction sends [] whenever no friction
		// label is configured. Neither of the other tests exercises it.
		const p = provider({ kind: 'label', value: 'team-be' });
		expect((await createdFields(p, [])).labels).toEqual(['team-be']);
	});

	it('sends no labels key at all for an empty array and no discriminator', async () => {
		// Byte-identity for the same production shape on the unconfigured path.
		expect(await createdFields(provider(), [])).not.toHaveProperty('labels');
	});

	it('does not duplicate a label the caller already supplied', async () => {
		const p = provider({ kind: 'label', value: 'team-be' });
		expect((await createdFields(p, ['team-be', 'other'])).labels).toEqual(['team-be', 'other']);
	});

	it('sets the components field for a component discriminator', async () => {
		const p = provider({ kind: 'component', value: 'Backend' });
		const fields = await createdFields(p, ['cascade-auto']);
		expect(fields.components).toEqual([{ name: 'Backend' }]);
		// A component discriminator must not also touch labels.
		expect(fields.labels).toEqual(['cascade-auto']);
	});
});
