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
		exit = vi.fn();
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
			finalBody: 'Needs changes to error handling',
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
		expect(sidecar).toMatchObject({
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

		await cmd.execute();
		// Spec 014: runtime failures emit the structured envelope.
		const logged = vi.mocked(cmd.log).mock.calls.map((c) => c[0] as string);
		const jsonLine = logged.find((l) => l.startsWith('{')) ?? '';
		const output = JSON.parse(jsonLine) as {
			success: boolean;
			error: { type: string; message: string };
		};
		expect(output.success).toBe(false);
		expect(output.error.type).toBe('runtime');
		expect(output.error.message).toBe('GitHub API error');
		expect(vi.mocked(cmd.exit)).toHaveBeenCalledWith(1);
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

describe('CreatePRReviewCommand review event policy', () => {
	let sidecarPath: string;
	let originalSidecarEnv: string | undefined;
	let originalPolicyEnv: string | undefined;

	function makeParseResult() {
		return {
			flags: {
				owner: 'owner',
				repo: 'repo',
				prNumber: 1,
				event: 'REQUEST_CHANGES',
				body: 'Needs changes',
			},
			args: {},
			argv: [],
			raw: [],
			metadata: {},
			nonExistentFlags: {},
		} as never;
	}

	beforeEach(() => {
		sidecarPath = join(tmpdir(), `cascade-test-review-policy-${Date.now()}.json`);
		originalSidecarEnv = process.env.CASCADE_REVIEW_SIDECAR_PATH;
		originalPolicyEnv = process.env.CASCADE_REVIEW_EVENT_POLICY;
		process.env.CASCADE_REVIEW_SIDECAR_PATH = sidecarPath;
		Reflect.deleteProperty(process.env, 'CASCADE_REVIEW_EVENT_POLICY');
	});

	afterEach(() => {
		try {
			rmSync(sidecarPath, { force: true });
		} catch {
			// ignore
		}
		if (originalSidecarEnv !== undefined) {
			process.env.CASCADE_REVIEW_SIDECAR_PATH = originalSidecarEnv;
		} else {
			Reflect.deleteProperty(process.env, 'CASCADE_REVIEW_SIDECAR_PATH');
		}
		if (originalPolicyEnv !== undefined) {
			process.env.CASCADE_REVIEW_EVENT_POLICY = originalPolicyEnv;
		} else {
			Reflect.deleteProperty(process.env, 'CASCADE_REVIEW_EVENT_POLICY');
		}
		vi.restoreAllMocks();
	});

	it('passes the env-resolved comment-only policy to the core and writes the SUBMITTED event/body', async () => {
		process.env.CASCADE_REVIEW_EVENT_POLICY = 'comment-only';
		const advisoryBody = '**Advisory verdict: would request changes** …\n\nNeeds changes';
		mockCreatePRReview.mockResolvedValue({
			reviewUrl: 'https://github.com/owner/repo/pull/1#pullrequestreview-321',
			event: 'COMMENT',
			advisoryEvent: 'REQUEST_CHANGES',
			finalBody: advisoryBody,
		});

		const cmd = new CreatePRReviewCommand([], {} as never);
		vi.mocked(cmd.parse).mockResolvedValue(makeParseResult());

		await cmd.execute();

		expect(mockCreatePRReview).toHaveBeenCalledWith(expect.any(Object), {
			eventPolicy: 'comment-only',
		});
		const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'));
		expect(sidecar).toMatchObject({
			event: 'COMMENT',
			body: advisoryBody,
		});
	});

	it("resolves the 'all' policy when the env var is absent", async () => {
		mockCreatePRReview.mockResolvedValue({
			reviewUrl: 'https://github.com/owner/repo/pull/1#pullrequestreview-322',
			event: 'REQUEST_CHANGES',
			finalBody: 'Needs changes',
		});

		const cmd = new CreatePRReviewCommand([], {} as never);
		vi.mocked(cmd.parse).mockResolvedValue(makeParseResult());

		await cmd.execute();

		expect(mockCreatePRReview).toHaveBeenCalledWith(expect.any(Object), { eventPolicy: 'all' });
	});

	it("treats an invalid env value as the default 'all' policy", async () => {
		process.env.CASCADE_REVIEW_EVENT_POLICY = 'yolo';
		mockCreatePRReview.mockResolvedValue({
			reviewUrl: 'https://github.com/owner/repo/pull/1#pullrequestreview-323',
			event: 'REQUEST_CHANGES',
			finalBody: 'Needs changes',
		});

		const cmd = new CreatePRReviewCommand([], {} as never);
		vi.mocked(cmd.parse).mockResolvedValue(makeParseResult());

		await cmd.execute();

		expect(mockCreatePRReview).toHaveBeenCalledWith(expect.any(Object), { eventPolicy: 'all' });
	});
});
