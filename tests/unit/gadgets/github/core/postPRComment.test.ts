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

	it('returns a structured PostPRCommentResult on success (no run link footer)', async () => {
		mockBuildRunLinkFooter.mockReturnValue(null);
		mockGithub.createPRComment.mockResolvedValue({
			id: 123,
			htmlUrl: 'https://github.com/owner/repo/pull/42#issuecomment-123',
			body: 'Hello from test',
			createdAt: '2026-05-01T10:00:00Z',
			updatedAt: '2026-05-01T10:00:00Z',
		} as Awaited<ReturnType<typeof mockGithub.createPRComment>>);

		const result = await postPRComment('owner', 'repo', 42, 'Hello from test');

		expect(result).toEqual({
			id: '123',
			status: 'ok',
			updatedAt: '2026-05-01T10:00:00Z',
			url: 'https://github.com/owner/repo/pull/42#issuecomment-123',
			repoFullName: 'owner/repo',
			prNumber: 42,
		});
		expect(mockGithub.createPRComment).toHaveBeenCalledWith('owner', 'repo', 42, 'Hello from test');
	});

	it('appends run link footer to comment body when available', async () => {
		mockBuildRunLinkFooter.mockReturnValue('\n\n[Run details](https://example.com/run/1)');
		mockGithub.createPRComment.mockResolvedValue({
			id: 456,
			htmlUrl: 'https://github.com/owner/repo/pull/42#issuecomment-456',
			body: 'My comment\n\n[Run details](https://example.com/run/1)',
			createdAt: '2026-05-01T10:00:00Z',
			updatedAt: '2026-05-01T10:00:00Z',
		} as Awaited<ReturnType<typeof mockGithub.createPRComment>>);

		const result = await postPRComment('owner', 'repo', 42, 'My comment');

		expect(mockGithub.createPRComment).toHaveBeenCalledWith(
			'owner',
			'repo',
			42,
			'My comment\n\n[Run details](https://example.com/run/1)',
		);
		expect(result).toMatchObject({
			id: '456',
			status: 'ok',
			url: 'https://github.com/owner/repo/pull/42#issuecomment-456',
			repoFullName: 'owner/repo',
			prNumber: 42,
		});
	});

	it('throws when githubClient throws (no prose sentinel)', async () => {
		mockBuildRunLinkFooter.mockReturnValue(null);
		mockGithub.createPRComment.mockRejectedValue(new Error('Forbidden'));

		await expect(postPRComment('owner', 'repo', 42, 'My comment')).rejects.toThrow('Forbidden');
	});

	it('surfaces the GitHub-supplied updatedAt timestamp', async () => {
		mockBuildRunLinkFooter.mockReturnValue(null);
		mockGithub.createPRComment.mockResolvedValue({
			id: 789,
			htmlUrl: 'https://github.com/o/r/pull/1#issuecomment-789',
			body: 'Body',
			createdAt: '2025-12-01T01:02:03Z',
			updatedAt: '2025-12-01T01:02:03Z',
		} as Awaited<ReturnType<typeof mockGithub.createPRComment>>);

		const result = await postPRComment('o', 'r', 1, 'Body');

		expect(result.updatedAt).toBe('2025-12-01T01:02:03Z');
	});
});
