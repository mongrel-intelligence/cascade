import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/github/client.js', () => ({
	githubClient: {
		getPR: vi.fn(),
		getPRDiff: vi.fn(),
		getCheckSuiteStatus: vi.fn(),
		getPRReviewComments: vi.fn(),
		createPRComment: vi.fn(),
		updatePRComment: vi.fn(),
		replyToReviewComment: vi.fn(),
		createPRReview: vi.fn(),
	},
}));

import { createPRReview } from '../../../../../src/gadgets/github/core/createPRReview.js';
import {
	formatCheckStatus,
	getPRChecks,
} from '../../../../../src/gadgets/github/core/getPRChecks.js';
import { getPRComments } from '../../../../../src/gadgets/github/core/getPRComments.js';
import { getPRDetails } from '../../../../../src/gadgets/github/core/getPRDetails.js';
import { getPRDiff } from '../../../../../src/gadgets/github/core/getPRDiff.js';
import { postPRComment } from '../../../../../src/gadgets/github/core/postPRComment.js';
import { replyToReviewComment } from '../../../../../src/gadgets/github/core/replyToReviewComment.js';
import { updatePRComment } from '../../../../../src/gadgets/github/core/updatePRComment.js';
import { githubClient } from '../../../../../src/github/client.js';

const mockGithub = vi.mocked(githubClient);

beforeEach(() => {
	vi.clearAllMocks();
});

describe('getPRDetails', () => {
	it('formats PR with number, title, state, branches, URL', async () => {
		mockGithub.getPR.mockResolvedValue({
			number: 42,
			title: 'Add feature',
			state: 'open',
			headRef: 'feat',
			baseRef: 'main',
			htmlUrl: 'https://github.com/o/r/pull/42',
			body: 'PR description',
		} as Awaited<ReturnType<typeof mockGithub.getPR>>);

		const result = await getPRDetails('o', 'r', 42);

		expect(result).toContain('PR #42: Add feature');
		expect(result).toContain('State: open');
		expect(result).toContain('Branch: feat -> main');
		expect(result).toContain('https://github.com/o/r/pull/42');
		expect(result).toContain('PR description');
	});

	it('shows "(no description)" when body empty', async () => {
		mockGithub.getPR.mockResolvedValue({
			number: 1,
			title: 'Test',
			state: 'open',
			headRef: 'feat',
			baseRef: 'main',
			htmlUrl: 'https://github.com/o/r/pull/1',
			body: '',
		} as Awaited<ReturnType<typeof mockGithub.getPR>>);

		const result = await getPRDetails('o', 'r', 1);

		expect(result).toContain('(no description)');
	});

	it('returns error on failure', async () => {
		mockGithub.getPR.mockRejectedValue(new Error('Not Found'));

		const result = await getPRDetails('o', 'r', 999);

		expect(result).toBe('Error fetching PR details: Not Found');
	});
});

describe('getPRDiff', () => {
	it('formats files with patch in diff block', async () => {
		mockGithub.getPRDiff.mockResolvedValue([
			{
				filename: 'src/index.ts',
				status: 'modified',
				additions: 5,
				deletions: 2,
				patch: '+ new line\n- old line',
			},
		] as Awaited<ReturnType<typeof mockGithub.getPRDiff>>);

		const result = await getPRDiff('o', 'r', 1);

		expect(result).toContain('1 file(s) changed');
		expect(result).toContain('## src/index.ts');
		expect(result).toContain('+5 -2');
		expect(result).toContain('```diff');
		expect(result).toContain('+ new line');
	});

	it('shows placeholder for binary/large files', async () => {
		mockGithub.getPRDiff.mockResolvedValue([
			{
				filename: 'image.png',
				status: 'added',
				additions: 0,
				deletions: 0,
				patch: undefined,
			},
		] as Awaited<ReturnType<typeof mockGithub.getPRDiff>>);

		const result = await getPRDiff('o', 'r', 1);

		expect(result).toContain('[Binary file or too large to display]');
	});

	it('returns message when no files changed', async () => {
		mockGithub.getPRDiff.mockResolvedValue([]);

		const result = await getPRDiff('o', 'r', 1);

		expect(result).toBe('No files changed in this PR.');
	});

	it('returns error on failure', async () => {
		mockGithub.getPRDiff.mockRejectedValue(new Error('timeout'));

		const result = await getPRDiff('o', 'r', 1);

		expect(result).toBe('Error fetching PR diff: timeout');
	});
});

