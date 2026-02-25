import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/github/client.js', () => ({
	githubClient: {
		updatePRComment: vi.fn(),
	},
}));

vi.mock('../../../src/gadgets/sessionState.js', () => ({
	getSessionState: vi.fn(),
}));

vi.mock('../../../src/config/statusUpdateConfig.js', () => ({
	formatGitHubProgressComment: vi.fn(),
}));

import { GitHubProgressPoster } from '../../../src/backends/progressState/githubPoster.js';
import { formatGitHubProgressComment } from '../../../src/config/statusUpdateConfig.js';
import { getSessionState } from '../../../src/gadgets/sessionState.js';
import { githubClient } from '../../../src/github/client.js';

const mockGithubClient = vi.mocked(githubClient);
const mockGetSessionState = vi.mocked(getSessionState);
const mockFormatGitHubProgressComment = vi.mocked(formatGitHubProgressComment);

function makePoster() {
	return new GitHubProgressPoster({
		owner: 'myorg',
		repo: 'myrepo',
		headerMessage: '**🧑‍💻 Implementation Update**',
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
		await poster.update('summary', 3, 20, 'implementation');

		expect(mockGithubClient.updatePRComment).not.toHaveBeenCalled();
	});

	it('formats and updates PR comment when initialCommentId exists', async () => {
		mockGetSessionState.mockReturnValue({
			agentType: 'implementation',
			prCreated: false,
			prUrl: null,
			reviewSubmitted: false,
			reviewUrl: null,
			initialCommentId: 99,
		});
		mockFormatGitHubProgressComment.mockReturnValue('Header\n\n📋 Old todo section\n\nFooter');
		mockGithubClient.updatePRComment.mockResolvedValue(undefined as never);

		const poster = makePoster();
		await poster.update('AI-generated summary', 5, 20, 'implementation');

		expect(mockFormatGitHubProgressComment).toHaveBeenCalledWith(
			'**🧑‍💻 Implementation Update**',
			5,
			20,
			'implementation',
		);
		expect(mockGithubClient.updatePRComment).toHaveBeenCalledWith(
			'myorg',
			'myrepo',
			99,
			expect.stringContaining('AI-generated summary'),
		);
	});

	it('replaces the todo section with the AI summary', async () => {
		mockGetSessionState.mockReturnValue({
			agentType: 'implementation',
			prCreated: false,
			prUrl: null,
			reviewSubmitted: false,
			reviewUrl: null,
			initialCommentId: 42,
		});
		// The format includes a todo section matching \n\n📋[\s\S]*?\n\n
		mockFormatGitHubProgressComment.mockReturnValue(
			'Header text\n\n📋 Todo item 1\nTodo item 2\n\nFooter text',
		);
		mockGithubClient.updatePRComment.mockResolvedValue(undefined as never);

		const poster = makePoster();
		await poster.update('My AI summary', 2, 10, 'review');

		const callArg = mockGithubClient.updatePRComment.mock.calls[0][3];
		expect(callArg).toContain('My AI summary');
		expect(callArg).not.toContain('📋 Todo item');
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
		mockFormatGitHubProgressComment.mockReturnValue('body');
		mockGithubClient.updatePRComment.mockResolvedValue(undefined as never);

		const poster = new GitHubProgressPoster({
			owner: 'o',
			repo: 'r',
			headerMessage: 'Header',
			logWriter,
		});
		await poster.update('summary', 1, 5, 'review');

		expect(logWriter).toHaveBeenCalledWith(
			'INFO',
			'Updated GitHub PR comment with progress',
			expect.objectContaining({ commentId: 7 }),
		);
	});
});
