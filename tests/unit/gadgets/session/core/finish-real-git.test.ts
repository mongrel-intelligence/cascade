/**
 * Real-git regression net for `hasUnpushedCommits` in the PR-checkout shape.
 *
 * Unlike the sibling `finish.test.ts`, this file does NOT mock `child_process`.
 * It builds a real bare remote + a working repo, performs an actual detached-HEAD
 * checkout via `refs/pull/N/head` (the same shape `setupRepository` produces in
 * the worker), and exercises the production code path end-to-end.
 *
 * The bug from ucho PR #84 (2026-04-27) was specifically that the legacy
 * fallback computed `git rev-list origin/HEAD..HEAD --count` because
 * `git rev-parse --abbrev-ref HEAD` returns the literal "HEAD" in detached
 * mode — a behavior no `execSync` mock would catch. This test would have
 * failed the original incident and pins the fix.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hasUnpushedCommits } from '../../../../../src/gadgets/session/core/finish.js';

const PR_BRANCH = 'feature/per-agent-template-resolution';

function git(cwd: string, ...args: string[]): string {
	// stderr is suppressed so test output stays clean — git is chatty on push.
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf-8',
		stdio: ['ignore', 'pipe', 'ignore'],
	}).trim();
}

interface Repo {
	root: string;
	bareRemote: string;
	workdir: string;
}

function createRepo(): Repo {
	const root = mkdtempSync(join(tmpdir(), 'cascade-finish-real-git-'));
	const bareRemote = join(root, 'remote.git');
	const workdir = join(root, 'work');

	execFileSync('git', ['init', '--bare', '--initial-branch=main', bareRemote], {
		stdio: 'ignore',
	});
	execFileSync('git', ['init', '--initial-branch=main', workdir], { stdio: 'ignore' });

	// Identity required for commits in CI environments.
	git(workdir, 'config', 'user.email', 'finish-test@cascade.local');
	git(workdir, 'config', 'user.name', 'finish-test');
	git(workdir, 'remote', 'add', 'origin', bareRemote);

	// Seed main with one commit so origin/HEAD resolves later.
	execFileSync('sh', ['-c', 'echo seed > seed.txt'], { cwd: workdir });
	git(workdir, 'add', '.');
	git(workdir, 'commit', '-m', 'seed');
	git(workdir, 'push', 'origin', 'main');

	// Create the feature branch + push it (this is the "PR head branch" on the remote).
	git(workdir, 'checkout', '-b', PR_BRANCH);
	execFileSync('sh', ['-c', 'echo feature > feature.txt'], { cwd: workdir });
	git(workdir, 'add', '.');
	git(workdir, 'commit', '-m', 'feature work');
	git(workdir, 'push', 'origin', PR_BRANCH);

	return { root, bareRemote, workdir };
}

function checkoutDetachedAtBranchTip(repo: Repo): void {
	// Mirror what `setupRepository` does for PR jobs: detached HEAD at the branch tip.
	// In production this comes from `refs/pull/N/head`; in this fixture we use the
	// branch tip directly since that's what `refs/pull/N/head` would point to.
	const sha = git(repo.workdir, 'rev-parse', PR_BRANCH);
	git(repo.workdir, 'checkout', '--detach', sha);
}

describe('hasUnpushedCommits — real git, PR-checkout shape', () => {
	let repo: Repo;
	let originalCwd: string;

	beforeEach(() => {
		originalCwd = process.cwd();
		repo = createRepo();
		checkoutDetachedAtBranchTip(repo);
		process.chdir(repo.workdir);
	});

	afterEach(() => {
		process.chdir(originalCwd);
		rmSync(repo.root, { recursive: true, force: true });
	});

	it('returns false when local HEAD == remote branch tip (the wedged-ucho repro)', () => {
		// In detached HEAD, `git rev-parse --abbrev-ref HEAD` returns "HEAD" and
		// `@{upstream}` is unset. The pre-fix code would have returned true here
		// because it computed `git rev-list origin/HEAD..HEAD` (commits not on the
		// default branch — every commit on the feature branch). With the fix,
		// passing prBranch routes through `git ls-remote` which compares directly.
		expect(hasUnpushedCommits(PR_BRANCH)).toBe(false);
	});

	it('returns true when local has a commit not yet pushed', () => {
		// Add an unpushed commit on top of the detached HEAD.
		execFileSync('sh', ['-c', 'echo more > more.txt'], { cwd: repo.workdir });
		git(repo.workdir, 'add', '.');
		git(repo.workdir, 'commit', '-m', 'unpushed work');

		expect(hasUnpushedCommits(PR_BRANCH)).toBe(true);
	});

	it('returns true when the named branch does not exist on the remote', () => {
		expect(hasUnpushedCommits('does-not-exist')).toBe(true);
	});

	it('legacy fallback (no prBranch) is still broken in detached HEAD — documents WHY the fix is needed', () => {
		// This assertion pins the original bug in place. It IS the failure mode that
		// wedged ucho PR #84. If a future refactor accidentally "simplified" the new
		// path back into the legacy chain, this test stays passing while the new path
		// tests fail loudly — keeping the diagnostic clear.
		expect(hasUnpushedCommits()).toBe(true);
	});
});
