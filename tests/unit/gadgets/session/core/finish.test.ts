import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/github/client.js', () => ({
	githubClient: {
		getOpenPRByBranch: vi.fn(),
	},
}));

// Mock child_process — both execSync (used for shell-form invariant calls) and
// execFileSync (used for any call that interpolates attacker-controlled input).
const mockExecSync = vi.fn();
const mockExecFileSync = vi.fn();
vi.mock('node:child_process', () => ({
	execSync: (...args: unknown[]) => mockExecSync(...args),
	execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

vi.mock('../../../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import {
	findPRForCurrentBranch,
	hasUncommittedChanges,
	hasUnpushedCommits,
	validateFinish,
} from '../../../../../src/gadgets/session/core/finish.js';
import { githubClient } from '../../../../../src/github/client.js';
import { logger } from '../../../../../src/utils/logging.js';

const mockGithub = vi.mocked(githubClient);
const mockLogger = vi.mocked(logger);

beforeEach(() => {
	mockExecSync.mockReset();
	mockExecFileSync.mockReset();
	mockGithub.getOpenPRByBranch.mockReset();
	mockLogger.warn.mockReset();
});

describe('hasUncommittedChanges', () => {
	it('returns true when git status has output', () => {
		mockExecSync.mockReturnValue('M src/file.ts');
		expect(hasUncommittedChanges()).toBe(true);
	});

	it('returns false when git status empty', () => {
		mockExecSync.mockReturnValue('');
		expect(hasUncommittedChanges()).toBe(false);
	});

	it('returns true when git command fails', () => {
		mockExecSync.mockImplementation(() => {
			throw new Error('not a git repo');
		});
		expect(hasUncommittedChanges()).toBe(true);
	});
});

describe('findPRForCurrentBranch', () => {
	it('returns PR URL when PR exists', async () => {
		mockExecSync
			.mockReturnValueOnce('feature-branch\n') // git rev-parse
			.mockReturnValueOnce('https://github.com/owner/repo.git\n'); // git remote

		mockGithub.getOpenPRByBranch.mockResolvedValue({
			htmlUrl: 'https://github.com/owner/repo/pull/5',
		} as Awaited<ReturnType<typeof mockGithub.getOpenPRByBranch>>);

		const result = await findPRForCurrentBranch();

		expect(result).toBe('https://github.com/owner/repo/pull/5');
	});

	it('returns null when no PR found', async () => {
		mockExecSync
			.mockReturnValueOnce('feature-branch\n')
			.mockReturnValueOnce('https://github.com/owner/repo.git\n');

		mockGithub.getOpenPRByBranch.mockResolvedValue(null);

		const result = await findPRForCurrentBranch();

		expect(result).toBeNull();
	});

	it('returns null when git fails', async () => {
		mockExecSync.mockImplementation(() => {
			throw new Error('git error');
		});

		const result = await findPRForCurrentBranch();

		expect(result).toBeNull();
	});

	it('parses SSH URLs', async () => {
		mockExecSync
			.mockReturnValueOnce('feat\n')
			.mockReturnValueOnce('git@github.com:owner/repo.git\n');

		mockGithub.getOpenPRByBranch.mockResolvedValue({
			htmlUrl: 'https://github.com/owner/repo/pull/1',
		} as Awaited<ReturnType<typeof mockGithub.getOpenPRByBranch>>);

		const result = await findPRForCurrentBranch();

		expect(mockGithub.getOpenPRByBranch).toHaveBeenCalledWith('owner', 'repo', 'feat');
		expect(result).toBe('https://github.com/owner/repo/pull/1');
	});
});

describe('hasUnpushedCommits', () => {
	it('returns true when upstream ahead (count > 0)', () => {
		mockExecSync.mockReturnValue('3\n');
		expect(hasUnpushedCommits()).toBe(true);
	});

	it('returns false when in sync (count = 0)', () => {
		mockExecSync.mockReturnValue('0\n');
		expect(hasUnpushedCommits()).toBe(false);
	});

	it('falls back to origin/{branch} when no upstream', () => {
		mockExecSync.mockImplementationOnce(() => {
			throw new Error('no upstream');
		}); // @{upstream} call fails — still uses execSync (no interpolation)
		mockExecFileSync
			.mockReturnValueOnce('main\n') // git rev-parse --abbrev-ref HEAD
			.mockReturnValueOnce('1\n'); // git rev-list origin/main..HEAD --count

		expect(hasUnpushedCommits()).toBe(true);
	});

	it('returns true when all commands fail', () => {
		mockExecSync.mockImplementation(() => {
			throw new Error('everything fails');
		});
		mockExecFileSync.mockImplementation(() => {
			throw new Error('everything fails');
		});

		expect(hasUnpushedCommits()).toBe(true);
	});

	// Defense in depth: even the legacy fallback's branch interpolation must not
	// land in a shell. Branch names from `git rev-parse --abbrev-ref HEAD` are
	// local-state-controlled (not webhook-controlled), but the shape change is
	// uniform — every interpolated git command goes through execFileSync.
	it('legacy fallback passes branch as argv element, not shell-interpolated', () => {
		mockExecSync.mockImplementationOnce(() => {
			throw new Error('no upstream');
		});
		mockExecFileSync
			.mockReturnValueOnce('feature/$(uname)\n') // weirdly-named local branch
			.mockReturnValueOnce('0\n');

		hasUnpushedCommits();

		const revListCall = mockExecFileSync.mock.calls.find(
			(c) => Array.isArray(c[1]) && (c[1] as string[]).includes('rev-list'),
		);
		expect(revListCall).toBeDefined();
		const argv = revListCall?.[1] as string[];
		// The interpolated branch is bundled with `origin/...HEAD` into a single argv element.
		expect(argv.some((a) => a.includes('feature/$(uname)') && a.includes('origin/'))).toBe(true);
		// And it never gets shell-evaluated via execSync.
		const shellCalls = mockExecSync.mock.calls.map((c) => String(c[0]));
		expect(shellCalls.some((cmd) => cmd.includes('feature/$(uname)'))).toBe(false);
	});

	// PR-checkout path: ls-remote SHA comparison, robust to detached HEAD.
	// Without this, workers in `refs/pull/N/head` detached checkout fall through
	// to `git rev-list origin/HEAD..HEAD` (because rev-parse --abbrev-ref returns
	// the literal "HEAD") and falsely report unpushed commits even when the PR
	// branch is fully pushed. See ucho PR #84 incident on 2026-04-27.
	describe('with prBranch (PR-checkout path)', () => {
		it('returns false when local HEAD matches remote SHA from ls-remote', () => {
			mockExecFileSync
				.mockReturnValueOnce('abc123\n') // git rev-parse HEAD
				.mockReturnValueOnce('abc123\trefs/heads/feature/x\n'); // git ls-remote

			expect(hasUnpushedCommits('feature/x')).toBe(false);
		});

		it('returns true when local HEAD differs from remote SHA', () => {
			mockExecFileSync
				.mockReturnValueOnce('abc123\n')
				.mockReturnValueOnce('def456\trefs/heads/feature/x\n');

			expect(hasUnpushedCommits('feature/x')).toBe(true);
		});

		it('returns true when remote branch missing (empty ls-remote)', () => {
			mockExecFileSync.mockReturnValueOnce('abc123\n').mockReturnValueOnce('');

			expect(hasUnpushedCommits('feature/x')).toBe(true);
		});

		it('returns true (fail-closed) when ls-remote fails AND logs the cause', () => {
			mockExecFileSync.mockReturnValueOnce('abc123\n').mockImplementationOnce(() => {
				throw new Error('ls-remote network error');
			});

			expect(hasUnpushedCommits('feature/x')).toBe(true);

			// Operator visibility: original ucho incident took 22m partly because
			// the agent's "Cannot finish without pushing" error gave no hint that
			// the underlying cause was actually network/auth/etc.
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('ls-remote'),
				expect.objectContaining({ prBranch: 'feature/x' }),
			);
		});

		it('returns true (fail-closed) when rev-parse HEAD fails', () => {
			mockExecFileSync.mockImplementationOnce(() => {
				throw new Error('not a git repo');
			});

			expect(hasUnpushedCommits('feature/x')).toBe(true);
		});

		it('does NOT call rev-parse --abbrev-ref HEAD (the detached-HEAD trap)', () => {
			mockExecFileSync
				.mockReturnValueOnce('abc123\n')
				.mockReturnValueOnce('abc123\trefs/heads/feature/x\n');

			hasUnpushedCommits('feature/x');

			// Neither the new path (execFileSync) nor the legacy path (execSync)
			// should hit any of the three commands that trap in detached HEAD.
			const allCalls = [
				...mockExecFileSync.mock.calls.map((c) => `${c[0]} ${(c[1] as string[])?.join(' ')}`),
				...mockExecSync.mock.calls.map((c) => String(c[0])),
			];
			expect(allCalls.some((cmd) => cmd.includes('--abbrev-ref'))).toBe(false);
			expect(allCalls.some((cmd) => cmd.includes('@{upstream}'))).toBe(false);
			expect(allCalls.some((cmd) => cmd.includes('origin/HEAD'))).toBe(false);
		});

		// Security: prBranch comes from `payload.pull_request.head.ref` (GitHub-supplied)
		// and git's ref-format rules permit `;`, `$`, `&`, `|`, `(`, `)`, backticks.
		// A malicious branch name must NOT be shell-interpolated — it must arrive at
		// git as a single argv element via execFileSync, never via execSync's /bin/sh -c.
		it('passes prBranch as argv element, not a shell-interpolated string (no command injection)', () => {
			mockExecFileSync
				.mockReturnValueOnce('abc123\n')
				.mockReturnValueOnce('abc123\trefs/heads/evil\n');

			const malicious = 'evil$(rm -rf /)x';
			hasUnpushedCommits(malicious);

			// The branch name MUST appear as its own argv entry, not embedded in
			// the command string. execSync (shell form) MUST NOT be used.
			const lsRemoteCall = mockExecFileSync.mock.calls.find(
				(c) => Array.isArray(c[1]) && (c[1] as string[]).includes('ls-remote'),
			);
			expect(lsRemoteCall).toBeDefined();
			const argv = lsRemoteCall?.[1] as string[];
			// The branch name lives in its own slot with the refs/heads/ prefix attached;
			// no shell metacharacter expansion is possible because there's no shell.
			expect(argv).toContain(`refs/heads/${malicious}`);
			// And no execSync invocation interpolated the branch into a shell string.
			const shellCalls = mockExecSync.mock.calls.map((c) => String(c[0]));
			expect(shellCalls.some((cmd) => cmd.includes(malicious))).toBe(false);
		});
	});
});

describe('validateFinish', () => {
	// Hook-driven tests: hooks.requiresPR
	it('requiresPR + !prCreated + no PR on branch → error', async () => {
		// findPRForCurrentBranch returns null
		mockExecSync.mockImplementation(() => {
			throw new Error('fail');
		});

		const result = await validateFinish({
			agentType: 'implementation',
			prCreated: false,
			reviewSubmitted: false,
			hooks: { requiresPR: true },
		});

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain('Cannot finish session without creating a PR');
			expect(result.error).toContain('CreatePR');
		}
	});

	it('requiresPR + prCreated → valid', async () => {
		const result = await validateFinish({
			agentType: 'implementation',
			prCreated: true,
			reviewSubmitted: false,
			hooks: { requiresPR: true },
		});

		expect(result.valid).toBe(true);
	});

	it('requiresPR + PR found on branch → valid', async () => {
		mockExecSync.mockReturnValueOnce('feat\n').mockReturnValueOnce('https://github.com/o/r.git\n');

		mockGithub.getOpenPRByBranch.mockResolvedValue({
			htmlUrl: 'https://github.com/o/r/pull/1',
		} as Awaited<ReturnType<typeof mockGithub.getOpenPRByBranch>>);

		const result = await validateFinish({
			agentType: 'implementation',
			prCreated: false,
			reviewSubmitted: false,
			hooks: { requiresPR: true },
		});

		expect(result.valid).toBe(true);
	});

	// Hook-driven tests: hooks.requiresReview
	it('requiresReview + !reviewSubmitted → error', async () => {
		const result = await validateFinish({
			agentType: 'review',
			prCreated: false,
			reviewSubmitted: false,
			hooks: { requiresReview: true },
		});

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain('Cannot finish session without submitting a review');
			expect(result.error).toContain('CreatePRReview');
		}
	});

	it('requiresReview + reviewSubmitted → valid', async () => {
		const result = await validateFinish({
			agentType: 'review',
			prCreated: false,
			reviewSubmitted: true,
			hooks: { requiresReview: true },
		});

		expect(result.valid).toBe(true);
	});

	// Hook-driven tests: hooks.requiresPushedChanges
	it('requiresPushedChanges + uncommitted → error', async () => {
		mockExecSync.mockReturnValue('M dirty.ts'); // has uncommitted changes

		const result = await validateFinish({
			agentType: 'respond-to-review',
			prCreated: false,
			reviewSubmitted: false,
			hooks: { requiresPushedChanges: true },
		});

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain('uncommitted changes');
		}
	});

	it('requiresPushedChanges + unpushed → error', async () => {
		mockExecSync
			.mockReturnValueOnce('') // no uncommitted (git status)
			.mockReturnValueOnce('2\n'); // unpushed commits

		const result = await validateFinish({
			agentType: 'respond-to-review',
			prCreated: false,
			reviewSubmitted: false,
			hooks: { requiresPushedChanges: true },
		});

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain('pushing changes');
		}
	});

	it('requiresPushedChanges + clean → valid', async () => {
		mockExecSync
			.mockReturnValueOnce('') // no uncommitted
			.mockReturnValueOnce('0\n'); // no unpushed

		const result = await validateFinish({
			agentType: 'respond-to-review',
			prCreated: false,
			reviewSubmitted: false,
			hooks: { requiresPushedChanges: true },
		});

		expect(result.valid).toBe(true);
	});

	// Detached-HEAD PR-checkout: state.prBranch routes hasUnpushedCommits
	// through the ls-remote SHA-comparison path (the bug fix from PR #84 incident).
	it('requiresPushedChanges + prBranch + local==remote SHA → valid (detached-HEAD safe)', async () => {
		mockExecSync.mockReturnValueOnce(''); // git status (no uncommitted) — still execSync (no interpolation)
		mockExecFileSync
			.mockReturnValueOnce('abc123\n') // git rev-parse HEAD
			.mockReturnValueOnce('abc123\trefs/heads/feature/x\n') // git ls-remote
			.mockReturnValueOnce('abc123\n'); // git rev-parse HEAD (for hasNewCommits — different sha than initial)

		const result = await validateFinish({
			agentType: 'respond-to-review',
			prCreated: false,
			reviewSubmitted: false,
			hooks: { requiresPushedChanges: true },
			initialHeadSha: 'orig000', // ensure hasNewCommits passes
			prBranch: 'feature/x',
		});

		expect(result.valid).toBe(true);
	});

	it('requiresPushedChanges + prBranch + local!=remote SHA → error', async () => {
		mockExecSync.mockReturnValueOnce(''); // git status
		mockExecFileSync
			.mockReturnValueOnce('abc123\n') // git rev-parse HEAD
			.mockReturnValueOnce('def456\trefs/heads/feature/x\n'); // ls-remote different

		const result = await validateFinish({
			agentType: 'respond-to-review',
			prCreated: false,
			reviewSubmitted: false,
			hooks: { requiresPushedChanges: true },
			prBranch: 'feature/x',
		});

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain('pushing changes');
		}
	});

	// No hooks set → always valid
	it('no hooks → valid for any agent type', async () => {
		const result = await validateFinish({
			agentType: 'splitting',
			prCreated: false,
			reviewSubmitted: false,
			hooks: {},
		});

		expect(result.valid).toBe(true);
	});

	it('empty hooks → valid even with incomplete state', async () => {
		const result = await validateFinish({
			agentType: 'planning',
			prCreated: false,
			reviewSubmitted: false,
			hooks: {},
		});

		expect(result.valid).toBe(true);
	});

	// requiresPushedChanges + clean for ci agent (mirrors respond-to-ci)
	it('requiresPushedChanges + uncommitted for ci-style agent → error', async () => {
		mockExecSync.mockReturnValue('M file.ts');

		const result = await validateFinish({
			agentType: 'respond-to-ci',
			prCreated: false,
			reviewSubmitted: false,
			hooks: { requiresPushedChanges: true },
		});

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain('uncommitted changes');
		}
	});

	it('requiresPushedChanges + clean for ci-style agent → valid', async () => {
		mockExecSync
			.mockReturnValueOnce('') // no uncommitted
			.mockReturnValueOnce('0\n'); // no unpushed

		const result = await validateFinish({
			agentType: 'respond-to-ci',
			prCreated: false,
			reviewSubmitted: false,
			hooks: { requiresPushedChanges: true },
		});

		expect(result.valid).toBe(true);
	});
});
