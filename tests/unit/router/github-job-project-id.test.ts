/**
 * GitHub jobs must carry the project the router resolved.
 *
 * `TrelloJob` and `JiraJob` both carry `projectId`; `GitHubJob` did not, so
 * `extractProjectIdFromJob` re-resolved by repository — first match. Spec 024
 * made the ROUTER resolve link-first, but the job did not carry that decision,
 * so on a shared repository the worker could disagree with the router that
 * enqueued it: the container would be built with another project's credentials,
 * and the dispatch compensator and lock classifier would act on the wrong
 * project's lock.
 *
 * The router's decision travels with the job now. The repo lookup stays as a
 * fallback purely for jobs already sitting in Redis when this deploys.
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
vi.mock('../../../src/config/provider.js', () => mockProvider);
vi.mock('../../../src/router/config.js', () => ({ loadProjectConfig: vi.fn() }));
vi.mock('../../../src/router/queue.js', () => ({ addJob: vi.fn() }));
vi.mock('../../../src/router/reactions.js', () => ({ sendAcknowledgeReaction: vi.fn() }));
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
vi.mock('../../../src/config/projects.js', () => ({ getProjectGitHubToken: vi.fn() }));
vi.mock('../../../src/github/personas.js', () => ({
	resolvePersonaIdentities: vi.fn(),
	isCascadeBot: vi.fn(),
}));
vi.mock('../../../src/github/client.js', () => ({ withGitHubToken: mockWithGitHubToken }));
vi.mock('../../../src/pm/context.js', () => ({
	withPMProvider: vi.fn(),
	withPMCredentials: vi.fn(),
}));
vi.mock('../../../src/pm/registry.js', () => ({
	pmRegistry: { getOrNull: vi.fn(), createProvider: vi.fn(), register: vi.fn() },
}));
vi.mock('../../../src/integrations/pm/_shared/project-id-extractor.js', () => ({
	extractProjectIdFromJobViaRegistry: vi.fn().mockResolvedValue(null),
}));

import { GitHubRouterAdapter } from '../../../src/router/adapters/github.js';
import type { CascadeJob, GitHubJob } from '../../../src/router/queue.js';
import { extractProjectIdFromJob } from '../../../src/router/worker-env.js';

const REPO = 'acme/web';

const event = {
	projectIdentifier: REPO,
	eventType: 'pull_request',
	isCommentEvent: false,
	repoFullName: REPO,
	prNumber: 42,
};

describe('GitHub jobs carry the resolved project', () => {
	beforeEach(() => vi.clearAllMocks());

	it('stamps the project the router resolved onto the job', async () => {
		const adapter = new GitHubRouterAdapter();

		const job = adapter.buildJob(
			event as never,
			{},
			{ id: 'secondary', repo: REPO } as never,
			{ agentType: 'review' } as never,
		) as GitHubJob;

		expect(job.projectId).toBe('secondary');
	});

	it('prefers the stamped id over re-resolving by repository', async () => {
		// The whole point: on a shared repo the repo lookup returns the primary,
		// which is NOT necessarily the project that owns this PR.
		mockProvider.findProjectByRepo.mockResolvedValue({ id: 'primary' });

		const resolved = await extractProjectIdFromJob({
			type: 'github',
			repoFullName: REPO,
			projectId: 'secondary',
		} as unknown as CascadeJob);

		expect(resolved).toBe('secondary');
		expect(mockProvider.findProjectByRepo).not.toHaveBeenCalled();
	});

	it('falls back to the repository lookup for jobs enqueued before this shipped', async () => {
		// Jobs already in Redis at deploy time have no projectId. Dropping them
		// would be a worse bug than the one being fixed.
		mockProvider.findProjectByRepo.mockResolvedValue({ id: 'primary' });

		const resolved = await extractProjectIdFromJob({
			type: 'github',
			repoFullName: REPO,
		} as unknown as CascadeJob);

		expect(resolved).toBe('primary');
		expect(mockProvider.findProjectByRepo).toHaveBeenCalledWith(REPO);
	});

	it('still returns null for a job with neither', async () => {
		const resolved = await extractProjectIdFromJob({ type: 'github' } as unknown as CascadeJob);

		expect(resolved).toBeNull();
	});
});
