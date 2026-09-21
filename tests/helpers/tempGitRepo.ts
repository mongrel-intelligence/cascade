import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TempGitRepo {
	dir: string;
	git(...args: string[]): string;
	/** Stages everything, commits (empty commits allowed), returns the new HEAD SHA. */
	commit(message: string): string;
	writeFile(name: string, content: string): void;
	cleanup(): void;
}

/** A throwaway real git repository for tests that exercise production git calls. */
export function createTempGitRepo(prefix = 'cascade-temp-git-'): TempGitRepo {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	const git = (...args: string[]): string =>
		execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
			cwd: dir,
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();

	git('init', '-q', '--initial-branch=main');
	git('config', 'user.email', 'temp-git@cascade.local');
	git('config', 'user.name', 'temp-git');

	return {
		dir,
		git,
		commit(message) {
			git('add', '-A');
			git('commit', '-q', '--allow-empty', '-m', message);
			return git('rev-parse', 'HEAD');
		},
		writeFile(name, content) {
			writeFileSync(join(dir, name), content);
		},
		cleanup() {
			rmSync(dir, { recursive: true, force: true });
		},
	};
}
