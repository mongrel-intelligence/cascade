import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/github/client.js', () => ({
	githubClient: {
		replyToReviewComment: vi.fn(),
	},
}));

import { replyToReviewComment } from '../../../../../src/gadgets/github/core/replyToReviewComment.js';
import { githubClient } from '../../../../../src/github/client.js';

const mockGithub = vi.mocked(githubClient);

describe('replyToReviewComment', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns a structured ReplyToReviewCommentResult on success', async () => {
		mockGithub.replyToReviewComment.mockResolvedValue({
			id: 999,
			body: 'Looks good!',
			path: 'src/index.ts',
			line: 5,
			htmlUrl: 'https://github.com/owner/repo/pull/42#discussion_r999',
			user: { login: 'bot' },
			createdAt: '2026-05-01T10:00:00Z',
			updatedAt: '2026-05-01T10:00:00Z',
			inReplyToId: 101,
		} as Awaited<ReturnType<typeof mockGithub.replyToReviewComment>>);

		const result = await replyToReviewComment('owner', 'repo', 42, 101, 'Looks good!');

		expect(result).toEqual({
			id: '999',
			status: 'ok',
			updatedAt: '2026-05-01T10:00:00Z',
			url: 'https://github.com/owner/repo/pull/42#discussion_r999',
			repoFullName: 'owner/repo',
			prNumber: 42,
		});
		expect(mockGithub.replyToReviewComment).toHaveBeenCalledWith(
			'owner',
			'repo',
			42,
			101,
			'Looks good!',
		);
	});

	it('throws when githubClient throws (no prose sentinel)', async () => {
		mockGithub.replyToReviewComment.mockRejectedValue(new Error('Unprocessable Entity'));

		await expect(replyToReviewComment('owner', 'repo', 42, 101, 'My reply')).rejects.toThrow(
			'Unprocessable Entity',
		);
	});

	it('falls back to createdAt when updatedAt is missing', async () => {
		mockGithub.replyToReviewComment.mockResolvedValue({
			id: 1010,
			body: 'My reply',
			path: 'src/index.ts',
			line: 1,
			htmlUrl: 'https://github.com/owner/repo/pull/42#discussion_r1010',
			user: { login: 'bot' },
			createdAt: '2026-04-01T10:00:00Z',
			// updatedAt deliberately omitted to simulate the rare Octokit response shape
			inReplyToId: 200,
		} as Awaited<ReturnType<typeof mockGithub.replyToReviewComment>>);

		const result = await replyToReviewComment('owner', 'repo', 42, 200, 'My reply');

		expect(result.updatedAt).toBe('2026-04-01T10:00:00Z');
	});
});
