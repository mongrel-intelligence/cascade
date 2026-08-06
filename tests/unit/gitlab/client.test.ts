import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the @gitbeaker/rest SDK so `new Gitlab(...)` yields our fake API surface.
// vi.fn returning an object makes `new Gitlab()` resolve to that object (a
// constructor that returns an object short-circuits `new`).
const mockApi = {
	MergeRequests: {
		show: vi.fn(),
		allDiffs: vi.fn(),
		all: vi.fn(),
	},
	MergeRequestNotes: {
		all: vi.fn(),
	},
	Pipelines: {
		show: vi.fn(),
		all: vi.fn(),
	},
	Jobs: {
		all: vi.fn(),
	},
	Users: {
		showCurrentUser: vi.fn(),
	},
};

vi.mock('@gitbeaker/rest', () => ({
	Gitlab: vi.fn(() => mockApi),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { gitlabClient, withGitLabToken } from '../../../src/gitlab/client.js';

describe('gitlabClient', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ========================================================================
	// Scope guard
	// ========================================================================

	it('throws when no client is in scope', async () => {
		await expect(gitlabClient.getMR('group/repo', 42)).rejects.toThrow(/No GitLab client in scope/);
	});

	// ========================================================================
	// getMR
	// ========================================================================

	describe('getMR', () => {
		it('fetches and maps MR detail fields from snake_case', async () => {
			mockApi.MergeRequests.show.mockResolvedValue({
				iid: 42,
				title: 'Add GitLab support',
				description: 'A description',
				state: 'opened',
				web_url: 'https://gitlab.com/group/repo/-/merge_requests/42',
				source_branch: 'feature/gitlab',
				target_branch: 'main',
				sha: 'deadbeef',
				has_conflicts: false,
				author: { username: 'alice' },
			});

			const mr = await withGitLabToken('tok', () => gitlabClient.getMR('group/repo', 42));

			expect(mockApi.MergeRequests.show).toHaveBeenCalledWith('group/repo', 42);
			expect(mr).toEqual({
				iid: 42,
				title: 'Add GitLab support',
				description: 'A description',
				state: 'opened',
				webUrl: 'https://gitlab.com/group/repo/-/merge_requests/42',
				sourceBranch: 'feature/gitlab',
				targetBranch: 'main',
				sha: 'deadbeef',
				merged: false,
				hasConflicts: false,
				author: { username: 'alice' },
			});
		});

		it('derives merged=true from state and tolerates missing optional fields', async () => {
			mockApi.MergeRequests.show.mockResolvedValue({
				iid: 7,
				title: 'Merged MR',
				state: 'merged',
				web_url: 'https://gitlab.com/group/repo/-/merge_requests/7',
				source_branch: 'feature/x',
				target_branch: 'main',
				// no description, sha, has_conflicts, author
			});

			const mr = await withGitLabToken('tok', () => gitlabClient.getMR('group/repo', 7));

			expect(mr.merged).toBe(true);
			expect(mr.description).toBeNull();
			expect(mr.sha).toBe('');
			expect(mr.hasConflicts).toBe(false);
			expect(mr.author.username).toBe('unknown');
		});
	});

	// ========================================================================
	// listPipelines
	// ========================================================================

	describe('listPipelines', () => {
		it('lists pipelines for a branch ref and maps fields', async () => {
			mockApi.Pipelines.all.mockResolvedValue([
				{
					id: 100,
					status: 'success',
					ref: 'feature/gitlab',
					sha: 'abc123',
					web_url: 'https://gitlab.com/group/repo/-/pipelines/100',
				},
			]);

			const pipelines = await withGitLabToken('tok', () =>
				gitlabClient.listPipelines('group/repo', 'feature/gitlab'),
			);

			expect(mockApi.Pipelines.all).toHaveBeenCalledTimes(1);
			expect(mockApi.Pipelines.all).toHaveBeenCalledWith(
				'group/repo',
				expect.objectContaining({ ref: 'feature/gitlab' }),
			);
			expect(pipelines).toEqual([
				{
					id: 100,
					status: 'success',
					ref: 'feature/gitlab',
					sha: 'abc123',
					webUrl: 'https://gitlab.com/group/repo/-/pipelines/100',
				},
			]);
		});

		it('falls back to a SHA filter when the branch lookup is empty and ref looks like a SHA', async () => {
			mockApi.Pipelines.all
				.mockResolvedValueOnce([]) // branch lookup empty
				.mockResolvedValueOnce([
					{ id: 200, status: 'failed', ref: 'main', sha: 'deadbeef', web_url: 'https://x/200' },
				]);

			const pipelines = await withGitLabToken('tok', () =>
				gitlabClient.listPipelines('group/repo', 'deadbeef'),
			);

			expect(mockApi.Pipelines.all).toHaveBeenCalledTimes(2);
			expect(mockApi.Pipelines.all).toHaveBeenLastCalledWith(
				'group/repo',
				expect.objectContaining({ sha: 'deadbeef' }),
			);
			expect(pipelines).toHaveLength(1);
			expect(pipelines[0].id).toBe(200);
		});

		it('does not attempt a SHA fallback for a non-SHA ref that returns nothing', async () => {
			mockApi.Pipelines.all.mockResolvedValue([]);

			const pipelines = await withGitLabToken('tok', () =>
				gitlabClient.listPipelines('group/repo', 'feature/not-a-sha'),
			);

			expect(mockApi.Pipelines.all).toHaveBeenCalledTimes(1);
			expect(pipelines).toEqual([]);
		});
	});

	// ========================================================================
	// getFailedPipelineJobs
	// ========================================================================

	describe('getFailedPipelineJobs', () => {
		it('returns only failed jobs alongside the pipeline status', async () => {
			mockApi.Pipelines.show.mockResolvedValue({
				id: 100,
				status: 'failed',
				ref: 'feature/gitlab',
				sha: 'abc123',
				web_url: 'https://gitlab.com/group/repo/-/pipelines/100',
			});
			mockApi.Jobs.all.mockResolvedValue([
				{ id: 1, name: 'build', stage: 'build', status: 'success', web_url: 'https://x/1' },
				{
					id: 2,
					name: 'test',
					stage: 'test',
					status: 'failed',
					web_url: 'https://x/2',
					failure_reason: 'script_failure',
				},
			]);

			const result = await withGitLabToken('tok', () =>
				gitlabClient.getFailedPipelineJobs('group/repo', 100),
			);

			expect(result.pipeline.id).toBe(100);
			expect(result.failedJobs).toHaveLength(1);
			expect(result.failedJobs[0]).toEqual({
				id: 2,
				name: 'test',
				stage: 'test',
				status: 'failed',
				webUrl: 'https://x/2',
				failureReason: 'script_failure',
			});
		});
	});
});
