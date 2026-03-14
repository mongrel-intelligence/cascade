import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreatePR = vi.fn();
vi.mock('../../../../src/gadgets/github/core/createPR.js', () => ({
	createPR: (...args: unknown[]) => mockCreatePR(...args),
}));

vi.mock('../../../../src/gadgets/sessionState.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../../src/gadgets/sessionState.js')>();
	return {
		...actual,
		PR_SIDECAR_ENV_VAR: 'CASCADE_PR_SIDECAR_PATH',
		REVIEW_SIDECAR_ENV_VAR: 'CASCADE_REVIEW_SIDECAR_PATH',
	};
});

// Mock logger to suppress warnings in tests
vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../../src/cli/base.js', () => ({
	CredentialScopedCommand: class {
		log = vi.fn();
		parse = vi.fn();
	},
	resolveOwnerRepo: vi.fn((owner: string, repo: string) => ({ owner, repo })),
}));

import CreatePRCommand from '../../../../src/cli/scm/create-pr.js';

describe('CreatePRCommand sidecar write', () => {
	let sidecarPath: string;
	let originalEnv: string | undefined;

	beforeEach(() => {
		sidecarPath = join(tmpdir(), `cascade-test-pr-sidecar-${Date.now()}.json`);
		originalEnv = process.env.CASCADE_PR_SIDECAR_PATH;
		process.env.CASCADE_PR_SIDECAR_PATH = sidecarPath;
	});

	afterEach(() => {
		try {
			rmSync(sidecarPath, { force: true });
		} catch {
			// ignore
		}
		if (originalEnv !== undefined) {
			process.env.CASCADE_PR_SIDECAR_PATH = originalEnv;
		} else {
			Reflect.deleteProperty(process.env, 'CASCADE_PR_SIDECAR_PATH');
		}
		vi.restoreAllMocks();
	});

	it('writes PR sidecar after successful create-pr', async () => {
		mockCreatePR.mockResolvedValue({
			prUrl: 'https://github.com/owner/repo/pull/123',
			prNumber: 123,
			repoFullName: 'owner/repo',
			alreadyExisted: false,
		});

		const cmd = new CreatePRCommand([], {} as never);
		vi.mocked(cmd.parse).mockResolvedValue({
			flags: {
				title: 'feat: add tests',
				body: 'Summary',
				head: 'feat/tests',
				base: 'main',
			},
			args: {},
			argv: [],
			raw: [],
			metadata: {},
			nonExistentFlags: {},
		} as never);

		await cmd.execute();

		expect(existsSync(sidecarPath)).toBe(true);
		expect(JSON.parse(readFileSync(sidecarPath, 'utf-8'))).toEqual({
			source: 'cascade-tools scm create-pr',
			prUrl: 'https://github.com/owner/repo/pull/123',
			prNumber: 123,
			alreadyExisted: false,
			repoFullName: 'owner/repo',
		});
	});

	it('writes sidecar for already-existing PRs too', async () => {
		mockCreatePR.mockResolvedValue({
			prUrl: 'https://github.com/owner/repo/pull/456',
			prNumber: 456,
			repoFullName: 'owner/repo',
			alreadyExisted: true,
		});

		const cmd = new CreatePRCommand([], {} as never);
		vi.mocked(cmd.parse).mockResolvedValue({
			flags: {
				title: 'feat: add tests',
				body: 'Summary',
				head: 'feat/tests',
				base: 'main',
			},
			args: {},
			argv: [],
			raw: [],
			metadata: {},
			nonExistentFlags: {},
		} as never);

		await cmd.execute();

		expect(JSON.parse(readFileSync(sidecarPath, 'utf-8')).alreadyExisted).toBe(true);
	});

	it('does not write sidecar when create-pr fails', async () => {
		mockCreatePR.mockRejectedValue(new Error('GitHub API error'));

		const cmd = new CreatePRCommand([], {} as never);
		vi.mocked(cmd.parse).mockResolvedValue({
			flags: {
				title: 'feat: add tests',
				body: 'Summary',
				head: 'feat/tests',
				base: 'main',
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
});
