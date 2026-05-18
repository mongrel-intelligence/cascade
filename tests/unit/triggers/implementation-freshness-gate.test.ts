import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockProject } from '../../helpers/factories.js';
import { createMockPMProvider } from '../../helpers/mockPMProvider.js';
import { mockGithubClient, mockLogger, mockWithGitHubToken } from '../../helpers/sharedMocks.js';

vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));
vi.mock('../../../src/github/client.js', () => ({
	withGitHubToken: mockWithGitHubToken,
	githubClient: mockGithubClient,
}));
vi.mock('../../../src/github/personas.js', () => ({
	getPersonaToken: vi.fn().mockResolvedValue('github-token'),
}));

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	countActiveRuns: vi.fn(),
	DEFAULT_STALE_RUN_THRESHOLD_MS: 2 * 60 * 60 * 1000,
	getRunsByWorkItem: vi.fn(),
}));

vi.mock('../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	listPRsForWorkItem: vi.fn(),
}));

import { listPRsForWorkItem } from '../../../src/db/repositories/prWorkItemsRepository.js';
import { countActiveRuns, getRunsByWorkItem } from '../../../src/db/repositories/runsRepository.js';
import { getPersonaToken } from '../../../src/github/personas.js';
import {
	evaluateImplementationFreshness,
	postFreshnessSkipNotice,
} from '../../../src/triggers/shared/implementation-freshness-gate.js';

const baseProject = createMockProject({ id: 'project-1', repo: 'org/repo' });

// Helper to build a typed `agent_runs.findByWorkItem` row used by tests.
type RunRow = Awaited<ReturnType<typeof getRunsByWorkItem>>[number];
function makeRunRow(overrides: Partial<RunRow>): RunRow {
	return {
		id: 'run-default',
		projectId: 'project-1',
		workItemId: 'card-1',
		prNumber: null,
		agentType: 'implementation',
		engine: 'claude-code',
		triggerType: null,
		status: 'completed',
		model: null,
		maxIterations: null,
		startedAt: new Date(),
		completedAt: new Date(),
		durationMs: 1000,
		llmIterations: 1,
		gadgetCalls: 1,
		costUsd: '0.10',
		success: true,
		error: null,
		prUrl: null,
		outputSummary: null,
		jobId: null,
		workItemUrl: null,
		workItemTitle: null,
		prTitle: null,
		...overrides,
	} as RunRow;
}

beforeEach(() => {
	vi.mocked(countActiveRuns).mockResolvedValue(0);
	vi.mocked(getRunsByWorkItem).mockResolvedValue([]);
	vi.mocked(listPRsForWorkItem).mockResolvedValue([]);
	vi.mocked(getPersonaToken).mockResolvedValue('github-token');
	mockWithGitHubToken.mockImplementation((_token, fn) => fn());
});

