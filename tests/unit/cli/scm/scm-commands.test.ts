/**
 * Unit tests for SCM CLI commands.
 *
 * Tests the CLI → core function wiring for:
 * - get-pr-details
 * - get-pr-diff
 * - get-pr-checks
 * - get-pr-comments
 * - get-ci-run-logs
 * - post-pr-comment (owner/repo auto-resolution)
 * - reply-to-review-comment
 * - update-pr-comment
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock credential-scoping dependencies
// ---------------------------------------------------------------------------
vi.mock('../../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn((_token: string, fn: () => Promise<void>) => fn()),
}));
vi.mock('../../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn(
		(_creds: { apiKey: string; token: string }, fn: () => Promise<void>) => fn(),
	),
}));
vi.mock('../../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn(
		(_creds: { email: string; apiToken: string; baseUrl: string }, fn: () => Promise<void>) => fn(),
	),
}));
vi.mock('../../../../src/pm/index.js', () => ({
	createPMProvider: vi.fn(() => ({})),
	withPMProvider: vi.fn((_provider: unknown, fn: () => Promise<void>) => fn()),
}));

// ---------------------------------------------------------------------------
// Mock all SCM gadget core functions
// ---------------------------------------------------------------------------
vi.mock('../../../../src/gadgets/github/core/getPRDetails.js', () => ({
	getPRDetails: vi.fn().mockResolvedValue({ number: 42, title: 'My PR' }),
}));
vi.mock('../../../../src/gadgets/github/core/getPRDiff.js', () => ({
	getPRDiff: vi.fn().mockResolvedValue([{ filename: 'src/foo.ts', additions: 5 }]),
}));
vi.mock('../../../../src/gadgets/github/core/getPRChecks.js', () => ({
	getPRChecks: vi.fn().mockResolvedValue([{ name: 'CI', status: 'completed' }]),
}));
vi.mock('../../../../src/gadgets/github/core/getPRComments.js', () => ({
	getPRComments: vi.fn().mockResolvedValue([{ id: 1, body: 'Nice work' }]),
}));
vi.mock('../../../../src/gadgets/github/core/getCIRunLogs.js', () => ({
	getCIRunLogs: vi.fn().mockResolvedValue({ failedJobs: [] }),
}));
vi.mock('../../../../src/gadgets/github/core/postPRComment.js', () => ({
	postPRComment: vi.fn().mockResolvedValue({ id: 100 }),
}));
vi.mock('../../../../src/gadgets/github/core/replyToReviewComment.js', () => ({
	replyToReviewComment: vi.fn().mockResolvedValue({ id: 200 }),
}));
vi.mock('../../../../src/gadgets/github/core/updatePRComment.js', () => ({
	updatePRComment: vi.fn().mockResolvedValue({ id: 300, body: 'Updated' }),
}));

import GetCIRunLogs from '../../../../src/cli/scm/get-ci-run-logs.js';
import GetPRChecks from '../../../../src/cli/scm/get-pr-checks.js';
import GetPRComments from '../../../../src/cli/scm/get-pr-comments.js';
import GetPRDetails from '../../../../src/cli/scm/get-pr-details.js';
import GetPRDiff from '../../../../src/cli/scm/get-pr-diff.js';
import PostPRComment from '../../../../src/cli/scm/post-pr-comment.js';
import ReplyToReviewComment from '../../../../src/cli/scm/reply-to-review-comment.js';
import UpdatePRComment from '../../../../src/cli/scm/update-pr-comment.js';
import { getCIRunLogs } from '../../../../src/gadgets/github/core/getCIRunLogs.js';
import { getPRChecks } from '../../../../src/gadgets/github/core/getPRChecks.js';
import { getPRComments } from '../../../../src/gadgets/github/core/getPRComments.js';
import { getPRDetails } from '../../../../src/gadgets/github/core/getPRDetails.js';
import { getPRDiff } from '../../../../src/gadgets/github/core/getPRDiff.js';
import { postPRComment } from '../../../../src/gadgets/github/core/postPRComment.js';
import { replyToReviewComment } from '../../../../src/gadgets/github/core/replyToReviewComment.js';
import { updatePRComment } from '../../../../src/gadgets/github/core/updatePRComment.js';

/** Create a fresh minimal oclif config to satisfy this.parse() in each test */
function makeMockConfig() {
	return { runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }) };
}

const originalEnv = process.env;

beforeEach(() => {
	// Set env vars for owner/repo auto-resolution in each test
	process.env = {
		...originalEnv,
		CASCADE_REPO_OWNER: 'owner',
		CASCADE_REPO_NAME: 'repo',
	};
});

