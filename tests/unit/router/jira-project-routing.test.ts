/**
 * Spec 024 plan 2 — JIRA event routing across siblings sharing a project key.
 *
 * Before this plan both resolution sites took the FIRST project matching the
 * key, so a second project on the same key silently never received an event —
 * no error, no log, the operator simply saw nothing happen. These tests pin the
 * replacement: route by discriminator, fall back to the lone default, and skip
 * loudly (with an operator-readable reason) rather than guess an owner.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../src/router/config.js', () => ({ loadProjectConfig: vi.fn() }));
vi.mock('../../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/router/acknowledgments.js', () => ({
	postJiraAck: vi.fn(),
	resolveJiraBotAccountId: vi.fn(),
}));
vi.mock('../../../src/router/ackMessageGenerator.js', () => ({
	extractJiraContext: vi.fn(),
	generateAckMessage: vi.fn(),
}));
vi.mock('../../../src/router/platformClients/index.js', () => ({
	resolveJiraCredentials: vi.fn(),
}));
vi.mock('../../../src/utils/runLink.js', () => ({
	buildWorkItemRunsLink: vi.fn().mockReturnValue(null),
	getDashboardUrl: vi.fn().mockReturnValue(null),
}));
vi.mock('../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn().mockImplementation((_c: unknown, fn: () => unknown) => fn()),
}));
vi.mock('../../../src/router/adapters/_shared.js', () => ({
	withPMScopeForDispatch: vi.fn().mockImplementation((_p: unknown, fn: () => unknown) => fn()),
}));
vi.mock('../../../src/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('../../../src/router/queue.js', () => ({ addJob: vi.fn() }));
vi.mock('../../../src/router/action-dedup.js', () => ({
	isDuplicateAction: vi.fn().mockReturnValue(false),
	markActionProcessed: vi.fn(),
}));
vi.mock('../../../src/router/work-item-lock.js', () => ({
	isWorkItemLocked: vi.fn().mockResolvedValue({ locked: false }),
	markWorkItemEnqueued: vi.fn(),
	clearWorkItemEnqueued: vi.fn(),
}));
vi.mock('../../../src/router/agent-type-lock.js', () => ({
	checkAgentTypeConcurrency: vi.fn().mockResolvedValue({ maxConcurrency: null, blocked: false }),
	markAgentTypeEnqueued: vi.fn(),
	markRecentlyDispatched: vi.fn(),
	clearAgentTypeEnqueued: vi.fn(),
	clearRecentlyDispatched: vi.fn(),
}));
vi.mock('../../../src/router/lock-state-classifier.js', () => ({
	classifyLockState: vi.fn().mockResolvedValue('awaiting-slot'),
}));

import { JiraRouterAdapter } from '../../../src/router/adapters/jira.js';
import { loadProjectConfig, type RouterProjectConfig } from '../../../src/router/config.js';
import type { RouterPlatformAdapter } from '../../../src/router/platform-adapter.js';
import { processRouterWebhook } from '../../../src/router/webhook-processor.js';
import { captureException } from '../../../src/sentry.js';
import type { TriggerRegistry } from '../../../src/triggers/registry.js';

const KEY = 'SHARED';

type Discriminator = { kind: 'label' | 'component'; value: string };

const project = (id: string, discriminator: Discriminator | null): RouterProjectConfig => ({
	id,
	repo: `owner/${id}`,
	pmType: 'jira',
	jira: {
		projectKey: KEY,
		baseUrl: 'https://test.atlassian.net',
		...(discriminator ? { routing: { discriminator } } : {}),
	},
});

const useProjects = (...projects: RouterProjectConfig[]) => {
	vi.mocked(loadProjectConfig).mockResolvedValue({
		projects,
		fullProjects: projects.map((p) => ({ id: p.id })) as never,
	});
};

const payload = (over: {
	labels?: string[];
	components?: string[];
	issueKey?: string;
	event?: string;
}) => ({
	webhookEvent: over.event ?? 'jira:issue_updated',
	issue: {
		key: over.issueKey ?? `${KEY}-1`,
		fields: {
			project: { key: KEY },
			labels: over.labels ?? [],
			components: (over.components ?? []).map((name) => ({ name })),
		},
	},
});

/** Parse then resolve — the two sites this plan must keep in agreement. */
async function route(adapter: JiraRouterAdapter, p: ReturnType<typeof payload>) {
	const event = await adapter.parseWebhook(p);
	if (!event) return { event: null, resolution: null };
	return { event, resolution: await adapter.resolveProjectWithReason(event) };
}