describe('formatCheckStatus', () => {
	it('returns special message for zero checks', () => {
		const result = formatCheckStatus(1, {
			totalCount: 0,
			checkRuns: [],
			allPassing: true,
		});

		expect(result).toContain('No CI checks configured');
	});

	it('counts passing checks (success + skipped)', () => {
		const result = formatCheckStatus(1, {
			totalCount: 3,
			checkRuns: [
				{ name: 'lint', status: 'completed', conclusion: 'success' },
				{ name: 'test', status: 'completed', conclusion: 'skipped' },
				{ name: 'build', status: 'completed', conclusion: 'failure' },
			],
			allPassing: false,
		});

		expect(result).toContain('2/3');
	});

	it('uses correct icons for each status', () => {
		const result = formatCheckStatus(1, {
			totalCount: 7,
			checkRuns: [
				{ name: 'success', status: 'completed', conclusion: 'success' },
				{ name: 'skipped', status: 'completed', conclusion: 'skipped' },
				{ name: 'neutral', status: 'completed', conclusion: 'neutral' },
				{ name: 'failure', status: 'completed', conclusion: 'failure' },
				{ name: 'timed_out', status: 'completed', conclusion: 'timed_out' },
				{ name: 'in_progress', status: 'in_progress', conclusion: null },
				{ name: 'queued', status: 'queued', conclusion: null },
			],
			allPassing: false,
		});

		expect(result).toContain('✓ success');
		expect(result).toContain('✓ skipped');
		expect(result).toContain('✓ neutral');
		expect(result).toContain('✗ failure');
		expect(result).toContain('✗ timed_out');
		expect(result).toContain('⏳ in_progress');
		expect(result).toContain('⏸ queued');
	});

	it('uses cancel icon for cancelled', () => {
		const result = formatCheckStatus(1, {
			totalCount: 1,
			checkRuns: [{ name: 'deploy', status: 'completed', conclusion: 'cancelled' }],
			allPassing: false,
		});

		expect(result).toContain('⊘ deploy');
	});
});

describe('getPRChecks', () => {
	it('fetches PR then check suite and formats', async () => {
		mockGithub.getPR.mockResolvedValue({
			headSha: 'abc123',
		} as Awaited<ReturnType<typeof mockGithub.getPR>>);
		mockGithub.getCheckSuiteStatus.mockResolvedValue({
			totalCount: 1,
			checkRuns: [{ name: 'test', status: 'completed', conclusion: 'success' }],
			allPassing: true,
		});

		const result = await getPRChecks('o', 'r', 1);

		expect(mockGithub.getPR).toHaveBeenCalledWith('o', 'r', 1);
		expect(mockGithub.getCheckSuiteStatus).toHaveBeenCalledWith('o', 'r', 'abc123');
		expect(result).toContain('1/1');
	});

	it('returns error on failure', async () => {
		mockGithub.getPR.mockRejectedValue(new Error('Not Found'));

		const result = await getPRChecks('o', 'r', 999);

		expect(result).toBe('Error fetching PR check status: Not Found');
	});
});

describe('getPRComments', () => {
	it('formats comments with ID, user, file, line, URL', async () => {
		mockGithub.getPRReviewComments.mockResolvedValue([
			{
				id: 100,
				user: { login: 'reviewer' },
				path: 'src/main.ts',
				line: 42,
				htmlUrl: 'https://github.com/o/r/pull/1#comment-100',
				body: 'Fix this',
				inReplyToId: undefined,
			},
		] as Awaited<ReturnType<typeof mockGithub.getPRReviewComments>>);

		const result = await getPRComments('o', 'r', 1);

		expect(result).toContain('Comment #100');
		expect(result).toContain('@reviewer');
		expect(result).toContain('src/main.ts:42');
		expect(result).toContain('Fix this');
	});

	it('includes inReplyToId for replies', async () => {
		mockGithub.getPRReviewComments.mockResolvedValue([
			{
				id: 200,
				user: { login: 'dev' },
				path: 'file.ts',
				line: 10,
				htmlUrl: 'https://github.com/o/r/pull/1#comment-200',
				body: 'Done',
				inReplyToId: 100,
			},
		] as Awaited<ReturnType<typeof mockGithub.getPRReviewComments>>);

		const result = await getPRComments('o', 'r', 1);

		expect(result).toContain('In reply to: #100');
	});

	it('returns message when no comments', async () => {
		mockGithub.getPRReviewComments.mockResolvedValue([]);

		const result = await getPRComments('o', 'r', 1);

		expect(result).toBe('No review comments found on this PR.');
	});

	it('returns error on failure', async () => {
		mockGithub.getPRReviewComments.mockRejectedValue(new Error('Forbidden'));

		const result = await getPRComments('o', 'r', 1);

		expect(result).toBe('Error fetching PR comments: Forbidden');
	});
});

