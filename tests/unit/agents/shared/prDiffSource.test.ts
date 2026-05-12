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
	const dir = mkdtempSync(join(tmpdir(), 'cascade-pr-diff-source-'));
	tempDirs.push(dir);
	git(dir, 'init');
	git(dir, 'config', 'user.email', 'test@example.com');
	git(dir, 'config', 'user.name', 'Test User');
	writeFileSync(join(dir, 'file.ts'), 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
	git(dir, 'add', 'file.ts');
	git(dir, 'commit', '-m', 'base');
	git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
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

	it('marks local diff failures explicitly', async () => {
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
		expect(logWriter).toHaveBeenCalledWith(
			'WARN',
			'Local PR diff failed for changed file',
			expect.objectContaining({ filename: 'file.ts' }),
		);
	});
});
