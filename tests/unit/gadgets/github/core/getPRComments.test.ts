import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/github/client.js', () => ({
	githubClient: {
		getPRReviewComments: vi.fn(),
	},
}));

import { getPRComments } from '../../../../../src/gadgets/github/core/getPRComments.js';
import { githubClient } from '../../../../../src/github/client.js';

const mockGithub = vi.mocked(githubClient);

function makeComment(overrides: Record<string, unknown> = {}) {
	return {
		id: 1,
		user: { login: 'alice' },
		path: 'src/file.ts',
		line: 42,
		htmlUrl: 'https://github.com/owner/repo/pull/1#discussion_r1',
		inReplyToId: null,
		body: 'This needs to be changed.',
		...overrides,
	};
}

describe('getPRComments', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('returns "no comments" message when there are no review comments', async () => {
		mockGithub.getPRReviewComments.mockResolvedValue(
			[] as Awaited<ReturnType<typeof mockGithub.getPRReviewComments>>,
		);

		const result = await getPRComments('owner', 'repo', 1);

		expect(result).toBe('No review comments found on this PR.');
	});

	it('formats single comment correctly', async () => {
		mockGithub.getPRReviewComments.mockResolvedValue([makeComment()] as Awaited<
			ReturnType<typeof mockGithub.getPRReviewComments>
		>);

		const result = await getPRComments('owner', 'repo', 1);

		expect(result).toContain('Found 1 review comment(s)');
		expect(result).toContain('Comment #1 by @alice');
		expect(result).toContain('File: src/file.ts:42');
		expect(result).toContain('https://github.com/owner/repo/pull/1#discussion_r1');
		expect(result).toContain('This needs to be changed.');
	});

	it('shows multiple comments with count', async () => {
		mockGithub.getPRReviewComments.mockResolvedValue([
			makeComment({ id: 1 }),
			makeComment({ id: 2 }),
		] as Awaited<ReturnType<typeof mockGithub.getPRReviewComments>>);

		const result = await getPRComments('owner', 'repo', 1);

		expect(result).toContain('Found 2 review comment(s)');
	});

	it('omits line from file path when line is falsy', async () => {
		mockGithub.getPRReviewComments.mockResolvedValue([makeComment({ line: null })] as Awaited<
			ReturnType<typeof mockGithub.getPRReviewComments>
		>);

		const result = await getPRComments('owner', 'repo', 1);

		expect(result).toContain('File: src/file.ts');
		expect(result).not.toContain('File: src/file.ts:');
	});

	it('includes "In reply to" when comment is a reply', async () => {
		mockGithub.getPRReviewComments.mockResolvedValue([makeComment({ inReplyToId: 5 })] as Awaited<
			ReturnType<typeof mockGithub.getPRReviewComments>
		>);

		const result = await getPRComments('owner', 'repo', 1);

		expect(result).toContain('In reply to: #5');
	});

	it('omits "In reply to" for top-level comments', async () => {
		mockGithub.getPRReviewComments.mockResolvedValue([
			makeComment({ inReplyToId: null }),
		] as Awaited<ReturnType<typeof mockGithub.getPRReviewComments>>);

		const result = await getPRComments('owner', 'repo', 1);

		expect(result).not.toContain('In reply to:');
	});

	it('returns error message on exception', async () => {
		mockGithub.getPRReviewComments.mockRejectedValue(new Error('API failure'));

		const result = await getPRComments('owner', 'repo', 1);

		expect(result).toBe('Error fetching PR comments: API failure');
	});

	it('handles non-Error thrown values', async () => {
		mockGithub.getPRReviewComments.mockRejectedValue('string error');

		const result = await getPRComments('owner', 'repo', 1);

		expect(result).toBe('Error fetching PR comments: string error');
	});
});
