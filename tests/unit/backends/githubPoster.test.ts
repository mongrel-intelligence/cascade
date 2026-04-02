import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/github/client.js', () => ({
	githubClient: {
		updatePRComment: vi.fn(),
	},
}));

vi.mock('../../../src/gadgets/sessionState.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../src/gadgets/sessionState.js')>();
	return {
		...actual,
		getSessionState: vi.fn(),
	};
});

import { GitHubProgressPoster } from '../../../src/backends/progressState/githubPoster.js';
import { getSessionState } from '../../../src/gadgets/sessionState.js';
import { githubClient } from '../../../src/github/client.js';

const mockGithubClient = vi.mocked(githubClient);
const mockGetSessionState = vi.mocked(getSessionState);

function makePoster() {
	return new GitHubProgressPoster({
		owner: 'myorg',
		repo: 'myrepo',
		logWriter: vi.fn(),
	});
}

describe('GitHubProgressPoster — update()', () => {
	it('does nothing when there is no initialCommentId in session state', async () => {
		mockGetSessionState.mockReturnValue({
			agentType: 'implementation',
			prCreated: false,
			prUrl: null,
			reviewSubmitted: false,
			reviewUrl: null,
			initialCommentId: null,
		});

		const poster = makePoster();
		await poster.update('summary');

		expect(mockGithubClient.updatePRComment).not.toHaveBeenCalled();
	});

	it('uses summary as full comment body when initialCommentId exists', async () => {
		mockGetSessionState.mockReturnValue({
			agentType: 'implementation',
			prCreated: false,
			prUrl: null,
			reviewSubmitted: false,
			reviewUrl: null,
			initialCommentId: 99,
		});
		mockGithubClient.updatePRComment.mockResolvedValue(undefined as never);

		const poster = makePoster();
		await poster.update('AI-generated summary');

		expect(mockGithubClient.updatePRComment).toHaveBeenCalledWith(
			'myorg',
			'myrepo',
			99,
			'AI-generated summary',
		);
	});

	it('replaces entire comment body with the AI summary (no header or separator)', async () => {
		mockGetSessionState.mockReturnValue({
			agentType: 'implementation',
			prCreated: false,
			prUrl: null,
			reviewSubmitted: false,
			reviewUrl: null,
			initialCommentId: 42,
		});
		mockGithubClient.updatePRComment.mockResolvedValue(undefined as never);

		const poster = makePoster();
		await poster.update('My AI summary');

		const callArg = mockGithubClient.updatePRComment.mock.calls[0][3];
		expect(callArg).toBe('My AI summary');
		expect(callArg).not.toContain('---');
	});

	it('logs success after updating comment', async () => {
		const logWriter = vi.fn();
		mockGetSessionState.mockReturnValue({
			agentType: 'review',
			prCreated: false,
			prUrl: null,
			reviewSubmitted: false,
			reviewUrl: null,
			initialCommentId: 7,
		});
		mockGithubClient.updatePRComment.mockResolvedValue(undefined as never);

		const poster = new GitHubProgressPoster({
			owner: 'o',
			repo: 'r',
			logWriter,
		});
		await poster.update('summary');

		expect(logWriter).toHaveBeenCalledWith(
			'INFO',
			'Updated GitHub PR comment with progress',
			expect.objectContaining({ commentId: 7 }),
		);
	});
});
