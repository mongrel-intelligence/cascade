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

// Mock the CLI base class to avoid credential resolution
vi.mock('../../../../src/cli/base.js', () => ({
	CredentialScopedCommand: class {
		log = vi.fn();
		parse = vi.fn();
	},
	resolveOwnerRepo: vi.fn((owner: string, repo: string) => ({ owner, repo })),
}));

import CreatePRReviewCommand from '../../../../src/cli/github/create-pr-review.js';

describe('CreatePRReviewCommand sidecar write', () => {
	let testDir: string;
	let originalCwd: string;

	beforeEach(() => {
		originalCwd = process.cwd();
		testDir = join(tmpdir(), `cascade-test-review-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		process.chdir(testDir);
	});

	afterEach(() => {
		process.chdir(originalCwd);
		rmSync(testDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it('writes .cascade/review-result.json after successful review', async () => {
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

		const sidecarPath = join(testDir, '.cascade', 'review-result.json');
		expect(existsSync(sidecarPath)).toBe(true);

		const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'));
		expect(sidecar).toEqual({
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

		const sidecarPath = join(testDir, '.cascade', 'review-result.json');
		expect(existsSync(sidecarPath)).toBe(false);
	});
});