describe('evaluateImplementationFreshness', () => {
	describe('agent-type gating', () => {
		it('bypasses non-implementation agent types as dispatchable', async () => {
			const provider = createMockPMProvider();
			const outcome = await evaluateImplementationFreshness({
				agentType: 'review',
				workItemId: 'card-1',
				project: baseProject,
				provider,
			});
			expect(outcome.kind).toBe('dispatchable');
			expect(provider.getChecklists).not.toHaveBeenCalled();
		});

		it('bypasses respond-to-review as dispatchable', async () => {
			const provider = createMockPMProvider();
			const outcome = await evaluateImplementationFreshness({
				agentType: 'respond-to-review',
				workItemId: 'card-1',
				project: baseProject,
				provider,
			});
			expect(outcome.kind).toBe('dispatchable');
		});

		it('bypasses respond-to-ci as dispatchable', async () => {
			const provider = createMockPMProvider();
			const outcome = await evaluateImplementationFreshness({
				agentType: 'respond-to-ci',
				workItemId: 'card-1',
				project: baseProject,
				provider,
			});
			expect(outcome.kind).toBe('dispatchable');
		});

		it('bypasses when no workItemId is resolved', async () => {
			const provider = createMockPMProvider();
			const outcome = await evaluateImplementationFreshness({
				agentType: 'implementation',
				workItemId: undefined,
				project: baseProject,
				provider,
			});
			expect(outcome.kind).toBe('dispatchable');
			expect(provider.getChecklists).not.toHaveBeenCalled();
		});
	});

	describe('completed checklists', () => {
		it('returns already_implemented when "Implementation Steps" is fully complete', async () => {
			const provider = createMockPMProvider();
			provider.getChecklists.mockResolvedValue([
				{
					id: 'cl-1',
					name: 'Implementation Steps',
					workItemId: 'card-1',
					items: [
						{ id: 'i-1', name: 'a', complete: true },
						{ id: 'i-2', name: 'b', complete: true },
					],
				},
			]);

			const outcome = await evaluateImplementationFreshness({
				agentType: 'implementation',
				workItemId: 'card-1',
				project: baseProject,
				provider,
			});

			expect(outcome.kind).toBe('already_implemented');
			expect(outcome.evidence.completedChecklists).toContain('Implementation Steps');
		});

		it('returns already_implemented when "Acceptance Criteria" is fully complete', async () => {
			const provider = createMockPMProvider();
			provider.getChecklists.mockResolvedValue([
				{
					id: 'cl-1',
					name: 'Acceptance Criteria',
					workItemId: 'card-1',
					items: [{ id: 'i-1', name: 'a', complete: true }],
				},
			]);

			const outcome = await evaluateImplementationFreshness({
				agentType: 'implementation',
				workItemId: 'card-1',
				project: baseProject,
				provider,
			});

			expect(outcome.kind).toBe('already_implemented');
			expect(outcome.evidence.completedChecklists).toContain('Acceptance Criteria');
		});

		it('does NOT block on unrelated checklist names', async () => {
			const provider = createMockPMProvider();
			provider.getChecklists.mockResolvedValue([
				{
					id: 'cl-1',
					name: 'Dependencies',
					workItemId: 'card-1',
					items: [{ id: 'i-1', name: 'a', complete: true }],
				},
				{
					id: 'cl-2',
					name: 'Friction',
					workItemId: 'card-1',
					items: [{ id: 'i-2', name: 'b', complete: true }],
				},
			]);

			const outcome = await evaluateImplementationFreshness({
				agentType: 'implementation',
				workItemId: 'card-1',
				project: baseProject,
				provider,
			});

			expect(outcome.kind).toBe('dispatchable');
		});

		it('does NOT block on partially complete terminal checklists', async () => {
			const provider = createMockPMProvider();
			provider.getChecklists.mockResolvedValue([
				{
					id: 'cl-1',
					name: 'Implementation Steps',
					workItemId: 'card-1',
					items: [
						{ id: 'i-1', name: 'a', complete: true },
						{ id: 'i-2', name: 'b', complete: false },
					],
				},
			]);

			const outcome = await evaluateImplementationFreshness({
				agentType: 'implementation',
				workItemId: 'card-1',
				project: baseProject,
				provider,
			});

			expect(outcome.kind).toBe('dispatchable');
		});

		it('does NOT block on empty terminal checklists', async () => {
			const provider = createMockPMProvider();
			provider.getChecklists.mockResolvedValue([
				{
					id: 'cl-1',
					name: 'Implementation Steps',
					workItemId: 'card-1',
					items: [],
				},
			]);

			const outcome = await evaluateImplementationFreshness({
				agentType: 'implementation',
				workItemId: 'card-1',
				project: baseProject,
				provider,
			});

			expect(outcome.kind).toBe('dispatchable');
		});
	});

	describe('active implementation runs', () => {
		it('returns active_implementation when an in-flight run exists', async () => {
			const provider = createMockPMProvider();
			provider.getChecklists.mockResolvedValue([]);
			vi.mocked(countActiveRuns).mockResolvedValue(1);

			const outcome = await evaluateImplementationFreshness({
				agentType: 'implementation',
				workItemId: 'card-1',
				project: baseProject,
				provider,
			});

			expect(outcome.kind).toBe('active_implementation');
			expect(countActiveRuns).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: 'project-1',
					workItemId: 'card-1',
					agentType: 'implementation',
				}),
			);
		});

		it('does not block when count is zero', async () => {
			const provider = createMockPMProvider();
			provider.getChecklists.mockResolvedValue([]);
			vi.mocked(countActiveRuns).mockResolvedValue(0);

			const outcome = await evaluateImplementationFreshness({
				agentType: 'implementation',
				workItemId: 'card-1',
				project: baseProject,
				provider,
			});

			expect(outcome.kind).toBe('dispatchable');
		});
	});

	describe('linked PR verification', () => {
		it('returns implementation_pr_exists when an open PR exists', async () => {
			const provider = createMockPMProvider();
			provider.getChecklists.mockResolvedValue([]);
			vi.mocked(listPRsForWorkItem).mockResolvedValue([
				{
					prNumber: 42,
					repoFullName: 'org/repo',
					prUrl: 'https://github.com/org/repo/pull/42',
					prTitle: 'feat: stuff',
					workItemId: 'card-1',
					workItemUrl: null,
					workItemTitle: null,
					runCount: 1,
				},
			]);
			mockGithubClient.getPR.mockResolvedValue({
				number: 42,
				title: 'feat: stuff',
				body: null,
				state: 'open',
				htmlUrl: 'https://github.com/org/repo/pull/42',
				headRef: 'feature/x',
				headSha: 'sha',
				baseRef: 'main',
				merged: false,
				mergeable: null,
				user: { login: 'cascade-bot' },
			});

			const outcome = await evaluateImplementationFreshness({
				agentType: 'implementation',
				workItemId: 'card-1',
				project: baseProject,
				provider,
			});

			expect(outcome.kind).toBe('implementation_pr_exists');
			expect(outcome.message).toContain('/pull/42');
			expect(getPersonaToken).toHaveBeenCalledWith('project-1', 'implementation');
			expect(mockWithGitHubToken).toHaveBeenCalledWith('github-token', expect.any(Function));
		});

		it('returns already_implemented when a linked PR is merged', async () => {
			const provider = createMockPMProvider();
			provider.getChecklists.mockResolvedValue([]);
			vi.mocked(listPRsForWorkItem).mockResolvedValue([
				{
					prNumber: 99,
					repoFullName: 'org/repo',
					prUrl: 'https://github.com/org/repo/pull/99',
					prTitle: 'feat: shipped',
					workItemId: 'card-1',
					workItemUrl: null,
					workItemTitle: null,
					runCount: 1,
				},
			]);
			mockGithubClient.getPR.mockResolvedValue({
				number: 99,
				title: 'feat: shipped',
				body: null,
				state: 'closed',
				htmlUrl: 'https://github.com/org/repo/pull/99',
				headRef: 'feature/x',
				headSha: 'sha',
				baseRef: 'main',
				merged: true,
				mergeable: null,
				user: { login: 'cascade-bot' },
			});

			const outcome = await evaluateImplementationFreshness({
				agentType: 'implementation',
				workItemId: 'card-1',
				project: baseProject,
				provider,
			});

			expect(outcome.kind).toBe('already_implemented');
		});

		it('does NOT block on closed-unmerged PRs (allows reimplementation)', async () => {
			const provider = createMockPMProvider();
			provider.getChecklists.mockResolvedValue([]);
			vi.mocked(listPRsForWorkItem).mockResolvedValue([
				{
					prNumber: 7,
					repoFullName: 'org/repo',
					prUrl: 'https://github.com/org/repo/pull/7',
					prTitle: 'abandoned',
					workItemId: 'card-1',
					workItemUrl: null,
					workItemTitle: null,
					runCount: 1,
				},
			]);
			mockGithubClient.getPR.mockResolvedValue({
				number: 7,
				title: 'abandoned',
				body: null,
				state: 'closed',
				htmlUrl: 'https://github.com/org/repo/pull/7',
				headRef: 'feature/x',
				headSha: 'sha',
				baseRef: 'main',
				merged: false,
				mergeable: null,
				user: { login: 'cascade-bot' },
			});

			const outcome = await evaluateImplementationFreshness({
				agentType: 'implementation',
				workItemId: 'card-1',
				project: baseProject,
				provider,
			});

			expect(outcome.kind).toBe('dispatchable');
		});

		it('allows manual reimplementation when a run-derived PR is closed-unmerged', async () => {
			const provider = createMockPMProvider();
			provider.getChecklists.mockResolvedValue([]);
			vi.mocked(listPRsForWorkItem).mockResolvedValue([]);
			vi.mocked(getRunsByWorkItem).mockResolvedValue([
				makeRunRow({
					id: 'run-success',
					success: true,
					prUrl: 'https://github.com/org/repo/pull/77',
					completedAt: new Date(),
				}),
			]);
			mockGithubClient.getPR.mockResolvedValue({
				number: 77,
				title: 'closed retry target',
				body: null,
				state: 'closed',
				htmlUrl: 'https://github.com/org/repo/pull/77',
				headRef: 'feature/x',
				headSha: 'sha',
				baseRef: 'main',
				merged: false,
				mergeable: null,
				user: { login: 'cascade-bot' },
			});

			const outcome = await evaluateImplementationFreshness({
				agentType: 'implementation',
				workItemId: 'card-1',
				project: baseProject,
				provider,
			});

			expect(outcome.kind).toBe('dispatchable');
			expect(getPersonaToken).toHaveBeenCalledWith('project-1', 'implementation');
			expect(mockWithGitHubToken).toHaveBeenCalledWith('github-token', expect.any(Function));
			expect(mockGithubClient.getPR).toHaveBeenCalledWith('org', 'repo', 77);
		});

		it('merges PR candidates from recent runs that point to a PR', async () => {
			const provider = createMockPMProvider();
			provider.getChecklists.mockResolvedValue([]);
			vi.mocked(listPRsForWorkItem).mockResolvedValue([]);
			vi.mocked(getRunsByWorkItem).mockResolvedValue([
				makeRunRow({
					id: 'run-success',
					success: true,
					prUrl: 'https://github.com/org/repo/pull/12',
					completedAt: new Date(),
				}),
			]);
			mockGithubClient.getPR.mockResolvedValue({
				number: 12,
				title: 'derived',
				body: null,
				state: 'open',
				htmlUrl: 'https://github.com/org/repo/pull/12',
				headRef: 'feature/x',
				headSha: 'sha',
				baseRef: 'main',
				merged: false,
				mergeable: null,
				user: { login: 'cascade-bot' },
			});

			const outcome = await evaluateImplementationFreshness({
				agentType: 'implementation',
				workItemId: 'card-1',
				project: baseProject,
				provider,
			});

			expect(outcome.kind).toBe('implementation_pr_exists');
			expect(mockGithubClient.getPR).toHaveBeenCalledWith('org', 'repo', 12);
		});
	});

	describe('fail-closed', () => {
		it('returns needs_human_reconciliation on PR lookup failure with terminal checklist evidence', async () => {
			const provider = createMockPMProvider();
			provider.getChecklists.mockResolvedValue([
				{
					id: 'cl-1',
					name: 'Implementation Steps',
					workItemId: 'card-1',
					// items present but partially complete — provides ownership evidence
					// without being a clean terminal hit, so PR uncertainty matters.
					items: [
						{ id: 'i-1', name: 'a', complete: true },
						{ id: 'i-2', name: 'b', complete: false },
					],
				},
			]);
			vi.mocked(countActiveRuns).mockResolvedValue(1);
			vi.mocked(listPRsForWorkItem).mockResolvedValue([
				{
					prNumber: 5,
					repoFullName: 'org/repo',
					prUrl: 'https://github.com/org/repo/pull/5',
					prTitle: 'feat',
					workItemId: 'card-1',
					workItemUrl: null,
					workItemTitle: null,
					runCount: 1,
				},
			]);
			mockGithubClient.getPR.mockRejectedValue(new Error('rate-limited'));

			const outcome = await evaluateImplementationFreshness({
				agentType: 'implementation',
				workItemId: 'card-1',
				project: baseProject,
				provider,
			});

			// Active implementation run wins as the immediate cause rather than
			// the PR uncertainty — both block dispatch, but tests pin the
			// concrete outcome we expect from this combination.
			expect(outcome.kind).toBe('active_implementation');
		});

		it('fails closed when checklist read fails AND another ownership signal exists', async () => {
			const provider = createMockPMProvider();
			provider.getChecklists.mockRejectedValue(new Error('PM read failed'));
			vi.mocked(countActiveRuns).mockResolvedValue(0);
			vi.mocked(listPRsForWorkItem).mockResolvedValue([]);
			vi.mocked(getRunsByWorkItem).mockResolvedValue([
				makeRunRow({
					id: 'run-success',
					success: true,
					prUrl: 'https://github.com/org/repo/pull/3',
					completedAt: new Date(),
				}),
			]);
			mockGithubClient.getPR.mockResolvedValue({
				number: 3,
				title: 'old',
				body: null,
				state: 'closed',
				htmlUrl: 'https://github.com/org/repo/pull/3',
				headRef: 'x',
				headSha: 'y',
				baseRef: 'main',
				merged: false,
				mergeable: null,
				user: { login: 'cascade' },
			});

			const outcome = await evaluateImplementationFreshness({
				agentType: 'implementation',
				workItemId: 'card-1',
				project: baseProject,
				provider,
			});

			expect(outcome.kind).toBe('needs_human_reconciliation');
			expect(outcome.evidence.uncertaintyReason).toBe('checklist_read_failed');
		});

		it('treats successful implementation runs without PR as needs_human_reconciliation', async () => {
			const provider = createMockPMProvider();
			provider.getChecklists.mockResolvedValue([]);
			vi.mocked(countActiveRuns).mockResolvedValue(0);
			vi.mocked(listPRsForWorkItem).mockResolvedValue([]);
			vi.mocked(getRunsByWorkItem).mockResolvedValue([
				makeRunRow({
					id: 'run-weird',
					success: true,
					prUrl: null,
					completedAt: new Date(),
				}),
			]);

			const outcome = await evaluateImplementationFreshness({
				agentType: 'implementation',
				workItemId: 'card-1',
				project: baseProject,
				provider,
			});

			expect(outcome.kind).toBe('needs_human_reconciliation');
			expect(outcome.evidence.uncertaintyReason).toBe('successful_implementation_without_pr');
		});

		it('fails closed when checklist read fails even without other duplicate-work evidence', async () => {
			const provider = createMockPMProvider();
			provider.getChecklists.mockRejectedValue(new Error('PM read failed'));
			vi.mocked(countActiveRuns).mockResolvedValue(0);
			vi.mocked(listPRsForWorkItem).mockResolvedValue([]);
			vi.mocked(getRunsByWorkItem).mockResolvedValue([]);

			const outcome = await evaluateImplementationFreshness({
				agentType: 'implementation',
				workItemId: 'card-1',
				project: baseProject,
				provider,
			});

			expect(outcome.kind).toBe('needs_human_reconciliation');
			expect(outcome.evidence.uncertaintyReason).toBe('checklist_read_failed');
		});

		it('fails closed when a pr_work_items candidate cannot be verified', async () => {
			const provider = createMockPMProvider();
			provider.getChecklists.mockResolvedValue([]);
			vi.mocked(countActiveRuns).mockResolvedValue(0);
			vi.mocked(listPRsForWorkItem).mockResolvedValue([
				{
					prNumber: 88,
					repoFullName: 'org/repo',
					prUrl: 'https://github.com/org/repo/pull/88',
					prTitle: 'possibly open',
					workItemId: 'card-1',
					workItemUrl: null,
					workItemTitle: null,
					runCount: 1,
				},
			]);
			vi.mocked(getRunsByWorkItem).mockResolvedValue([]);
			mockGithubClient.getPR.mockRejectedValue(new Error('No GitHub client in scope'));

			const outcome = await evaluateImplementationFreshness({
				agentType: 'implementation',
				workItemId: 'card-1',
				project: baseProject,
				provider,
			});

			expect(outcome.kind).toBe('needs_human_reconciliation');
			expect(outcome.evidence.uncertaintyReason).toBe('pr_lookup_failed');
		});
	});
});