describe('JIRA project routing across shared keys', () => {
	let adapter: JiraRouterAdapter;

	beforeEach(() => {
		vi.clearAllMocks();
		adapter = new JiraRouterAdapter();
	});

	it('routes a lone project on the key exactly as before', async () => {
		// AC #12 pin: the 1:1 topology every existing deployment runs. It must
		// route regardless of labels, since it never opted into scoping.
		useProjects(project('solo', null));

		const { event, resolution } = await route(adapter, payload({ labels: ['anything'] }));

		expect(event?.projectId).toBe('solo');
		expect(resolution?.project?.id).toBe('solo');
	});

	it('routes to the sibling whose label discriminator matches', async () => {
		useProjects(
			project('frontend', { kind: 'label', value: 'team-fe' }),
			project('backend', { kind: 'label', value: 'team-be' }),
		);

		const { resolution } = await route(adapter, payload({ labels: ['team-be'] }));

		expect(resolution?.project?.id).toBe('backend');
	});

	it('routes to the sibling whose component discriminator matches', async () => {
		useProjects(
			project('frontend', { kind: 'component', value: 'Web' }),
			project('backend', { kind: 'component', value: 'API' }),
		);

		const { resolution } = await route(adapter, payload({ components: ['API'] }));

		expect(resolution?.project?.id).toBe('backend');
	});

	it('routes to the discriminator-less default when nothing matches', async () => {
		useProjects(
			project('frontend', { kind: 'label', value: 'team-fe' }),
			project('catchall', null),
		);

		const { resolution } = await route(adapter, payload({ labels: [] }));

		expect(resolution?.project?.id).toBe('catchall');
	});

	it('skips with a reason naming the key and every evaluated discriminator', async () => {
		useProjects(
			project('frontend', { kind: 'label', value: 'team-fe' }),
			project('backend', { kind: 'label', value: 'team-be' }),
		);

		const { resolution } = await route(adapter, payload({ labels: ['unrelated'] }));

		expect(resolution?.project).toBeNull();
		// The operator's only diagnosis surface — it must say what was evaluated,
		// not merely that nothing happened.
		expect(resolution?.reason).toContain('team-fe');
		expect(resolution?.reason).toContain('team-be');
	});

	it('skips on ambiguity and captures Sentry once per issue per process', async () => {
		useProjects(
			project('frontend', { kind: 'label', value: 'team-fe' }),
			project('backend', { kind: 'label', value: 'team-be' }),
		);
		const both = payload({ labels: ['team-fe', 'team-be'], issueKey: `${KEY}-AMBIG` });

		const first = await route(adapter, both);
		const second = await route(adapter, both);

		expect(first.resolution?.project).toBeNull();
		expect(second.resolution?.project).toBeNull();
		expect(captureException).toHaveBeenCalledTimes(1);
		expect(vi.mocked(captureException).mock.calls[0][1]).toMatchObject({
			tags: { source: 'pm_routing_ambiguous' },
		});
	});

	it('resolves comment events through the same seam', async () => {
		useProjects(
			project('frontend', { kind: 'label', value: 'team-fe' }),
			project('backend', { kind: 'label', value: 'team-be' }),
		);

		const { resolution } = await route(
			adapter,
			payload({ labels: ['team-be'], event: 'comment_created' }),
		);

		expect(resolution?.project?.id).toBe('backend');
	});

	it('leaves the decision reason untouched for adapters without the hook', async () => {
		// AC #5 pin. The hook is optional precisely so the four adapters this
		// plan does not own keep their existing behaviour — including github.ts,
		// which plan 4 owns.
		const stub = {
			type: 'trello',
			parseWebhook: vi.fn().mockResolvedValue({
				projectIdentifier: 'board1',
				eventType: 'commentCard',
				isCommentEvent: true,
			}),
			isProcessableEvent: vi.fn().mockReturnValue(true),
			isSelfAuthored: vi.fn().mockResolvedValue(false),
			sendReaction: vi.fn(),
			resolveProject: vi.fn().mockResolvedValue(null),
			dispatchWithCredentials: vi.fn().mockResolvedValue(null),
			postAck: vi.fn().mockResolvedValue(undefined),
			buildJob: vi.fn(),
			firePreActions: vi.fn(),
		} as unknown as RouterPlatformAdapter;

		const result = await processRouterWebhook(stub, {}, {
			dispatch: vi.fn(),
		} as unknown as TriggerRegistry);

		expect(result.decisionReason).toBe('No project config for identifier board1');
	});
});
