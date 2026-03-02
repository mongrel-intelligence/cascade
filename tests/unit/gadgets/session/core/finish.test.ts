import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/github/client.js', () => ({
	githubClient: {
		getOpenPRByBranch: vi.fn(),
	},
}));

// Mock child_process
const mockExecSync = vi.fn();
vi.mock('node:child_process', () => ({
	execSync: (...args: unknown[]) => mockExecSync(...args),
}));

import {
	findPRForCurrentBranch,
	hasUncommittedChanges,
	hasUnpushedCommits,
	validateFinish,
} from '../../../../../src/gadgets/session/core/finish.js';
import { githubClient } from '../../../../../src/github/client.js';

const mockGithub = vi.mocked(githubClient);

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
		mockExecSync
			.mockImplementationOnce(() => {
				throw new Error('no upstream');
			}) // first try fails
			.mockReturnValueOnce('main\n') // get branch name
			.mockReturnValueOnce('1\n'); // count via origin/main

		expect(hasUnpushedCommits()).toBe(true);
	});

	it('returns true when all commands fail', () => {
		mockExecSync.mockImplementation(() => {
			throw new Error('everything fails');
		});

		expect(hasUnpushedCommits()).toBe(true);
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
