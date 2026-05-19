import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock credential-scoping dependencies
vi.mock('../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn((_token: string, fn: () => Promise<void>) => fn()),
}));
vi.mock('../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn(
		(_creds: { apiKey: string; token: string }, fn: () => Promise<void>) => fn(),
	),
}));
vi.mock('../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn(
		(_creds: { email: string; apiToken: string; baseUrl: string }, fn: () => Promise<void>) => fn(),
	),
}));
vi.mock('../../../src/pm/index.js', () => ({
	createPMProvider: vi.fn(() => ({})),
	withPMProvider: vi.fn((_provider: unknown, fn: () => Promise<void>) => fn()),
}));

// Mock all gadget functions
vi.mock('../../../src/gadgets/pm/core/updateWorkItem.js', () => ({
	updateWorkItem: vi.fn().mockResolvedValue({ id: 'wi-1' }),
}));
vi.mock('../../../src/gadgets/pm/core/createWorkItem.js', () => ({
	createWorkItem: vi.fn().mockResolvedValue({ id: 'wi-2' }),
}));
vi.mock('../../../src/gadgets/pm/core/reportFriction.js', () => ({
	reportFriction: vi.fn().mockResolvedValue({ status: 'filed' }),
}));
vi.mock('../../../src/gadgets/pm/core/postComment.js', () => ({
	postComment: vi.fn().mockResolvedValue({ id: 'comment-1' }),
}));
vi.mock('../../../src/gadgets/github/core/createPR.js', () => ({
	createPR: vi.fn().mockResolvedValue({ url: 'https://github.com/o/r/pull/1' }),
}));
vi.mock('../../../src/gadgets/github/core/createPRReview.js', () => ({
	createPRReview: vi
		.fn()
		.mockResolvedValue({ reviewUrl: 'https://github.com/o/r/pull/1#review', event: 'COMMENT' }),
}));
vi.mock('../../../src/gadgets/github/core/postPRComment.js', () => ({
	postPRComment: vi.fn().mockResolvedValue({ id: 123 }),
}));
vi.mock('../../../src/gadgets/github/core/updatePRComment.js', () => ({
	updatePRComment: vi.fn().mockResolvedValue({ id: 456 }),
}));
vi.mock('../../../src/gadgets/github/core/replyToReviewComment.js', () => ({
	replyToReviewComment: vi.fn().mockResolvedValue('Reply posted successfully'),
}));

import CreateWorkItem from '../../../src/cli/pm/create-work-item.js';
import PostComment from '../../../src/cli/pm/post-comment.js';
import ReportFriction from '../../../src/cli/pm/report-friction.js';
import UpdateWorkItem from '../../../src/cli/pm/update-work-item.js';
import CreatePR from '../../../src/cli/scm/create-pr.js';
import CreatePRReview from '../../../src/cli/scm/create-pr-review.js';
import PostPRComment from '../../../src/cli/scm/post-pr-comment.js';
import ReplyToReviewComment from '../../../src/cli/scm/reply-to-review-comment.js';
import UpdatePRComment from '../../../src/cli/scm/update-pr-comment.js';
import { createPR } from '../../../src/gadgets/github/core/createPR.js';
import { createPRReview } from '../../../src/gadgets/github/core/createPRReview.js';
import { postPRComment } from '../../../src/gadgets/github/core/postPRComment.js';
import { replyToReviewComment } from '../../../src/gadgets/github/core/replyToReviewComment.js';
import { updatePRComment } from '../../../src/gadgets/github/core/updatePRComment.js';
import { createWorkItem } from '../../../src/gadgets/pm/core/createWorkItem.js';
import { postComment } from '../../../src/gadgets/pm/core/postComment.js';
import { reportFriction } from '../../../src/gadgets/pm/core/reportFriction.js';
import { updateWorkItem } from '../../../src/gadgets/pm/core/updateWorkItem.js';

let tmpDir: string;

/** Minimal oclif config to satisfy this.parse() */
const mockConfig = { runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }) };

