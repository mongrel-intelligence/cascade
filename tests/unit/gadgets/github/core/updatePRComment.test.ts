import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/github/client.js', () => ({
	githubClient: {
		updatePRComment: vi.fn(),
	},
}));

import { updatePRComment } from '../../../../../src/gadgets/github/core/updatePRComment.js';
import { githubClient } from '../../../../../src/github/client.js';

const mockGithub = vi.mocked(githubClient);

describe('updatePRComment', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns a structured UpdatePRCommentResult on success', async () => {
		mockGithub.updatePRComment.mockResolvedValue({
			id: 789,
			htmlUrl: 'https://github.com/owner/repo/pull/42#issuecomment-789',
			body: 'Updated body',
			createdAt: '2026-05-01T10:00:00Z',
			updatedAt: '2026-05-02T11:00:00Z',
		} as Awaited<ReturnType<typeof mockGithub.updatePRComment>>);

		const result = await updatePRComment('owner', 'repo', 789, 'Updated body');

		expect(result).toEqual({
			id: '789',
			status: 'ok',
			updatedAt: '2026-05-02T11:00:00Z',
			url: 'https://github.com/owner/repo/pull/42#issuecomment-789',
			repoFullName: 'owner/repo',
			prNumber: 42,
		});
		expect(mockGithub.updatePRComment).toHaveBeenCalledWith('owner', 'repo', 789, 'Updated body');
	});

	it('throws when githubClient throws (no prose sentinel)', async () => {
		mockGithub.updatePRComment.mockRejectedValue(new Error('Not Found'));

		await expect(updatePRComment('owner', 'repo', 789, 'Updated body')).rejects.toThrow(
			'Not Found',
		);
	});

	it('extracts prNumber from the comment html_url', async () => {
		mockGithub.updatePRComment.mockResolvedValue({
			id: 555,
			htmlUrl: 'https://github.com/big-co/platform/pull/9999#issuecomment-555',
			body: 'New content',
			createdAt: '2026-05-01T10:00:00Z',
			updatedAt: '2026-05-02T11:00:00Z',
		} as Awaited<ReturnType<typeof mockGithub.updatePRComment>>);

		const result = await updatePRComment('big-co', 'platform', 555, 'New content');

		expect(result.prNumber).toBe(9999);
	});

	it('returns prNumber=null when html_url does not match the /pull/ pattern', async () => {
		mockGithub.updatePRComment.mockResolvedValue({
			id: 777,
			htmlUrl: 'https://github.com/owner/repo/issues/42#issuecomment-777',
			body: 'Body',
			createdAt: '2026-05-01T10:00:00Z',
			updatedAt: '2026-05-02T11:00:00Z',
		} as Awaited<ReturnType<typeof mockGithub.updatePRComment>>);

		const result = await updatePRComment('owner', 'repo', 777, 'Body');

		expect(result.prNumber).toBeNull();
	});
});
