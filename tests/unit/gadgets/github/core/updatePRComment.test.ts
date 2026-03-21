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

	it('returns "Comment updated" with id and URL on success', async () => {
		mockGithub.updatePRComment.mockResolvedValue({
			id: 789,
			htmlUrl: 'https://github.com/owner/repo/pull/42#issuecomment-789',
		} as Awaited<ReturnType<typeof mockGithub.updatePRComment>>);

		const result = await updatePRComment('owner', 'repo', 789, 'Updated body');

		expect(result).toBe(
			'Comment updated (id: 789): https://github.com/owner/repo/pull/42#issuecomment-789',
		);
		expect(mockGithub.updatePRComment).toHaveBeenCalledWith('owner', 'repo', 789, 'Updated body');
	});

	it('returns error message string when githubClient throws', async () => {
		mockGithub.updatePRComment.mockRejectedValue(new Error('Not Found'));

		const result = await updatePRComment('owner', 'repo', 789, 'Updated body');

		expect(result).toBe('Error updating PR comment: Not Found');
	});
});
