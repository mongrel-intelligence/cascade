import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sourceLocalPRDiffs } from '../../../../src/agents/shared/prDiffSource.js';
import type { PRDiffFile } from '../../../../src/github/client.js';

const tempDirs: string[] = [];

function git(cwd: string, ...args: string[]): void {
	execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function makeRepo(): string {
	// Create a bare remote so git fetch origin <base> succeeds in the diff helper.
	// Without a real remote, the fail-closed fetch check would mark all files as
	// local-diff-failed even for a healthy repo.
	const remoteDir = mkdtempSync(join(tmpdir(), 'cascade-remote-'));
	tempDirs.push(remoteDir);
	execFileSync('git', ['init', '--bare'], { cwd: remoteDir, stdio: 'pipe' });

	const dir = mkdtempSync(join(tmpdir(), 'cascade-pr-diff-source-'));
	tempDirs.push(dir);
	git(dir, 'init');
	git(dir, 'config', 'user.email', 'test@example.com');
	git(dir, 'config', 'user.name', 'Test User');
	git(dir, 'remote', 'add', 'origin', remoteDir);
	writeFileSync(join(dir, 'file.ts'), 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
	git(dir, 'add', 'file.ts');
	git(dir, 'commit', '-m', 'base');
	git(dir, 'push', 'origin', 'HEAD:refs/heads/main');
	git(dir, 'checkout', '-b', 'feature');
	writeFileSync(join(dir, 'file.ts'), 'const a = 10;\nconst b = 2;\nconst c = 30;\n');
	git(dir, 'add', 'file.ts');
	git(dir, 'commit', '-m', 'feature');
	return dir;
}

function makeFile(overrides: Partial<PRDiffFile> = {}): PRDiffFile {
	return {
		filename: 'file.ts',
		status: 'modified',
		additions: 2,
		deletions: 2,
		changes: 4,
		patch: '@@ -1 +1 @@\n-const a = 1;\n+const a = 10;',
		...overrides,
	};
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('sourceLocalPRDiffs', () => {
	it('uses local git patches and reports GitHub API clipping mismatches', async () => {
		const repoDir = makeRepo();

		const result = await sourceLocalPRDiffs({
			files: [makeFile()],
			repoDir,
			baseBranch: 'main',
			logWriter: vi.fn(),
		});

		expect(result.files[0]).toEqual(
			expect.objectContaining({
				filename: 'file.ts',
				patchSource: 'local-git',
				githubHunkCount: 1,
			}),
		);
		expect(result.files[0].patch).toContain('const c = 30');
		expect(result.files[0].localPatchChars).toBeGreaterThan(result.files[0].githubPatchChars);
		expect(result.mismatches).toEqual([
			expect.objectContaining({
				filename: 'file.ts',
				githubHunkCount: 1,
			}),
		]);
	});

	it('marks local diff failures explicitly when base-ref fetch fails', async () => {
		// When the repoDir does not exist, git fetch exits non-zero. The helper must
		// fail closed: mark all non-deleted files as local-diff-failed rather than
		// proceeding with a stale origin/<base> ref that could produce misleading patches.
		const logWriter = vi.fn();
		const result = await sourceLocalPRDiffs({
			files: [makeFile()],
			repoDir: '/path/that/does/not/exist',
			baseBranch: 'main',
			logWriter,
		});

		expect(result.files[0]).toEqual(
			expect.objectContaining({
				filename: 'file.ts',
				patch: undefined,
				patchSource: 'local-diff-failed',
				localPatchChars: 0,
			}),
		);
		// The WARN is now emitted at the fetch-failure point (fail-closed), not at
		// the per-file diff step.
		expect(logWriter).toHaveBeenCalledWith(
			'WARN',
			'Failed to refresh base branch ref before local diff',
			expect.objectContaining({ baseBranch: 'main' }),
		);
	});

	it('uses :(literal) pathspec to avoid bracket-glob filename expansion', async () => {
		// Regression for the pathspec metacharacter bug: without :(literal),
		// git treats [id] as a character-class glob and includes i.ts / d.ts
		// hunks under the [id].ts diff header.
		const remoteDir = mkdtempSync(join(tmpdir(), 'cascade-remote-bracket-'));
		tempDirs.push(remoteDir);
		execFileSync('git', ['init', '--bare'], { cwd: remoteDir, stdio: 'pipe' });

		const dir = mkdtempSync(join(tmpdir(), 'cascade-pr-diff-bracket-'));
		tempDirs.push(dir);
		git(dir, 'init');
		git(dir, 'config', 'user.email', 'test@example.com');
		git(dir, 'config', 'user.name', 'Test User');
		git(dir, 'remote', 'add', 'origin', remoteDir);
		// [id].ts has bracket chars; i.ts would be matched by the [id] glob
		writeFileSync(join(dir, '[id].ts'), 'const bracket = 1;\n');
		writeFileSync(join(dir, 'i.ts'), 'const normal = 1;\n');
		git(dir, 'add', '.');
		git(dir, 'commit', '-m', 'base');
		git(dir, 'push', 'origin', 'HEAD:refs/heads/main');
		git(dir, 'checkout', '-b', 'feature');
		writeFileSync(join(dir, '[id].ts'), 'const bracket = 2;\n');
		writeFileSync(join(dir, 'i.ts'), 'const normal = 2;\n');
		git(dir, 'add', '.');
		git(dir, 'commit', '-m', 'feature');

		const result = await sourceLocalPRDiffs({
			files: [makeFile({ filename: '[id].ts' })],
			repoDir: dir,
			baseBranch: 'main',
			logWriter: vi.fn(),
		});

		expect(result.files).toHaveLength(1);
		expect(result.files[0].patchSource).toBe('local-git');
		// Only [id].ts content in patch — i.ts/normal must not bleed in
		expect(result.files[0].patch).toContain('bracket');
		expect(result.files[0].patch).not.toContain('normal');
		expect(result.files[0].patch).not.toContain('i.ts');
	});

	it('fetches origin base branch before diffing to avoid stale-ref patches', async () => {
		// Regression for snapshot-reuse scenario: only refs/pull/N/head is
		// fetched when reusing a snapshot, leaving origin/<base> stale.
		// Without the fetch, git diff origin/main...HEAD includes base-branch
		// commits that are NOT part of the PR (A...C instead of B...C).

		// Set up a bare "remote" repo
		const remoteDir = mkdtempSync(join(tmpdir(), 'cascade-remote-'));
		tempDirs.push(remoteDir);
		execFileSync('git', ['init', '--bare'], { cwd: remoteDir, stdio: 'pipe' });

		// Set up local working repo with origin pointing to remoteDir
		const localDir = mkdtempSync(join(tmpdir(), 'cascade-local-'));
		tempDirs.push(localDir);
		git(localDir, 'init');
		git(localDir, 'config', 'user.email', 'test@example.com');
		git(localDir, 'config', 'user.name', 'Test User');
		git(localDir, 'remote', 'add', 'origin', remoteDir);

		// Commit A: initial state — push to remote (remote/main = A)
		writeFileSync(join(localDir, 'file.ts'), 'const a = 1;\n');
		git(localDir, 'add', '.');
		git(localDir, 'commit', '-m', 'A');
		git(localDir, 'push', 'origin', 'HEAD:refs/heads/main');
		const shaA = execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: localDir,
			encoding: 'utf8',
		}).trim();

		// Commit B: base-branch advancement — push to remote (remote/main = B)
		// This simulates main advancing after the snapshot was created.
		writeFileSync(join(localDir, 'file.ts'), 'const a = 1;\nconst base = 2;\n');
		git(localDir, 'add', '.');
		git(localDir, 'commit', '-m', 'B');
		git(localDir, 'push', 'origin', 'HEAD:refs/heads/main');

		// Commit C: the PR change on top of B (not pushed — only fetched via
		// refs/pull/N/head in the real snapshot-reuse path)
		writeFileSync(join(localDir, 'file.ts'), 'const a = 1;\nconst base = 2;\nconst pr = 3;\n');
		git(localDir, 'add', '.');
		git(localDir, 'commit', '-m', 'C');

		// Simulate a stale snapshot: pin origin/main to A so the local ref lags
		git(localDir, 'update-ref', 'refs/remotes/origin/main', shaA);

		// sourceLocalPRDiffs should fetch origin/main (updating it to B) before
		// diffing, so the returned patch is B...C, not A...C.
		const result = await sourceLocalPRDiffs({
			files: [makeFile()],
			repoDir: localDir,
			baseBranch: 'main',
			logWriter: vi.fn(),
		});

		expect(result.files[0].patchSource).toBe('local-git');
		// Only C's change is an added line (+); B's `const base = 2` should be
		// context (a space-prefixed line), not an addition (+line).
		// Without the fetch fix, A...C would mark `const base = 2` as "+added".
		expect(result.files[0].patch).toContain('+const pr = 3');
		expect(result.files[0].patch).not.toContain('+const base = 2');
	});
});
