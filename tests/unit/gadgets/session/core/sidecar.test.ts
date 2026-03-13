import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock child_process for getCurrentBranch/getCurrentHeadSha (used by writePushedChangesSidecar)
const mockExecSync = vi.fn();
vi.mock('node:child_process', () => ({
	execSync: (...args: unknown[]) => mockExecSync(...args),
}));

// Mock logger to verify warn calls
vi.mock('../../../../../src/utils/logging.js', () => ({
	logger: {
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

// Mock github client (transitive dep from finish.ts re-export)
vi.mock('../../../../../src/github/client.js', () => ({
	githubClient: { getOpenPRByBranch: vi.fn() },
}));

import {
	writePRSidecar,
	writePushedChangesSidecar,
	writeReviewSidecar,
} from '../../../../../src/gadgets/session/core/sidecar.js';
import { logger } from '../../../../../src/utils/logging.js';

describe('writePushedChangesSidecar', () => {
	let sidecarPath: string;

	beforeEach(() => {
		sidecarPath = join(tmpdir(), `cascade-test-pushed-sidecar-${Date.now()}.json`);
		vi.clearAllMocks();
	});

	afterEach(() => {
		rmSync(sidecarPath, { force: true });
	});

	it('writes branch and headSha to sidecar file', () => {
		mockExecSync
			.mockReturnValueOnce('feat/my-branch\n') // getCurrentBranch
			.mockReturnValueOnce('abc123def\n'); // getCurrentHeadSha

		expect(writePushedChangesSidecar(sidecarPath)).toBe(true);

		const data = JSON.parse(readFileSync(sidecarPath, 'utf-8'));
		expect(data).toEqual({
			source: 'cascade-tools session finish',
			branch: 'feat/my-branch',
			headSha: 'abc123def',
		});
	});

	it('warns and returns false when sidecarPath is undefined', () => {
		expect(writePushedChangesSidecar(undefined)).toBe(false);
		expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining('not set'));
	});

	it('warns and returns false when sidecarPath is literal "undefined"', () => {
		expect(writePushedChangesSidecar('undefined')).toBe(false);
		expect(vi.mocked(logger.warn)).toHaveBeenCalled();
	});

	it('returns false when getCurrentBranch fails', () => {
		mockExecSync.mockImplementation(() => {
			throw new Error('not a git repo');
		});

		expect(writePushedChangesSidecar(sidecarPath)).toBe(false);
		expect(existsSync(sidecarPath)).toBe(false);
	});

	it('warns and returns false on write failure', () => {
		mockExecSync.mockReturnValueOnce('main\n').mockReturnValueOnce('deadbeef\n');

		// Use an invalid path to trigger write failure
		const badPath = '/nonexistent-dir/sidecar.json';
		expect(writePushedChangesSidecar(badPath)).toBe(false);
		expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
			expect.objectContaining({ sidecarPath: badPath }),
			expect.stringContaining('Failed to write'),
		);
	});
});

describe('writeReviewSidecar', () => {
	let sidecarPath: string;

	beforeEach(() => {
		sidecarPath = join(tmpdir(), `cascade-test-review-sidecar-${Date.now()}.json`);
		vi.clearAllMocks();
	});

	afterEach(() => {
		rmSync(sidecarPath, { force: true });
	});

	it('writes review data with source field', () => {
		expect(
			writeReviewSidecar(
				sidecarPath,
				'https://github.com/pr/1#review-1',
				'REQUEST_CHANGES',
				'Fix this',
			),
		).toBe(true);

		const data = JSON.parse(readFileSync(sidecarPath, 'utf-8'));
		expect(data).toEqual({
			source: 'cascade-tools scm create-pr-review',
			reviewUrl: 'https://github.com/pr/1#review-1',
			event: 'REQUEST_CHANGES',
			body: 'Fix this',
		});
	});

	it('includes ackCommentDeleted when true', () => {
		writeReviewSidecar(sidecarPath, 'https://url', 'APPROVE', 'LGTM', true);

		const data = JSON.parse(readFileSync(sidecarPath, 'utf-8'));
		expect(data.ackCommentDeleted).toBe(true);
	});

	it('omits ackCommentDeleted when false', () => {
		writeReviewSidecar(sidecarPath, 'https://url', 'APPROVE', 'LGTM', false);

		const data = JSON.parse(readFileSync(sidecarPath, 'utf-8'));
		expect(data.ackCommentDeleted).toBeUndefined();
	});

	it('warns and returns false when path is undefined', () => {
		expect(writeReviewSidecar(undefined, 'url', 'APPROVE', 'ok')).toBe(false);
		expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
			expect.stringContaining('REVIEW_SIDECAR_PATH'),
		);
	});

	it('warns and returns false on write failure', () => {
		const badPath = '/nonexistent-dir/sidecar.json';
		expect(writeReviewSidecar(badPath, 'url', 'APPROVE', 'ok')).toBe(false);
		expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
			expect.objectContaining({ sidecarPath: badPath }),
			expect.stringContaining('Failed to write'),
		);
	});
});

describe('writePRSidecar', () => {
	let sidecarPath: string;

	beforeEach(() => {
		sidecarPath = join(tmpdir(), `cascade-test-pr-sidecar-${Date.now()}.json`);
		vi.clearAllMocks();
	});

	afterEach(() => {
		rmSync(sidecarPath, { force: true });
	});

	it('writes PR data with source field', () => {
		expect(writePRSidecar(sidecarPath, 'https://github.com/pr/42', 42, false, 'owner/repo')).toBe(
			true,
		);

		const data = JSON.parse(readFileSync(sidecarPath, 'utf-8'));
		expect(data).toEqual({
			source: 'cascade-tools scm create-pr',
			prUrl: 'https://github.com/pr/42',
			prNumber: 42,
			alreadyExisted: false,
			repoFullName: 'owner/repo',
		});
	});

	it('records alreadyExisted: true', () => {
		writePRSidecar(sidecarPath, 'https://github.com/pr/1', 1, true, 'o/r');

		const data = JSON.parse(readFileSync(sidecarPath, 'utf-8'));
		expect(data.alreadyExisted).toBe(true);
	});

	it('warns and returns false when path is undefined', () => {
		expect(writePRSidecar(undefined, 'url', 1, false, 'o/r')).toBe(false);
		expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining('PR_SIDECAR_PATH'));
	});

	it('warns and returns false on write failure', () => {
		const badPath = '/nonexistent-dir/sidecar.json';
		expect(writePRSidecar(badPath, 'url', 1, false, 'o/r')).toBe(false);
		expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
			expect.objectContaining({ sidecarPath: badPath }),
			expect.stringContaining('Failed to write'),
		);
	});
});