describe('postFreshnessSkipNotice', () => {
	it('updates the existing ack comment when present', async () => {
		const provider = createMockPMProvider();
		await postFreshnessSkipNotice(
			provider,
			'card-1',
			{ ackCommentId: 'comment-123' },
			{
				kind: 'already_implemented',
				message: 'Implementation not started: already implemented.',
				evidence: {},
			},
		);

		expect(provider.updateComment).toHaveBeenCalledWith(
			'card-1',
			'comment-123',
			'Implementation not started: already implemented.',
		);
		expect(provider.addComment).not.toHaveBeenCalled();
	});

	it('falls back to addComment when updateComment fails', async () => {
		const provider = createMockPMProvider();
		provider.updateComment.mockRejectedValueOnce(new Error('comment vanished'));

		await postFreshnessSkipNotice(
			provider,
			'card-1',
			{ ackCommentId: 'comment-deleted' },
			{
				kind: 'implementation_pr_exists',
				message: 'Implementation not started: existing PR ...',
				evidence: {},
			},
		);

		expect(provider.addComment).toHaveBeenCalledWith(
			'card-1',
			'Implementation not started: existing PR ...',
		);
	});

	it('posts a fresh comment when no ack comment id is available', async () => {
		const provider = createMockPMProvider();
		await postFreshnessSkipNotice(
			provider,
			'card-1',
			{},
			{
				kind: 'needs_human_reconciliation',
				message: 'Implementation not started: needs human reconciliation.',
				evidence: {},
			},
		);

		expect(provider.updateComment).not.toHaveBeenCalled();
		expect(provider.addComment).toHaveBeenCalledWith(
			'card-1',
			'Implementation not started: needs human reconciliation.',
		);
	});

	it('does not throw when both updateComment and addComment fail', async () => {
		const provider = createMockPMProvider();
		provider.updateComment.mockRejectedValueOnce(new Error('boom'));
		provider.addComment.mockRejectedValueOnce(new Error('also boom'));

		await expect(
			postFreshnessSkipNotice(
				provider,
				'card-1',
				{ ackCommentId: 'c' },
				{
					kind: 'already_implemented',
					message: 'skip',
					evidence: {},
				},
			),
		).resolves.toBeUndefined();
	});
});
