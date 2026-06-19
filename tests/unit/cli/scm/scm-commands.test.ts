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
// CreatePRReview also calls the GitHub client directly to delete the ack
// comment after a successful review submission, so `githubClient.deletePRComment`
// must be defined here for that code path.
vi.mock('../../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn((_token: string, fn: () => Promise<void>) => fn()),
	githubClient: {
		deletePRComment: vi.fn().mockResolvedValue(undefined),
	},
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
vi.mock('../../../../src/gadgets/github/core/createPRReview.js', () => ({
	createPRReview: vi.fn().mockResolvedValue({ id: '400', reviewUrl: 'https://gh/r/400' }),
}));
// Suppress sidecar side effects so the structured-output assertions stay
// focused on the CLI's JSON envelope.
vi.mock('../../../../src/gadgets/session/core/sidecar.js', () => ({
	writeReviewSidecar: vi.fn(() => true),
}));

import CreatePRReview from '../../../../src/cli/scm/create-pr-review.js';
import GetCIRunLogs from '../../../../src/cli/scm/get-ci-run-logs.js';
import GetPRChecks from '../../../../src/cli/scm/get-pr-checks.js';
import GetPRComments from '../../../../src/cli/scm/get-pr-comments.js';
import GetPRDetails from '../../../../src/cli/scm/get-pr-details.js';
import GetPRDiff from '../../../../src/cli/scm/get-pr-diff.js';
import PostPRComment from '../../../../src/cli/scm/post-pr-comment.js';
import ReplyToReviewComment from '../../../../src/cli/scm/reply-to-review-comment.js';
import UpdatePRComment from '../../../../src/cli/scm/update-pr-comment.js';
import { createPRReview } from '../../../../src/gadgets/github/core/createPRReview.js';
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

		expect(getPRDiff).toHaveBeenCalledWith('owner', 'repo', 15, undefined, undefined);
	});

	it('resolves owner/repo from env vars', async () => {
		process.env.CASCADE_REPO_OWNER = 'acme';
		process.env.CASCADE_REPO_NAME = 'webapp';
		const cmd = new GetPRDiff(['--prNumber', '99'], makeMockConfig() as never);
		await cmd.run();

		expect(getPRDiff).toHaveBeenCalledWith('acme', 'webapp', 99, undefined, undefined);
	});

	it('passes optional path to getPRDiff', async () => {
		const cmd = new GetPRDiff(
			['--prNumber', '15', '--path', 'src/old.ts'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(getPRDiff).toHaveBeenCalledWith('owner', 'repo', 15, 'src/old.ts', undefined);
	});

	it('outputs JSON success result', async () => {
		vi.mocked(getPRDiff).mockResolvedValue([{ filename: 'test.ts' }] as never);
		const cmd = new GetPRDiff(['--prNumber', '15'], makeMockConfig() as never);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(true);
	});

	// MNG-1059: --outputFile mode streams the raw multiline diff to disk and
	// returns a compact summary, sidestepping stdout truncation on big diffs.
	it('passes --output-file alias through to getPRDiff', async () => {
		vi.mocked(getPRDiff).mockResolvedValue({
			outputFile: '/tmp/diff.md',
			fileCount: 1,
			bytes: 1234,
		} as never);
		const cmd = new GetPRDiff(
			['--prNumber', '15', '--output-file', '/tmp/diff.md'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		expect(getPRDiff).toHaveBeenCalledWith('owner', 'repo', 15, undefined, '/tmp/diff.md');
		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(true);
		expect(output.data).toEqual({ outputFile: '/tmp/diff.md', fileCount: 1, bytes: 1234 });
	});

	it('passes --outputFile combined with --path to getPRDiff', async () => {
		vi.mocked(getPRDiff).mockResolvedValue({
			outputFile: '/tmp/diff.md',
			fileCount: 1,
			bytes: 50,
			pathFilter: 'src/big.json',
		} as never);
		const cmd = new GetPRDiff(
			['--prNumber', '15', '--path', 'src/big.json', '--outputFile', '/tmp/diff.md'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(getPRDiff).toHaveBeenCalledWith('owner', 'repo', 15, 'src/big.json', '/tmp/diff.md');
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

// ---------------------------------------------------------------------------
// MNG-1425: runtime failure envelopes
//
// The structured-output rewrite of post-pr-comment / update-pr-comment /
// reply-to-review-comment cores throws on GitHub failures rather than
// returning prose sentinel strings. The CLI factory (`createCLICommand`)
// wraps thrown errors in the spec-014 runtime envelope. These tests pin
// that contract per CLI so a regression here surfaces immediately.
// ---------------------------------------------------------------------------
describe('SCM CLI runtime failure envelopes (MNG-1425)', () => {
	function readJsonOutput(logSpy: ReturnType<typeof vi.spyOn>) {
		const lines = logSpy.mock.calls.map((c) => c[0] as string);
		const jsonLine = lines.find((l) => typeof l === 'string' && l.startsWith('{')) ?? '';
		return JSON.parse(jsonLine) as {
			success: boolean;
			error?: { type: string; message: string };
		};
	}

	/**
	 * Runtime failures emit the envelope, then call exit(1). Oclif's exit
	 * surfaces as a thrown EEXIT error from `cmd.run()`, which is the expected
	 * post-envelope shape — we swallow it so we can inspect the envelope.
	 */
	async function runExpectingExit(cmd: { run: () => Promise<void> }): Promise<void> {
		try {
			await cmd.run();
		} catch (err) {
			const status = (err as { oclif?: { exit?: number }; code?: string })?.oclif?.exit;
			const code = (err as { code?: string })?.code;
			if (status === 1 || code === 'EEXIT') return;
			throw err;
		}
	}

	it('PostPRComment surfaces a runtime envelope when postPRComment throws', async () => {
		vi.mocked(postPRComment).mockRejectedValueOnce(new Error('Rate limited'));
		const cmd = new PostPRComment(
			['--prNumber', '42', '--body', 'Hello'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await runExpectingExit(cmd);

		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(false);
		expect(output.error?.type).toBe('runtime');
		expect(output.error?.message).toBe('Rate limited');
	});

	it('UpdatePRComment surfaces a runtime envelope when updatePRComment throws', async () => {
		vi.mocked(updatePRComment).mockRejectedValueOnce(new Error('Not Found'));
		const cmd = new UpdatePRComment(
			['--commentId', '555', '--body', 'New content'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await runExpectingExit(cmd);

		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(false);
		expect(output.error?.type).toBe('runtime');
		expect(output.error?.message).toBe('Not Found');
	});

	it('ReplyToReviewComment surfaces a runtime envelope when replyToReviewComment throws', async () => {
		vi.mocked(replyToReviewComment).mockRejectedValueOnce(new Error('Unprocessable Entity'));
		const cmd = new ReplyToReviewComment(
			['--prNumber', '42', '--commentId', '101', '--body', 'Reply'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await runExpectingExit(cmd);

		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(false);
		expect(output.error?.type).toBe('runtime');
		expect(output.error?.message).toBe('Unprocessable Entity');
	});
});

// ---------------------------------------------------------------------------
// MNG-1428: SCM CLI structured-output regression coverage
//
// Each targeted SCM mutation CLI (post-pr-comment / update-pr-comment /
// reply-to-review-comment / create-pr-review) must serialise the GitHub
// mutation result into the `{ success: true, data: ... }` envelope and carry
// the minimum structured contract — `success.data.id`, `success.data.url`,
// `success.data.status`, `success.data.updatedAt`, plus the PR/repo context
// (`repoFullName`, `prNumber`). These tests parse stdout and pin each field so
// a future renderer drift surfaces in CI rather than silently regressing the
// agent-facing contract.
//
// CreatePRReview also exposes `reviewUrl`, `event`, `submittedAt`, and
// `inlineCommentCount` — pinned here too because review workflows downstream
// consume those keys directly from the structured envelope.
// ---------------------------------------------------------------------------
describe('SCM CLI structured-output contract (MNG-1428)', () => {
	function readJsonOutput(logSpy: ReturnType<typeof vi.spyOn>) {
		const lines = logSpy.mock.calls.map((c) => c[0] as string);
		const jsonLine = lines.find((l) => typeof l === 'string' && l.startsWith('{')) ?? '';
		return JSON.parse(jsonLine) as {
			success: boolean;
			data?: Record<string, unknown>;
			error?: { type: string; message: string };
		};
	}

	/**
	 * Runtime failures emit the envelope, then call exit(1). Oclif's exit
	 * surfaces as a thrown EEXIT error from `cmd.run()`. Mirrors the helper
	 * scoped to the MNG-1425 describe — local copy avoids leaking state.
	 */
	async function runExpectingExit(cmd: { run: () => Promise<void> }): Promise<void> {
		try {
			await cmd.run();
		} catch (err) {
			const status = (err as { oclif?: { exit?: number }; code?: string })?.oclif?.exit;
			const code = (err as { code?: string })?.code;
			if (status === 1 || code === 'EEXIT') return;
			throw err;
		}
	}

	it('PostPRComment stdout exposes id, url, status="ok", updatedAt, repoFullName, prNumber', async () => {
		vi.mocked(postPRComment).mockResolvedValueOnce({
			status: 'ok',
			id: '987654321',
			url: 'https://github.com/owner/repo/pull/42#issuecomment-987654321',
			updatedAt: '2026-06-01T18:00:00.000Z',
			repoFullName: 'owner/repo',
			prNumber: 42,
		} as never);
		const cmd = new PostPRComment(
			['--prNumber', '42', '--body', 'Working on it...'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(true);
		expect(output.data).toMatchObject({
			status: 'ok',
			id: '987654321',
			url: 'https://github.com/owner/repo/pull/42#issuecomment-987654321',
			updatedAt: '2026-06-01T18:00:00.000Z',
			repoFullName: 'owner/repo',
			prNumber: 42,
		});
	});

	it('UpdatePRComment stdout exposes id, url, status, updatedAt, repoFullName, prNumber', async () => {
		vi.mocked(updatePRComment).mockResolvedValueOnce({
			status: 'ok',
			id: '111222333',
			url: 'https://github.com/owner/repo/pull/42#issuecomment-111222333',
			updatedAt: '2026-06-01T18:30:00.000Z',
			repoFullName: 'owner/repo',
			prNumber: 42,
		} as never);
		const cmd = new UpdatePRComment(
			['--commentId', '111222333', '--body', 'Updated'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(true);
		expect(output.data).toMatchObject({
			status: 'ok',
			id: '111222333',
			url: 'https://github.com/owner/repo/pull/42#issuecomment-111222333',
			updatedAt: '2026-06-01T18:30:00.000Z',
			repoFullName: 'owner/repo',
			prNumber: 42,
		});
	});

	it('UpdatePRComment accepts prNumber=null when the comment is not on a PR thread', async () => {
		// The UpdatePRComment contract specifies prNumber as `number | null` —
		// pinned in `updatePRCommentDef.outputShape` — because some issue-only
		// comments don't expose `/pull/<N>` in their html_url. This test makes
		// sure the CLI envelope round-trips that nullable value.
		vi.mocked(updatePRComment).mockResolvedValueOnce({
			status: 'ok',
			id: '111222333',
			url: 'https://github.com/owner/repo/issues/9#issuecomment-111222333',
			updatedAt: '2026-06-01T18:30:00.000Z',
			repoFullName: 'owner/repo',
			prNumber: null,
		} as never);
		const cmd = new UpdatePRComment(
			['--commentId', '111222333', '--body', 'Updated'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(true);
		expect(output.data?.prNumber).toBeNull();
	});

	it('ReplyToReviewComment stdout exposes id, url, status, updatedAt, repoFullName, prNumber', async () => {
		vi.mocked(replyToReviewComment).mockResolvedValueOnce({
			status: 'ok',
			id: '500',
			url: 'https://github.com/owner/repo/pull/42#discussion_r500',
			updatedAt: '2026-06-01T19:00:00.000Z',
			repoFullName: 'owner/repo',
			prNumber: 42,
		} as never);
		const cmd = new ReplyToReviewComment(
			['--prNumber', '42', '--commentId', '12345', '--body', 'Done'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(true);
		expect(output.data).toMatchObject({
			status: 'ok',
			id: '500',
			url: 'https://github.com/owner/repo/pull/42#discussion_r500',
			updatedAt: '2026-06-01T19:00:00.000Z',
			repoFullName: 'owner/repo',
			prNumber: 42,
		});
	});

	it('CreatePRReview stdout exposes id, url, status, updatedAt, repoFullName, prNumber, reviewUrl, event, submittedAt, inlineCommentCount', async () => {
		vi.mocked(createPRReview).mockResolvedValueOnce({
			status: 'ok',
			id: '700',
			url: 'https://github.com/owner/repo/pull/42#pullrequestreview-700',
			updatedAt: '2026-06-01T20:00:00.000Z',
			reviewUrl: 'https://github.com/owner/repo/pull/42#pullrequestreview-700',
			event: 'REQUEST_CHANGES',
			repoFullName: 'owner/repo',
			prNumber: 42,
			submittedAt: '2026-06-01T20:00:00.000Z',
			inlineCommentCount: 1,
		} as never);
		const cmd = new CreatePRReview(
			[
				'--prNumber',
				'42',
				'--event',
				'REQUEST_CHANGES',
				'--body',
				'Please address inline comments.',
			],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(true);
		expect(output.data).toMatchObject({
			status: 'ok',
			id: '700',
			url: 'https://github.com/owner/repo/pull/42#pullrequestreview-700',
			updatedAt: '2026-06-01T20:00:00.000Z',
			reviewUrl: 'https://github.com/owner/repo/pull/42#pullrequestreview-700',
			event: 'REQUEST_CHANGES',
			repoFullName: 'owner/repo',
			prNumber: 42,
			submittedAt: '2026-06-01T20:00:00.000Z',
			inlineCommentCount: 1,
		});
	});

	it('CreatePRReview surfaces a runtime envelope when createPRReview throws (MNG-1425 + MNG-1428)', async () => {
		vi.mocked(createPRReview).mockRejectedValueOnce(new Error('Validation Failed'));
		const cmd = new CreatePRReview(
			['--prNumber', '42', '--event', 'APPROVE', '--body', 'LGTM'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await runExpectingExit(cmd);

		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(false);
		expect(output.error?.type).toBe('runtime');
		expect(output.error?.message).toBe('Validation Failed');
	});

	it('updatedAt values are ISO 8601 strings across SCM mutations', async () => {
		// Pins the GitHub-supplied timestamp surface — postPRComment / replyToReviewComment /
		// updatePRComment use the response's `updated_at`; createPRReview falls back through
		// pickTimestamp(submitted_at). The CLI envelope must carry parseable ISO 8601 strings
		// either way.
		vi.mocked(postPRComment).mockResolvedValueOnce({
			status: 'ok',
			id: '1',
			url: 'https://github.com/owner/repo/pull/42#issuecomment-1',
			updatedAt: '2026-06-01T21:00:00.000Z',
			repoFullName: 'owner/repo',
			prNumber: 42,
		} as never);
		const cmd = new PostPRComment(['--prNumber', '42', '--body', 'hi'], makeMockConfig() as never);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = readJsonOutput(logSpy);
		expect(typeof output.data?.updatedAt).toBe('string');
		expect(Number.isNaN(Date.parse(output.data?.updatedAt as string))).toBe(false);
	});
});
