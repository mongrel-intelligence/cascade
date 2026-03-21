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

	it('returns "Reply posted successfully" with URL on success', async () => {
		mockGithub.replyToReviewComment.mockResolvedValue({
			htmlUrl: 'https://github.com/owner/repo/pull/42#discussion_r999',
		} as Awaited<ReturnType<typeof mockGithub.replyToReviewComment>>);

		const result = await replyToReviewComment('owner', 'repo', 42, 101, 'Looks good!');

		expect(result).toBe(
			'Reply posted successfully: https://github.com/owner/repo/pull/42#discussion_r999',
		);
		expect(mockGithub.replyToReviewComment).toHaveBeenCalledWith(
			'owner',
			'repo',
			42,
			101,
			'Looks good!',
		);
	});

	it('returns error message string when githubClient throws', async () => {
		mockGithub.replyToReviewComment.mockRejectedValue(new Error('Unprocessable Entity'));

		const result = await replyToReviewComment('owner', 'repo', 42, 101, 'My reply');

		expect(result).toBe('Error replying to comment: Unprocessable Entity');
	});
});