beforeEach(() => {
	vi.clearAllMocks();
	tmpDir = mkdtempSync(join(tmpdir(), 'cascade-cli-test-'));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

/** Write content to a temp file and return the path. */
function writeTempFile(filename: string, content: string): string {
	const filePath = join(tmpDir, filename);
	writeFileSync(filePath, content);
	return filePath;
}

describe('UpdateWorkItem --description-file', () => {
	it('reads description from file', async () => {
		const filePath = writeTempFile('desc.md', '# Plan\n\nThis is the **plan**.');
		const cmd = new UpdateWorkItem(
			['--workItemId', 'card-1', '--description-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(updateWorkItem).toHaveBeenCalledWith(
			expect.objectContaining({
				workItemId: 'card-1',
				description: '# Plan\n\nThis is the **plan**.',
			}),
		);
	});

	it('prefers --description-file over --description', async () => {
		const filePath = writeTempFile('desc.md', 'from file');
		const cmd = new UpdateWorkItem(
			['--workItemId', 'card-1', '--description', 'from flag', '--description-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(updateWorkItem).toHaveBeenCalledWith(
			expect.objectContaining({
				description: 'from file',
			}),
		);
	});

	it('still works with inline --description flag', async () => {
		const cmd = new UpdateWorkItem(
			['--workItemId', 'card-1', '--description', 'inline content'],
			mockConfig as never,
		);
		await cmd.run();

		expect(updateWorkItem).toHaveBeenCalledWith(
			expect.objectContaining({
				description: 'inline content',
			}),
		);
	});

	it('handles file with special characters (quotes, backticks, $())', async () => {
		const content = 'Use `code` and "quotes" and $(command) and heredoc <<EOF';
		const filePath = writeTempFile('special.md', content);
		const cmd = new UpdateWorkItem(
			['--workItemId', 'card-1', '--description-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(updateWorkItem).toHaveBeenCalledWith(
			expect.objectContaining({
				description: content,
			}),
		);
	});
});

describe('CreateWorkItem --description-file', () => {
	it('reads description from file', async () => {
		const filePath = writeTempFile('desc.md', 'Work item description');
		const cmd = new CreateWorkItem(
			['--containerId', 'list-1', '--title', 'New Card', '--description-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(createWorkItem).toHaveBeenCalledWith(
			expect.objectContaining({
				containerId: 'list-1',
				title: 'New Card',
				description: 'Work item description',
			}),
		);
	});

	it('still works without --description-file', async () => {
		const cmd = new CreateWorkItem(
			['--containerId', 'list-1', '--title', 'New Card'],
			mockConfig as never,
		);
		await cmd.run();

		expect(createWorkItem).toHaveBeenCalledWith(
			expect.objectContaining({
				containerId: 'list-1',
				title: 'New Card',
				description: undefined,
			}),
		);
	});
});

describe('ReportFriction --details-file', () => {
	it('reads details from file', async () => {
		const filePath = writeTempFile('friction.md', 'Friction details from file');
		const cmd = new ReportFriction(
			[
				'--summary',
				'Friction summary',
				'--details-file',
				filePath,
				'--category',
				'tooling',
				'--severity',
				'medium',
			],
			mockConfig as never,
		);
		await cmd.run();

		expect(reportFriction).toHaveBeenCalledWith(
			expect.objectContaining({
				summary: 'Friction summary',
				details: 'Friction details from file',
				category: 'tooling',
				severity: 'medium',
			}),
		);
	});

	it('prefers --details-file over --details', async () => {
		const filePath = writeTempFile('friction.md', 'from file');
		const cmd = new ReportFriction(
			[
				'--summary',
				'Friction summary',
				'--details',
				'from flag',
				'--details-file',
				filePath,
				'--category',
				'tooling',
				'--severity',
				'medium',
			],
			mockConfig as never,
		);
		await cmd.run();

		expect(reportFriction).toHaveBeenCalledWith(expect.objectContaining({ details: 'from file' }));
	});
});

describe('PostComment --text-file', () => {
	it('reads comment text from file', async () => {
		const filePath = writeTempFile('comment.md', 'Comment from file');
		const cmd = new PostComment(
			['--workItemId', 'card-1', '--text-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(postComment).toHaveBeenCalledWith('card-1', 'Comment from file');
	});

	it('prefers --text-file over --text', async () => {
		const filePath = writeTempFile('comment.md', 'from file');
		const cmd = new PostComment(
			['--workItemId', 'card-1', '--text', 'from flag', '--text-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(postComment).toHaveBeenCalledWith('card-1', 'from file');
	});

	it('still works with inline --text flag', async () => {
		const cmd = new PostComment(
			['--workItemId', 'card-1', '--text', 'inline text'],
			mockConfig as never,
		);
		await cmd.run();

		expect(postComment).toHaveBeenCalledWith('card-1', 'inline text');
	});

	it('errors when neither --text nor --text-file is provided (spec 014 envelope)', async () => {
		const cmd = new PostComment(['--workItemId', 'card-1'], mockConfig as never);
		const logSpy = vi.spyOn(cmd, 'log');
		await expect(cmd.run()).rejects.toThrow();
		const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
			success: boolean;
			error: { type: string; flag?: string };
		};
		expect(output.success).toBe(false);
		expect(output.error.type).toBe('missing-required');
		expect(output.error.flag).toBe('text');
	});
});

describe('CreatePR --body-file', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv, CASCADE_BASE_BRANCH: 'main' };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	// MNG-1059: file inputs preserve shell-sensitive markdown exactly. Confirms
	// the friction cluster (MNG-908 / MNG-910 / MNG-1046 / MNG-1048) does not
	// regress — content with backticks, code fences, $() reaches the core fn
	// byte-for-byte identical to what's on disk.
	it('preserves backticks, code fences, $() and multiline content exactly', async () => {
		const shellSensitive = [
			'## Summary',
			'',
			'Use `npm test` to verify the fix.',
			'',
			'```bash',
			'echo "$(date)" > /tmp/now',
			'```',
			'',
			'Reproducer: `cascade-tools scm get-pr-diff --prNumber $(gh pr view --json number -q .number)`',
		].join('\n');
		const filePath = writeTempFile('shell-sensitive.md', shellSensitive);
		const cmd = new CreatePR(
			['--title', 'feat: x', '--head', 'feat/x', '--body-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(createPR).toHaveBeenCalledWith(
			expect.objectContaining({
				body: shellSensitive,
			}),
		);
	});

	it('reads PR body from file', async () => {
		const filePath = writeTempFile('pr-body.md', '## Summary\n\nPR description');
		const cmd = new CreatePR(
			['--title', 'feat: new feature', '--head', 'feat/branch', '--body-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(createPR).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'feat: new feature',
				body: '## Summary\n\nPR description',
				head: 'feat/branch',
			}),
		);
	});

	it('prefers --body-file over --body', async () => {
		const filePath = writeTempFile('pr-body.md', 'from file');
		const cmd = new CreatePR(
			[
				'--title',
				'feat: x',
				'--head',
				'feat/branch',
				'--body',
				'from flag',
				'--body-file',
				filePath,
			],
			mockConfig as never,
		);
		await cmd.run();

		expect(createPR).toHaveBeenCalledWith(
			expect.objectContaining({
				body: 'from file',
			}),
		);
	});

	it('still works with inline --body flag', async () => {
		const cmd = new CreatePR(
			['--title', 'feat: x', '--head', 'feat/branch', '--body', 'inline body'],
			mockConfig as never,
		);
		await cmd.run();

		expect(createPR).toHaveBeenCalledWith(
			expect.objectContaining({
				body: 'inline body',
			}),
		);
	});

	it('errors when neither --body nor --body-file is provided (spec 014 envelope)', async () => {
		const cmd = new CreatePR(['--title', 'feat: x', '--head', 'feat/branch'], mockConfig as never);
		const logSpy = vi.spyOn(cmd, 'log');
		await expect(cmd.run()).rejects.toThrow();
		const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
			success: boolean;
			error: { type: string; flag?: string };
		};
		expect(output.success).toBe(false);
		expect(output.error.type).toBe('missing-required');
		expect(output.error.flag).toBe('body');
	});
});

describe('CreatePRReview --body-file', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = {
			...originalEnv,
			CASCADE_REPO_OWNER: 'owner',
			CASCADE_REPO_NAME: 'repo',
		};
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	// MNG-1059: stdin (fd 0) is single-consumer. Passing `--body-file - --comments-file -`
	// silently drained one of the two payloads (whichever ran first won; the
	// other got an empty string). Reject this combination structurally before
	// any read occurs.
	it('rejects --body-file - AND --comments-file - in a single invocation', async () => {
		const cmd = new CreatePRReview(
			['--prNumber', '42', '--event', 'COMMENT', '--body-file', '-', '--comments-file', '-'],
			mockConfig as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await expect(cmd.run()).rejects.toThrow();

		// The core function must not be invoked — guard runs pre-read.
		expect(createPRReview).not.toHaveBeenCalled();

		const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
			success: boolean;
			error: { type: string; flag?: string; message?: string; hint?: string };
		};
		expect(output.success).toBe(false);
		expect(output.error.type).toBe('flag-parse');
		expect(output.error.flag).toBe('body-file,comments-file');
		expect(output.error.message).toContain('stdin can only be drained once');
		expect(output.error.hint).toContain('temp file');
	});

	it('reads review body from file', async () => {
		const filePath = writeTempFile('review.md', 'Review body from file');
		const cmd = new CreatePRReview(
			['--prNumber', '42', '--event', 'COMMENT', '--body-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(createPRReview).toHaveBeenCalledWith(
			expect.objectContaining({
				owner: 'owner',
				repo: 'repo',
				prNumber: 42,
				event: 'COMMENT',
				body: 'Review body from file',
			}),
		);
	});

	it('prefers --body-file over --body', async () => {
		const filePath = writeTempFile('review.md', 'from file');
		const cmd = new CreatePRReview(
			['--prNumber', '42', '--event', 'APPROVE', '--body', 'from flag', '--body-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(createPRReview).toHaveBeenCalledWith(
			expect.objectContaining({
				body: 'from file',
			}),
		);
	});

	it('keeps inline comments JSON parsing when combined with --body-file', async () => {
		const filePath = writeTempFile('review.md', 'Needs a small change');
		const comments = [{ path: 'src/index.ts', line: 12, body: 'Please handle null here.' }];
		const cmd = new CreatePRReview(
			[
				'--prNumber',
				'42',
				'--event',
				'REQUEST_CHANGES',
				'--body-file',
				filePath,
				'--comments',
				JSON.stringify(comments),
			],
			mockConfig as never,
		);
		await cmd.run();

		expect(createPRReview).toHaveBeenCalledWith(
			expect.objectContaining({
				body: 'Needs a small change',
				comments,
			}),
		);
	});

	it('resolves the --comment alias with one JSON object', async () => {
		const comment = { path: 'src/index.ts', line: 12, body: 'Please handle null here.' };
		const cmd = new CreatePRReview(
			[
				'--prNumber',
				'42',
				'--event',
				'REQUEST_CHANGES',
				'--body',
				'Needs a small change',
				'--comment',
				JSON.stringify(comment),
			],
			mockConfig as never,
		);
		await cmd.run();

		expect(createPRReview).toHaveBeenCalledWith(
			expect.objectContaining({
				body: 'Needs a small change',
				comments: [comment],
			}),
		);
	});

	it('rejects primitive JSON passed through the --comment alias', async () => {
		const cmd = new CreatePRReview(
			[
				'--prNumber',
				'42',
				'--event',
				'REQUEST_CHANGES',
				'--body',
				'Needs a small change',
				'--comment',
				'"not an array"',
			],
			mockConfig as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await expect(cmd.run()).rejects.toThrow();

		expect(createPRReview).not.toHaveBeenCalled();
		const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
			success: boolean;
			error: { type: string; flag?: string };
		};
		expect(output.success).toBe(false);
		expect(output.error.type).toBe('json-parse');
		expect(output.error.flag).toBe('comments');
	});
});

describe('PostPRComment --body-file', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = {
			...originalEnv,
			CASCADE_REPO_OWNER: 'owner',
			CASCADE_REPO_NAME: 'repo',
		};
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('reads comment body from file', async () => {
		const filePath = writeTempFile('comment.md', 'PR comment from file');
		const cmd = new PostPRComment(
			['--prNumber', '42', '--body-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(postPRComment).toHaveBeenCalledWith('owner', 'repo', 42, 'PR comment from file');
	});

	it('prefers --body-file over --body', async () => {
		const filePath = writeTempFile('comment.md', 'from file');
		const cmd = new PostPRComment(
			['--prNumber', '42', '--body', 'from flag', '--body-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(postPRComment).toHaveBeenCalledWith('owner', 'repo', 42, 'from file');
	});

	it('still works with inline --body flag', async () => {
		const cmd = new PostPRComment(
			['--prNumber', '42', '--body', 'inline body'],
			mockConfig as never,
		);
		await cmd.run();

		expect(postPRComment).toHaveBeenCalledWith('owner', 'repo', 42, 'inline body');
	});

	it('errors when neither --body nor --body-file is provided (spec 014 envelope)', async () => {
		const cmd = new PostPRComment(['--prNumber', '42'], mockConfig as never);
		const logSpy = vi.spyOn(cmd, 'log');
		await expect(cmd.run()).rejects.toThrow();
		const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
			success: boolean;
			error: { type: string; flag?: string };
		};
		expect(output.success).toBe(false);
		expect(output.error.type).toBe('missing-required');
		expect(output.error.flag).toBe('body');
	});
});

describe('UpdatePRComment --body-file', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = {
			...originalEnv,
			CASCADE_REPO_OWNER: 'owner',
			CASCADE_REPO_NAME: 'repo',
		};
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('reads comment body from file', async () => {
		const filePath = writeTempFile('comment.md', 'Updated PR comment from file');
		const cmd = new UpdatePRComment(
			['--commentId', '456', '--body-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(updatePRComment).toHaveBeenCalledWith(
			'owner',
			'repo',
			456,
			'Updated PR comment from file',
		);
	});

	it('prefers --body-file over --body', async () => {
		const filePath = writeTempFile('comment.md', 'from file');
		const cmd = new UpdatePRComment(
			['--commentId', '456', '--body', 'from flag', '--body-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(updatePRComment).toHaveBeenCalledWith('owner', 'repo', 456, 'from file');
	});

	it('still works with inline --body flag', async () => {
		const cmd = new UpdatePRComment(
			['--commentId', '456', '--body', 'inline body'],
			mockConfig as never,
		);
		await cmd.run();

		expect(updatePRComment).toHaveBeenCalledWith('owner', 'repo', 456, 'inline body');
	});

	it('errors when neither --body nor --body-file is provided (spec 014 envelope)', async () => {
		const cmd = new UpdatePRComment(['--commentId', '456'], mockConfig as never);
		const logSpy = vi.spyOn(cmd, 'log');
		await expect(cmd.run()).rejects.toThrow();
		const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
			success: boolean;
			error: { type: string; flag?: string };
		};
		expect(output.success).toBe(false);
		expect(output.error.type).toBe('missing-required');
		expect(output.error.flag).toBe('body');
	});
});

describe('ReplyToReviewComment --body-file', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = {
			...originalEnv,
			CASCADE_REPO_OWNER: 'owner',
			CASCADE_REPO_NAME: 'repo',
		};
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('reads reply body from file', async () => {
		const filePath = writeTempFile('reply.md', 'Review reply from file');
		const cmd = new ReplyToReviewComment(
			['--prNumber', '42', '--commentId', '789', '--body-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(replyToReviewComment).toHaveBeenCalledWith(
			'owner',
			'repo',
			42,
			789,
			'Review reply from file',
		);
	});

	it('prefers --body-file over --body', async () => {
		const filePath = writeTempFile('reply.md', 'from file');
		const cmd = new ReplyToReviewComment(
			['--prNumber', '42', '--commentId', '789', '--body', 'from flag', '--body-file', filePath],
			mockConfig as never,
		);
		await cmd.run();

		expect(replyToReviewComment).toHaveBeenCalledWith('owner', 'repo', 42, 789, 'from file');
	});

	it('still works with inline --body flag', async () => {
		const cmd = new ReplyToReviewComment(
			['--prNumber', '42', '--commentId', '789', '--body', 'inline body'],
			mockConfig as never,
		);
		await cmd.run();

		expect(replyToReviewComment).toHaveBeenCalledWith('owner', 'repo', 42, 789, 'inline body');
	});

	it('errors when neither --body nor --body-file is provided (spec 014 envelope)', async () => {
		const cmd = new ReplyToReviewComment(
			['--prNumber', '42', '--commentId', '789'],
			mockConfig as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await expect(cmd.run()).rejects.toThrow();
		const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
			success: boolean;
			error: { type: string; flag?: string };
		};
		expect(output.success).toBe(false);
		expect(output.error.type).toBe('missing-required');
		expect(output.error.flag).toBe('body');
	});
});
