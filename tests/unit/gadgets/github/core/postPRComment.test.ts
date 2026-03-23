import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/github/client.js', () => ({
	githubClient: {
		createPRComment: vi.fn(),
	},
}));

vi.mock('../../../../../src/utils/runLink.js', () => ({
	buildRunLinkFooterFromEnv: vi.fn(),
}));

import { postPRComment } from '../../../../../src/gadgets/github/core/postPRComment.js';
import { githubClient } from '../../../../../src/github/client.js';
import { buildRunLinkFooterFromEnv } from '../../../../../src/utils/runLink.js';

const mockGithub = vi.mocked(githubClient);
const mockBuildRunLinkFooter = vi.mocked(buildRunLinkFooterFromEnv);

describe('postPRComment', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns "Comment posted" with id and URL on success (no run link footer)', async () => {
		mockBuildRunLinkFooter.mockReturnValue(null);
		mockGithub.createPRComment.mockResolvedValue({
			id: 123,
			htmlUrl: 'https://github.com/owner/repo/pull/42#issuecomment-123',
		} as Awaited<ReturnType<typeof mockGithub.createPRComment>>);

		const result = await postPRComment('owner', 'repo', 42, 'Hello from test');

		expect(result).toBe(
			'Comment posted (id: 123): https://github.com/owner/repo/pull/42#issuecomment-123',
		);
		expect(mockGithub.createPRComment).toHaveBeenCalledWith('owner', 'repo', 42, 'Hello from test');
	});

	it('appends run link footer to comment body when available', async () => {
		mockBuildRunLinkFooter.mockReturnValue('\n\n[Run details](https://example.com/run/1)');
		mockGithub.createPRComment.mockResolvedValue({
			id: 456,
			htmlUrl: 'https://github.com/owner/repo/pull/42#issuecomment-456',
		} as Awaited<ReturnType<typeof mockGithub.createPRComment>>);

		const result = await postPRComment('owner', 'repo', 42, 'My comment');

		expect(mockGithub.createPRComment).toHaveBeenCalledWith(
			'owner',
			'repo',
			42,
			'My comment\n\n[Run details](https://example.com/run/1)',
		);
		expect(result).toBe(
			'Comment posted (id: 456): https://github.com/owner/repo/pull/42#issuecomment-456',
		);
	});

	it('returns error message string when githubClient throws', async () => {
		mockBuildRunLinkFooter.mockReturnValue(null);
		mockGithub.createPRComment.mockRejectedValue(new Error('Forbidden'));

		const result = await postPRComment('owner', 'repo', 42, 'My comment');

		expect(result).toBe('Error posting PR comment: Forbidden');
	});
});
