import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock createPRReview before importing the command
const mockCreatePRReview = vi.fn();
vi.mock('../../../../src/gadgets/github/core/createPRReview.js', () => ({
	createPRReview: (...args: unknown[]) => mockCreatePRReview(...args),
}));

vi.mock('../../../../src/gadgets/sessionState.js', () => ({
	REVIEW_SIDECAR_FILENAME: '.cascade/review-result.json',
}));

const mockDeletePRComment = vi.fn();
vi.mock('../../../../src/github/client.js', () => ({
	githubClient: {
		deletePRComment: (...args: unknown[]) => mockDeletePRComment(...args),
	},
}));

vi.mock('../../../../src/backends/secretBuilder.js', () => ({
	GITHUB_ACK_COMMENT_ID_ENV_VAR: 'CASCADE_GITHUB_ACK_COMMENT_ID',
}));

// Mock the CLI base class to avoid credential resolution
vi.mock('../../../../src/cli/base.js', () => ({
	CredentialScopedCommand: class {
		log = vi.fn();
		parse = vi.fn();
	},
	resolveOwnerRepo: vi.fn((owner: string, repo: string) => ({ owner, repo })),
}));

import CreatePRReviewCommand from '../../../../src/cli/scm/create-pr-review.js';

function makeParseResult(overrides?: Record<string, unknown>) {
	return {
		flags: {
			owner: 'owner',
			repo: 'repo',
			prNumber: 1,
			event: 'REQUEST_CHANGES',
			body: 'Needs fixes',
			...overrides,
		},
		args: {},
		argv: [],
		raw: [],
		metadata: {},
		nonExistentFlags: {},
	} as never;
}

describe('CreatePRReviewCommand — GitHub ack comment deletion', () => {
	let testDir: string;
	let originalCwd: string;
	let originalEnv: string | undefined;

	beforeEach(() => {
		originalCwd = process.cwd();
		testDir = join(tmpdir(), `cascade-test-review-delete-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		process.chdir(testDir);
		originalEnv = process.env.CASCADE_GITHUB_ACK_COMMENT_ID;
		process.env.CASCADE_GITHUB_ACK_COMMENT_ID = undefined;
		mockDeletePRComment.mockReset();
	});

	afterEach(() => {
		process.chdir(originalCwd);
		rmSync(testDir, { recursive: true, force: true });
		if (originalEnv !== undefined) {
			process.env.CASCADE_GITHUB_ACK_COMMENT_ID = originalEnv;
		} else {
			process.env.CASCADE_GITHUB_ACK_COMMENT_ID = undefined;
		}
		vi.restoreAllMocks();
	});

	it('deletes ack comment when CASCADE_GITHUB_ACK_COMMENT_ID is set', async () => {
		process.env.CASCADE_GITHUB_ACK_COMMENT_ID = '99999';
		mockCreatePRReview.mockResolvedValue({
			reviewUrl: 'https://github.com/owner/repo/pull/1#pullrequestreview-42',
		});
		mockDeletePRComment.mockResolvedValue(undefined);

		const cmd = new CreatePRReviewCommand([], {} as never);
		vi.mocked(cmd.parse).mockResolvedValue(makeParseResult());

		await cmd.execute();

		expect(mockDeletePRComment).toHaveBeenCalledWith('owner', 'repo', 99999);
	});

	it('does not delete when CASCADE_GITHUB_ACK_COMMENT_ID is absent', async () => {
		// env var not set
		mockCreatePRReview.mockResolvedValue({
			reviewUrl: 'https://github.com/owner/repo/pull/1#pullrequestreview-42',
		});

		const cmd = new CreatePRReviewCommand([], {} as never);
		vi.mocked(cmd.parse).mockResolvedValue(makeParseResult());

		await cmd.execute();

		expect(mockDeletePRComment).not.toHaveBeenCalled();
	});

	it('writes ackCommentDeleted: true in sidecar when deletion succeeds', async () => {
		process.env.CASCADE_GITHUB_ACK_COMMENT_ID = '77777';
		mockCreatePRReview.mockResolvedValue({
			reviewUrl: 'https://github.com/owner/repo/pull/1#pullrequestreview-55',
		});
		mockDeletePRComment.mockResolvedValue(undefined);

		const cmd = new CreatePRReviewCommand([], {} as never);
		vi.mocked(cmd.parse).mockResolvedValue(makeParseResult());

		await cmd.execute();

		const sidecarPath = join(testDir, '.cascade', 'review-result.json');
		expect(existsSync(sidecarPath)).toBe(true);
		const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'));
		expect(sidecar.ackCommentDeleted).toBe(true);
	});

	it('does not include ackCommentDeleted in sidecar when env var is absent', async () => {
		mockCreatePRReview.mockResolvedValue({
			reviewUrl: 'https://github.com/owner/repo/pull/1#pullrequestreview-55',
		});

		const cmd = new CreatePRReviewCommand([], {} as never);
		vi.mocked(cmd.parse).mockResolvedValue(makeParseResult());

		await cmd.execute();

		const sidecarPath = join(testDir, '.cascade', 'review-result.json');
		expect(existsSync(sidecarPath)).toBe(true);
		const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'));
		expect(sidecar.ackCommentDeleted).toBeUndefined();
	});

	it('handles deletion failure gracefully — does not include ackCommentDeleted in sidecar', async () => {
		process.env.CASCADE_GITHUB_ACK_COMMENT_ID = '11111';
		mockCreatePRReview.mockResolvedValue({
			reviewUrl: 'https://github.com/owner/repo/pull/1#pullrequestreview-99',
		});
		mockDeletePRComment.mockRejectedValue(new Error('Not Found'));

		const cmd = new CreatePRReviewCommand([], {} as never);
		vi.mocked(cmd.parse).mockResolvedValue(makeParseResult());

		// Should not throw even if deletion fails
		await expect(cmd.execute()).resolves.toBeUndefined();

		const sidecarPath = join(testDir, '.cascade', 'review-result.json');
		const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'));
		// ackCommentDeleted should NOT be set since deletion failed
		expect(sidecar.ackCommentDeleted).toBeUndefined();
	});

	it('handles deletion failure gracefully — review is still logged', async () => {
		process.env.CASCADE_GITHUB_ACK_COMMENT_ID = '22222';
		mockCreatePRReview.mockResolvedValue({
			reviewUrl: 'https://github.com/owner/repo/pull/1#pullrequestreview-12',
		});
		mockDeletePRComment.mockRejectedValue(new Error('404 Not Found'));

		const cmd = new CreatePRReviewCommand([], {} as never);
		vi.mocked(cmd.parse).mockResolvedValue(makeParseResult());

		await cmd.execute();

		// The review result should still be logged to stdout
		expect(vi.mocked(cmd.log)).toHaveBeenCalledWith(expect.stringContaining('"success":true'));
	});

	it('does not delete when env var is set to a non-numeric value', async () => {
		process.env.CASCADE_GITHUB_ACK_COMMENT_ID = 'not-a-number';
		mockCreatePRReview.mockResolvedValue({
			reviewUrl: 'https://github.com/owner/repo/pull/1#pullrequestreview-42',
		});

		const cmd = new CreatePRReviewCommand([], {} as never);
		vi.mocked(cmd.parse).mockResolvedValue(makeParseResult());

		await cmd.execute();

		expect(mockDeletePRComment).not.toHaveBeenCalled();
	});
});