afterEach(() => {
	process.env = originalEnv;
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// get-pr-details
// ---------------------------------------------------------------------------
describe('GetPRDetails command', () => {
	it('passes owner, repo, prNumber to getPRDetails', async () => {
		const cmd = new GetPRDetails(['--prNumber', '42'], makeMockConfig() as never);
		await cmd.run();

		expect(getPRDetails).toHaveBeenCalledWith('owner', 'repo', 42);
	});

	it('resolves owner/repo from CASCADE_REPO_OWNER/CASCADE_REPO_NAME env vars', async () => {
		process.env.CASCADE_REPO_OWNER = 'my-org';
		process.env.CASCADE_REPO_NAME = 'my-repo';
		const cmd = new GetPRDetails(['--prNumber', '10'], makeMockConfig() as never);
		await cmd.run();

		expect(getPRDetails).toHaveBeenCalledWith('my-org', 'my-repo', 10);
	});

	it('outputs JSON success result', async () => {
		vi.mocked(getPRDetails).mockResolvedValue({ number: 42, title: 'Test PR' } as never);
		const cmd = new GetPRDetails(['--prNumber', '42'], makeMockConfig() as never);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(true);
		expect(output.data).toEqual({ number: 42, title: 'Test PR' });
	});
});

// ---------------------------------------------------------------------------
// get-pr-diff
// ---------------------------------------------------------------------------
describe('GetPRDiff command', () => {
	it('passes owner, repo, prNumber to getPRDiff', async () => {
		const cmd = new GetPRDiff(['--prNumber', '15'], makeMockConfig() as never);
		await cmd.run();

		expect(getPRDiff).toHaveBeenCalledWith('owner', 'repo', 15);
	});

	it('resolves owner/repo from env vars', async () => {
		process.env.CASCADE_REPO_OWNER = 'acme';
		process.env.CASCADE_REPO_NAME = 'webapp';
		const cmd = new GetPRDiff(['--prNumber', '99'], makeMockConfig() as never);
		await cmd.run();

		expect(getPRDiff).toHaveBeenCalledWith('acme', 'webapp', 99);
	});

	it('outputs JSON success result', async () => {
		vi.mocked(getPRDiff).mockResolvedValue([{ filename: 'test.ts' }] as never);
		const cmd = new GetPRDiff(['--prNumber', '15'], makeMockConfig() as never);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// get-pr-checks
// ---------------------------------------------------------------------------
describe('GetPRChecks command', () => {
	it('passes owner, repo, prNumber to getPRChecks', async () => {
		const cmd = new GetPRChecks(['--prNumber', '7'], makeMockConfig() as never);
		await cmd.run();

		expect(getPRChecks).toHaveBeenCalledWith('owner', 'repo', 7);
	});

	it('resolves owner/repo from env vars', async () => {
		process.env.CASCADE_REPO_OWNER = 'org-x';
		process.env.CASCADE_REPO_NAME = 'project-y';
		const cmd = new GetPRChecks(['--prNumber', '21'], makeMockConfig() as never);
		await cmd.run();

		expect(getPRChecks).toHaveBeenCalledWith('org-x', 'project-y', 21);
	});

	it('outputs JSON success result', async () => {
		vi.mocked(getPRChecks).mockResolvedValue([{ name: 'CI', conclusion: 'success' }] as never);
		const cmd = new GetPRChecks(['--prNumber', '7'], makeMockConfig() as never);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(true);
		expect(output.data).toEqual([{ name: 'CI', conclusion: 'success' }]);
	});
});

// ---------------------------------------------------------------------------
// get-pr-comments
// ---------------------------------------------------------------------------
describe('GetPRComments command', () => {
	it('passes owner, repo, prNumber to getPRComments', async () => {
		const cmd = new GetPRComments(['--prNumber', '33'], makeMockConfig() as never);
		await cmd.run();

		expect(getPRComments).toHaveBeenCalledWith('owner', 'repo', 33);
	});

	it('resolves owner/repo from env vars', async () => {
		process.env.CASCADE_REPO_OWNER = 'company';
		process.env.CASCADE_REPO_NAME = 'app';
		const cmd = new GetPRComments(['--prNumber', '5'], makeMockConfig() as never);
		await cmd.run();

		expect(getPRComments).toHaveBeenCalledWith('company', 'app', 5);
	});

	it('outputs JSON success result', async () => {
		vi.mocked(getPRComments).mockResolvedValue([{ id: 1, body: 'LGTM' }] as never);
		const cmd = new GetPRComments(['--prNumber', '33'], makeMockConfig() as never);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// get-ci-run-logs
// ---------------------------------------------------------------------------
describe('GetCIRunLogs command', () => {
	it('passes owner, repo, ref to getCIRunLogs', async () => {
		const cmd = new GetCIRunLogs(['--ref', 'abc1234567890def'], makeMockConfig() as never);
		await cmd.run();

		expect(getCIRunLogs).toHaveBeenCalledWith('owner', 'repo', 'abc1234567890def');
	});

	it('resolves owner/repo from env vars', async () => {
		process.env.CASCADE_REPO_OWNER = 'my-user';
		process.env.CASCADE_REPO_NAME = 'my-project';
		const cmd = new GetCIRunLogs(['--ref', 'deadbeef'], makeMockConfig() as never);
		await cmd.run();

		expect(getCIRunLogs).toHaveBeenCalledWith('my-user', 'my-project', 'deadbeef');
	});

	it('outputs JSON success result', async () => {
		vi.mocked(getCIRunLogs).mockResolvedValue({ failedJobs: ['unit-tests'] } as never);
		const cmd = new GetCIRunLogs(['--ref', 'abc123'], makeMockConfig() as never);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(true);
		expect(output.data).toEqual({ failedJobs: ['unit-tests'] });
	});
});

// ---------------------------------------------------------------------------
// post-pr-comment (owner/repo auto-resolution)
// ---------------------------------------------------------------------------
describe('PostPRComment command — owner/repo auto-resolution', () => {
	it('resolves owner/repo from CASCADE_REPO_OWNER/CASCADE_REPO_NAME env vars', async () => {
		process.env.CASCADE_REPO_OWNER = 'env-owner';
		process.env.CASCADE_REPO_NAME = 'env-repo';
		const cmd = new PostPRComment(
			['--prNumber', '42', '--body', 'Test comment'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(postPRComment).toHaveBeenCalledWith('env-owner', 'env-repo', 42, 'Test comment');
	});

	it('passes prNumber and body to postPRComment', async () => {
		const cmd = new PostPRComment(
			['--prNumber', '7', '--body', 'Working on it...'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(postPRComment).toHaveBeenCalledWith('owner', 'repo', 7, 'Working on it...');
	});

	it('outputs JSON success result', async () => {
		vi.mocked(postPRComment).mockResolvedValue({ id: 999 } as never);
		const cmd = new PostPRComment(
			['--prNumber', '42', '--body', 'Done!'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(true);
		expect(output.data).toEqual({ id: 999 });
	});
});

// ---------------------------------------------------------------------------
// reply-to-review-comment
// ---------------------------------------------------------------------------
describe('ReplyToReviewComment command', () => {
	it('passes owner, repo, prNumber, commentId, body to replyToReviewComment', async () => {
		const cmd = new ReplyToReviewComment(
			['--prNumber', '42', '--commentId', '123456', '--body', 'Fixed the issue'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(replyToReviewComment).toHaveBeenCalledWith(
			'owner',
			'repo',
			42,
			123456,
			'Fixed the issue',
		);
	});

	it('resolves owner/repo from env vars', async () => {
		process.env.CASCADE_REPO_OWNER = 'acme-org';
		process.env.CASCADE_REPO_NAME = 'acme-app';
		const cmd = new ReplyToReviewComment(
			['--prNumber', '10', '--commentId', '9876', '--body', 'Thanks for the feedback'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(replyToReviewComment).toHaveBeenCalledWith(
			'acme-org',
			'acme-app',
			10,
			9876,
			'Thanks for the feedback',
		);
	});

	it('outputs JSON success result', async () => {
		vi.mocked(replyToReviewComment).mockResolvedValue({ id: 77 } as never);
		const cmd = new ReplyToReviewComment(
			['--prNumber', '42', '--commentId', '123', '--body', 'Fixed!'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(true);
		expect(output.data).toEqual({ id: 77 });
	});
});

// ---------------------------------------------------------------------------
// update-pr-comment
// ---------------------------------------------------------------------------
describe('UpdatePRComment command', () => {
	it('passes owner, repo, commentId, body to updatePRComment', async () => {
		const cmd = new UpdatePRComment(
			['--commentId', '111222333', '--body', 'Updated comment body'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(updatePRComment).toHaveBeenCalledWith(
			'owner',
			'repo',
			111222333,
			'Updated comment body',
		);
	});

	it('resolves owner/repo from env vars', async () => {
		process.env.CASCADE_REPO_OWNER = 'big-co';
		process.env.CASCADE_REPO_NAME = 'platform';
		const cmd = new UpdatePRComment(
			['--commentId', '555', '--body', 'New content'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(updatePRComment).toHaveBeenCalledWith('big-co', 'platform', 555, 'New content');
	});

	it('outputs JSON success result', async () => {
		vi.mocked(updatePRComment).mockResolvedValue({ id: 555, body: 'New content' } as never);
		const cmd = new UpdatePRComment(
			['--commentId', '555', '--body', 'New content'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(true);
		expect(output.data).toEqual({ id: 555, body: 'New content' });
	});
});