describe('postPRComment', () => {
	it('returns success with comment ID and URL', async () => {
		mockGithub.createPRComment.mockResolvedValue({
			id: 50,
			htmlUrl: 'https://github.com/o/r/pull/1#issuecomment-50',
		} as Awaited<ReturnType<typeof mockGithub.createPRComment>>);

		const result = await postPRComment('o', 'r', 1, 'Nice work!');

		expect(result).toContain('id: 50');
		expect(result).toContain('issuecomment-50');
	});

	it('returns error on failure', async () => {
		mockGithub.createPRComment.mockRejectedValue(new Error('Rate limited'));

		const result = await postPRComment('o', 'r', 1, 'Comment');

		expect(result).toBe('Error posting PR comment: Rate limited');
	});
});

describe('updatePRComment', () => {
	it('returns success with comment ID and URL', async () => {
		mockGithub.updatePRComment.mockResolvedValue({
			id: 50,
			htmlUrl: 'https://github.com/o/r/pull/1#issuecomment-50',
		} as Awaited<ReturnType<typeof mockGithub.updatePRComment>>);

		const result = await updatePRComment('o', 'r', 50, 'Updated content');

		expect(result).toContain('id: 50');
		expect(result).toContain('Comment updated');
	});

	it('returns error on failure', async () => {
		mockGithub.updatePRComment.mockRejectedValue(new Error('Not found'));

		const result = await updatePRComment('o', 'r', 50, 'Content');

		expect(result).toBe('Error updating PR comment: Not found');
	});
});

describe('replyToReviewComment', () => {
	it('returns success with reply URL', async () => {
		mockGithub.replyToReviewComment.mockResolvedValue({
			htmlUrl: 'https://github.com/o/r/pull/1#reply-200',
		} as Awaited<ReturnType<typeof mockGithub.replyToReviewComment>>);

		const result = await replyToReviewComment('o', 'r', 1, 100, 'Acknowledged');

		expect(result).toContain('Reply posted successfully');
		expect(result).toContain('reply-200');
	});

	it('returns error on failure', async () => {
		mockGithub.replyToReviewComment.mockRejectedValue(new Error('Not found'));

		const result = await replyToReviewComment('o', 'r', 1, 100, 'Reply');

		expect(result).toBe('Error replying to comment: Not found');
	});
});

describe('createPRReview', () => {
	it('creates review and returns reviewUrl + event', async () => {
		mockGithub.createPRReview.mockResolvedValue({
			htmlUrl: 'https://github.com/o/r/pull/1#pullrequestreview-300',
		} as Awaited<ReturnType<typeof mockGithub.createPRReview>>);

		const result = await createPRReview({
			owner: 'o',
			repo: 'r',
			prNumber: 1,
			event: 'APPROVE',
			body: 'LGTM',
		});

		expect(result).toEqual({
			reviewUrl: 'https://github.com/o/r/pull/1#pullrequestreview-300',
			event: 'APPROVE',
		});
	});

	it('passes inline comments when provided', async () => {
		mockGithub.createPRReview.mockResolvedValue({
			htmlUrl: 'https://github.com/o/r/pull/1#pullrequestreview-300',
		} as Awaited<ReturnType<typeof mockGithub.createPRReview>>);

		const comments = [{ path: 'file.ts', line: 10, body: 'Fix' }];
		await createPRReview({
			owner: 'o',
			repo: 'r',
			prNumber: 1,
			event: 'REQUEST_CHANGES',
			body: 'Needs work',
			comments,
		});

		expect(mockGithub.createPRReview).toHaveBeenCalledWith(
			'o',
			'r',
			1,
			'REQUEST_CHANGES',
			'Needs work',
			comments,
		);
	});

	it('throws on failure (no try/catch)', async () => {
		mockGithub.createPRReview.mockRejectedValue(new Error('Forbidden'));

		await expect(
			createPRReview({
				owner: 'o',
				repo: 'r',
				prNumber: 1,
				event: 'APPROVE',
				body: 'ok',
			}),
		).rejects.toThrow('Forbidden');
	});
});
