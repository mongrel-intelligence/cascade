import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock createPRReview before importing the command
const mockCreatePRReview = vi.fn();
vi.mock('../../../../src/gadgets/github/core/createPRReview.js', () => ({
	createPRReview: (...args: unknown[]) => mockCreatePRReview(...args),
}));

vi.mock('../../../../src/gadgets/sessionState.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../../src/gadgets/sessionState.js')>();
	return {
		...actual,
		REVIEW_SIDECAR_ENV_VAR: 'CASCADE_REVIEW_SIDECAR_PATH',
	};
});

// Mock the GitHub client used by deleteAckComment
vi.mock('../../../../src/github/client.js', () => ({
	githubClient: {
		deletePRComment: vi.fn(),
	},
}));

// Mock logger to suppress warnings in tests
vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
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

describe('CreatePRReviewCommand sidecar write', () => {
	let sidecarPath: string;
	let originalEnv: string | undefined;

	beforeEach(() => {
		sidecarPath = join(tmpdir(), `cascade-test-review-sidecar-${Date.now()}.json`);
		originalEnv = process.env.CASCADE_REVIEW_SIDECAR_PATH;
		process.env.CASCADE_REVIEW_SIDECAR_PATH = sidecarPath;
	});

	afterEach(() => {
		try {
			rmSync(sidecarPath, { force: true });
		} catch {
			// ignore
		}
		if (originalEnv !== undefined) {
			process.env.CASCADE_REVIEW_SIDECAR_PATH = originalEnv;
		} else {
			Reflect.deleteProperty(process.env, 'CASCADE_REVIEW_SIDECAR_PATH');
		}
		vi.restoreAllMocks();
	});

	it('writes sidecar to temp path from CASCADE_REVIEW_SIDECAR_PATH after successful review', async () => {
		mockCreatePRReview.mockResolvedValue({
			reviewUrl: 'https://github.com/owner/repo/pull/1#pullrequestreview-123',
			event: 'REQUEST_CHANGES',
		});

		const cmd = new CreatePRReviewCommand([], {} as never);
		vi.mocked(cmd.parse).mockResolvedValue({
			flags: {
				owner: 'owner',
				repo: 'repo',
				prNumber: 1,
				event: 'REQUEST_CHANGES',
				body: 'Needs changes to error handling',
			},
			args: {},
			argv: [],
			raw: [],
			metadata: {},
			nonExistentFlags: {},
		} as never);

		await cmd.execute();

		expect(existsSync(sidecarPath)).toBe(true);

		const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'));
		expect(sidecar).toEqual({
			source: 'cascade-tools scm create-pr-review',
			reviewUrl: 'https://github.com/owner/repo/pull/1#pullrequestreview-123',
			event: 'REQUEST_CHANGES',
			body: 'Needs changes to error handling',
		});
	});

	it('does not write sidecar when createPRReview throws', async () => {
		mockCreatePRReview.mockRejectedValue(new Error('GitHub API error'));

		const cmd = new CreatePRReviewCommand([], {} as never);
		vi.mocked(cmd.parse).mockResolvedValue({
			flags: {
				owner: 'owner',
				repo: 'repo',
				prNumber: 1,
				event: 'APPROVE',
				body: 'Looks good',
			},
			args: {},
			argv: [],
			raw: [],
			metadata: {},
			nonExistentFlags: {},
		} as never);

		await expect(cmd.execute()).rejects.toThrow('GitHub API error');

		expect(existsSync(sidecarPath)).toBe(false);
	});

	it('does not write sidecar when CASCADE_REVIEW_SIDECAR_PATH is not set', async () => {
		Reflect.deleteProperty(process.env, 'CASCADE_REVIEW_SIDECAR_PATH');

		mockCreatePRReview.mockResolvedValue({
			reviewUrl: 'https://github.com/owner/repo/pull/1#pullrequestreview-123',
			event: 'APPROVE',
		});

		const cmd = new CreatePRReviewCommand([], {} as never);
		vi.mocked(cmd.parse).mockResolvedValue({
			flags: {
				owner: 'owner',
				repo: 'repo',
				prNumber: 1,
				event: 'APPROVE',
				body: 'LGTM',
			},
			args: {},
			argv: [],
			raw: [],
			metadata: {},
			nonExistentFlags: {},
		} as never);

		await cmd.execute();

		expect(existsSync(sidecarPath)).toBe(false);
	});
});
