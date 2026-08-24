/**
 * Spec 024 plan 4 — GitHub event routing when several projects share one repo.
 *
 * Resolution is LINK-FIRST: a PR that a project has already claimed (a
 * `pr_work_items` row) belongs to that project regardless of which project is
 * the repository's primary. Only unlinked events — human-authored PRs, freshly
 * opened ones — fall back to the primary.
 *
 * The subtle half is that the adapter resolves the project TWICE by different
 * routes: `resolveProject` for the dispatch pipeline, and a per-request cache
 * feeding `isSelfAuthored` (loop prevention) and `sendReaction`. Both must agree,
 * or a shared repo resolves one project's personas against another's events.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockLogger, mockWithGitHubToken } from '../../helpers/sharedMocks.js';

const { mockProvider } = vi.hoisted(() => ({
	mockProvider: {
		findProjectByRepo: vi.fn(),
		findPrimaryProjectByRepo: vi.fn(),
		findProjectIdByRepoPr: vi.fn(),
		findProjectById: vi.fn(),
	},
}));

vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));
vi.mock('../../../src/router/config.js', () => ({ loadProjectConfig: vi.fn() }));
vi.mock('../../../src/config/provider.js', () => mockProvider);
vi.mock('../../../src/router/queue.js', () => ({ addJob: vi.fn() }));
vi.mock('../../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/router/acknowledgments.js', () => ({
	postGitHubAck: vi.fn(),
	postTrelloAck: vi.fn(),
	postJiraAck: vi.fn(),
	resolveGitHubTokenForAckByAgent: vi.fn(),
}));
vi.mock('../../../src/router/pm-ack-dispatch.js', () => ({ dispatchPMAck: vi.fn() }));
vi.mock('../../../src/agents/definitions/loader.js', () => ({
	isPMFocusedAgent: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../../src/router/notifications.js', () => ({ extractPRNumber: vi.fn() }));
vi.mock('../../../src/router/pre-actions.js', () => ({ addEyesReactionToPR: vi.fn() }));
vi.mock('../../../src/router/ackMessageGenerator.js', () => ({
	extractGitHubContext: vi.fn(),
	generateAckMessage: vi.fn(),
}));
vi.mock('../../../src/config/projects.js', () => ({
	getProjectGitHubToken: vi.fn().mockResolvedValue('ghp_mock'),
}));
vi.mock('../../../src/github/personas.js', () => ({
	resolvePersonaIdentities: vi.fn().mockResolvedValue({ implementer: 'impl-bot' }),
	isCascadeBot: vi.fn().mockReturnValue(true),
}));
vi.mock('../../../src/github/client.js', () => ({ withGitHubToken: mockWithGitHubToken }));
vi.mock('../../../src/pm/context.js', () => ({
	withPMProvider: vi.fn().mockImplementation((_p: unknown, fn: () => unknown) => fn()),
	withPMCredentials: vi.fn().mockImplementation((..._a: unknown[]) => undefined),
}));
vi.mock('../../../src/pm/registry.js', () => ({
	pmRegistry: {
		getOrNull: vi.fn().mockReturnValue(null),
		createProvider: vi.fn(),
		register: vi.fn(),
	},
}));

import { resolvePersonaIdentities } from '../../../src/github/personas.js';
import { GitHubRouterAdapter } from '../../../src/router/adapters/github.js';
import { loadProjectConfig } from '../../../src/router/config.js';

const REPO = 'acme/web';

const routerProject = (id: string) => ({ id, repo: REPO, pmType: 'jira' as const });

const useProjects = (...ids: string[]) => {
	vi.mocked(loadProjectConfig).mockResolvedValue({
		projects: ids.map(routerProject),
		fullProjects: ids.map((id) => ({ id })) as never,
	});
};

const prPayload = (number: number) => ({
	_eventType: 'pull_request',
	repository: { full_name: REPO },
	pull_request: { number },
});

const checkSuitePayload = (number: number) => ({
	_eventType: 'check_suite',
	repository: { full_name: REPO },
	check_suite: { pull_requests: [{ number }] },
});

describe('GitHub project routing across shared repositories', () => {
	let adapter: GitHubRouterAdapter;

	beforeEach(() => {
		vi.clearAllMocks();
		adapter = new GitHubRouterAdapter();
		mockProvider.findProjectIdByRepoPr.mockResolvedValue(null);
		mockProvider.findPrimaryProjectByRepo.mockResolvedValue({ id: 'primary' });
		mockProvider.findProjectById.mockImplementation(async (id: string) => ({ id }));
	});

	it('resolves an unshared repository exactly as before', async () => {
		// AC #12 pin: one project owns the repo and is its primary, so link-first
		// and primary-fallback must both land on it.
		useProjects('solo');
		mockProvider.findPrimaryProjectByRepo.mockResolvedValue({ id: 'solo' });

		const event = await adapter.parseWebhook(prPayload(7));
		expect((await adapter.resolveProject(event as never))?.id).toBe('solo');
	});

	it('routes a linked PR to the linked project, not the repository primary', async () => {
		useProjects('primary', 'secondary');
		mockProvider.findProjectIdByRepoPr.mockResolvedValue('secondary');

		const event = await adapter.parseWebhook(prPayload(42));

		expect((await adapter.resolveProject(event as never))?.id).toBe('secondary');
		expect(mockProvider.findProjectIdByRepoPr).toHaveBeenCalledWith(REPO, 42);
	});

	it('falls back to the primary for an unlinked PR', async () => {
		// Human-authored PRs and freshly opened ones have no link yet. The
		// secondary is listed FIRST so a lingering first-match would answer
		// 'secondary' — otherwise this passes for the wrong reason.
		useProjects('secondary', 'primary');
		mockProvider.findProjectIdByRepoPr.mockResolvedValue(null);

		const event = await adapter.parseWebhook(prPayload(43));
		expect((await adapter.resolveProject(event as never))?.id).toBe('primary');
	});

	it('does not attempt a link lookup for an event carrying no PR number', async () => {
		useProjects('primary');

		const event = await adapter.parseWebhook({
			_eventType: 'push',
			repository: { full_name: REPO },
		});
		if (event) await adapter.resolveProject(event as never);

		expect(mockProvider.findProjectIdByRepoPr).not.toHaveBeenCalled();
	});

	it('uses the suite’s PR number for a check-suite event', async () => {
		// check_suite carries its PRs in a nested array rather than at the top
		// level; without this the busiest CI event would never resolve a link.
		useProjects('primary', 'secondary');
		mockProvider.findProjectIdByRepoPr.mockResolvedValue('secondary');

		const event = await adapter.parseWebhook(checkSuitePayload(99));

		expect((await adapter.resolveProject(event as never))?.id).toBe('secondary');
		expect(mockProvider.findProjectIdByRepoPr).toHaveBeenCalledWith(REPO, 99);
	});

	it('falls back to the primary when a link points at a deleted project', async () => {
		useProjects('primary');
		mockProvider.findProjectIdByRepoPr.mockResolvedValue('deleted-project');
		// The row outlived the project it pointed at.
		mockProvider.findProjectById.mockResolvedValue(undefined);

		const event = await adapter.parseWebhook(prPayload(44));

		expect((await adapter.resolveProject(event as never))?.id).toBe('primary');
		expect(mockLogger.warn).toHaveBeenCalled();
	});

	it('resolves loop-prevention personas from the linked project', async () => {
		// Not in the plan's task list. isSelfAuthored resolves personas through a
		// separate per-request cache; if that still took the repo's first match,
		// a shared repo would check one project's bot identities against another
		// project's comments — and loop prevention would silently misfire.
		useProjects('primary', 'secondary');
		mockProvider.findProjectIdByRepoPr.mockResolvedValue('secondary');

		const event = await adapter.parseWebhook({
			_eventType: 'issue_comment',
			repository: { full_name: REPO },
			issue: { number: 42, pull_request: {} },
			comment: { user: { login: 'impl-bot' } },
		});
		await adapter.isSelfAuthored(event as never, {
			comment: { user: { login: 'impl-bot' } },
		});

		expect(resolvePersonaIdentities).toHaveBeenCalledWith('secondary');
	});
});
