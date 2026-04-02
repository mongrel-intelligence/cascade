import { describe, expect, it, vi } from 'vitest';
import { mockGitHubClientModule } from '../../helpers/sharedMocks.js';

// Mock session state
vi.mock('../../../src/gadgets/sessionState.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../src/gadgets/sessionState.js')>();
	return {
		...actual,
		recordPRCreation: vi.fn(),
		getBaseBranch: vi.fn().mockReturnValue('main'),
	};
});

// Mock the github client using shared mock
vi.mock('../../../src/github/client.js', () => mockGitHubClientModule);

// Mock runCommand for git operations
vi.mock('../../../src/utils/repo.js', () => ({
	runCommand: vi.fn(),
}));

// Mock run link to prevent env var leakage from CASCADE agent environment
vi.mock('../../../src/utils/runLink.js', () => ({
	buildRunLinkFooterFromEnv: vi.fn(() => ''),
}));

import { CreatePR } from '../../../src/gadgets/github/CreatePR.js';
import { githubClient } from '../../../src/github/client.js';
import { runCommand } from '../../../src/utils/repo.js';

const REMOTE_URL = 'https://x-access-token@github.com/test-owner/test-repo.git';

/** Mock runCommand to handle git remote detection + other commands via a delegate */
function mockRunCommand(
	delegate: (
		cmd: string,
		args?: string[],
	) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
) {
	vi.mocked(runCommand).mockImplementation(async (cmd, args, _cwd) => {
		// Auto-detect owner/repo from git remote
		if (args?.[0] === 'remote') {
			return { stdout: REMOTE_URL, stderr: '', exitCode: 0 };
		}
		return delegate(cmd, args);
	});
}

describe('GitHub Gadgets', () => {
	describe('CreatePR', () => {
		it('is a valid llmist Gadget class', () => {
			const gadget = new CreatePR();
			expect(gadget).toBeDefined();
			expect(typeof gadget.execute).toBe('function');
		});

		it('has correct metadata', () => {
			const gadget = new CreatePR();
			expect(gadget.name).toBe('CreatePR');
			expect(gadget.description).toContain('pull request');
		});

		it('mentions auto-detection in description', () => {
			const gadget = new CreatePR();
			expect(gadget.description).toContain('auto-detected');
		});

		it('throws error when branch does not exist (commit=false, push=false)', async () => {
			// git ls-remote returns empty stdout when branch doesn't exist
			mockRunCommand(async () => ({ stdout: '', stderr: '', exitCode: 0 }));

			const gadget = new CreatePR();
			await expect(
				gadget.execute({
					title: 'Test PR',
					body: 'Test body',
					head: 'feature/test',
					commit: false,
					push: false,
				}),
			).rejects.toThrow('does not exist on remote');

			expect(githubClient.createPR).not.toHaveBeenCalled();
		});

		it('auto-detects owner/repo from git remote and creates PR', async () => {
			mockRunCommand(async (_cmd, args) => {
				if (args?.[0] === 'ls-remote') {
					return { stdout: 'abc123\trefs/heads/feature/test', stderr: '', exitCode: 0 };
				}
				return { stdout: '', stderr: '', exitCode: 0 };
			});
			vi.mocked(githubClient.createPR).mockResolvedValue({
				number: 42,
				htmlUrl: 'https://github.com/test-owner/test-repo/pull/42',
				title: 'Test PR',
			});

			const gadget = new CreatePR();
			const result = await gadget.execute({
				title: 'Test PR',
				body: 'Test body',
				head: 'feature/test',
				commit: false,
				push: false,
			});

			expect(result).toContain('PR #42 created successfully');
			expect(result).toContain('https://github.com/test-owner/test-repo/pull/42');
			expect(githubClient.createPR).toHaveBeenCalledWith('test-owner', 'test-repo', {
				title: 'Test PR',
				body: 'Test body',
				head: 'feature/test',
				base: 'main',
				draft: undefined,
			});
		});

		it('includes draft label when creating draft PR', async () => {
			mockRunCommand(async (_cmd, args) => {
				if (args?.[0] === 'ls-remote') {
					return { stdout: 'abc123\trefs/heads/feature/draft', stderr: '', exitCode: 0 };
				}
				return { stdout: '', stderr: '', exitCode: 0 };
			});
			vi.mocked(githubClient.createPR).mockResolvedValue({
				number: 43,
				htmlUrl: 'https://github.com/test-owner/test-repo/pull/43',
				title: 'Draft PR',
			});

			const gadget = new CreatePR();
			const result = await gadget.execute({
				title: 'Draft PR',
				body: 'Test body',
				head: 'feature/draft',
				draft: true,
				commit: false,
				push: false,
			});

			expect(result).toContain('(draft)');
		});

		it('commits and pushes branch before creating PR by default', async () => {
			mockRunCommand(async (_cmd, args) => {
				if (args?.[0] === 'ls-remote') {
					return { stdout: 'abc123\trefs/heads/feature/test', stderr: '', exitCode: 0 };
				}
				if (args?.[0] === 'ls-files') {
					return { stdout: '', stderr: '', exitCode: 0 }; // No untracked files
				}
				return { stdout: '', stderr: '', exitCode: 0 };
			});
			vi.mocked(githubClient.createPR).mockResolvedValue({
				number: 44,
				htmlUrl: 'https://github.com/test-owner/test-repo/pull/44',
				title: 'Test PR',
			});

			const gadget = new CreatePR();
			const result = await gadget.execute({
				title: 'Test PR',
				body: 'Test body',
				head: 'feature/test',
			});

			// Should stage tracked changes with -u (not git add .)
			expect(runCommand).toHaveBeenCalledWith('git', ['add', '-u'], expect.any(String));
			// Should check for untracked files
			expect(runCommand).toHaveBeenCalledWith(
				'git',
				['ls-files', '--others', '--exclude-standard'],
				expect.any(String),
			);
			// Should check for changes
			expect(runCommand).toHaveBeenCalledWith('git', ['status', '--porcelain'], expect.any(String));
			// Should push
			expect(runCommand).toHaveBeenCalledWith(
				'git',
				['push', '-u', 'origin', 'feature/test'],
				expect.any(String),
			);
			expect(result).toContain('PR #44 created successfully');
		});

		it('stages untracked non-ignored files individually', async () => {
			vi.mocked(runCommand)
				.mockResolvedValueOnce({ stdout: REMOTE_URL, stderr: '', exitCode: 0 }) // git remote
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git add -u
				.mockResolvedValueOnce({
					stdout: 'src/new-file.ts\nsrc/another.ts',
					stderr: '',
					exitCode: 0,
				}) // git ls-files --others
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git add -- new files
				.mockResolvedValueOnce({ stdout: 'M file.ts', stderr: '', exitCode: 0 }) // git status --porcelain
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git commit
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git push
				.mockResolvedValueOnce({
					stdout: 'abc123\trefs/heads/feature/test',
					stderr: '',
					exitCode: 0,
				}); // git ls-remote
			vi.mocked(githubClient.createPR).mockResolvedValue({
				number: 48,
				htmlUrl: 'https://github.com/test-owner/test-repo/pull/48',
				title: 'Test PR',
			});

			const gadget = new CreatePR();
			await gadget.execute({
				title: 'Test PR',
				body: 'Test body',
				head: 'feature/test',
			});

			// Should add specific untracked files
			expect(runCommand).toHaveBeenCalledWith(
				'git',
				['add', '--', 'src/new-file.ts', 'src/another.ts'],
				expect.any(String),
			);
		});

		it('commits changes when there are unstaged changes', async () => {
			vi.mocked(runCommand)
				.mockResolvedValueOnce({ stdout: REMOTE_URL, stderr: '', exitCode: 0 }) // git remote
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git add -u
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git ls-files --others
				.mockResolvedValueOnce({ stdout: 'M file.ts', stderr: '', exitCode: 0 }) // git status --porcelain
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git commit
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git push
				.mockResolvedValueOnce({
					stdout: 'abc123\trefs/heads/feature/test',
					stderr: '',
					exitCode: 0,
				}); // git ls-remote
			vi.mocked(githubClient.createPR).mockResolvedValue({
				number: 45,
				htmlUrl: 'https://github.com/test-owner/test-repo/pull/45',
				title: 'Test PR',
			});

			const gadget = new CreatePR();
			await gadget.execute({
				title: 'Test PR',
				body: 'Test body',
				head: 'feature/test',
			});

			// Should commit with PR title as message
			expect(runCommand).toHaveBeenCalledWith(
				'git',
				['commit', '-m', 'Test PR'],
				expect.any(String),
			);
		});

		it('uses custom commit message when provided', async () => {
			vi.mocked(runCommand)
				.mockResolvedValueOnce({ stdout: REMOTE_URL, stderr: '', exitCode: 0 }) // git remote
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git add -u
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git ls-files --others
				.mockResolvedValueOnce({ stdout: 'M file.ts', stderr: '', exitCode: 0 }) // git status --porcelain
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git commit
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git push
				.mockResolvedValueOnce({
					stdout: 'abc123\trefs/heads/feature/test',
					stderr: '',
					exitCode: 0,
				}); // git ls-remote
			vi.mocked(githubClient.createPR).mockResolvedValue({
				number: 46,
				htmlUrl: 'https://github.com/test-owner/test-repo/pull/46',
				title: 'Test PR',
			});

			const gadget = new CreatePR();
			await gadget.execute({
				title: 'Test PR',
				body: 'Test body',
				head: 'feature/test',
				commitMessage: 'feat(test): custom commit message',
			});

			expect(runCommand).toHaveBeenCalledWith(
				'git',
				['commit', '-m', 'feat(test): custom commit message'],
				expect.any(String),
			);
		});

		it('skips commit when commit=false', async () => {
			mockRunCommand(async (_cmd, args) => {
				if (args?.[0] === 'ls-remote') {
					return { stdout: 'abc123\trefs/heads/feature/test', stderr: '', exitCode: 0 };
				}
				return { stdout: '', stderr: '', exitCode: 0 };
			});
			vi.mocked(githubClient.createPR).mockResolvedValue({
				number: 47,
				htmlUrl: 'https://github.com/test-owner/test-repo/pull/47',
				title: 'Test PR',
			});

			const gadget = new CreatePR();
			await gadget.execute({
				title: 'Test PR',
				body: 'Test body',
				head: 'feature/test',
				commit: false,
			});

			// Should NOT call git add -u or git commit
			expect(runCommand).not.toHaveBeenCalledWith('git', ['add', '-u'], expect.any(String));
			expect(runCommand).not.toHaveBeenCalledWith(
				'git',
				['status', '--porcelain'],
				expect.any(String),
			);
			// Should still push
			expect(runCommand).toHaveBeenCalledWith(
				'git',
				['push', '-u', 'origin', 'feature/test'],
				expect.any(String),
			);
		});

		it('throws error when commit fails', async () => {
			vi.mocked(runCommand)
				.mockResolvedValueOnce({ stdout: REMOTE_URL, stderr: '', exitCode: 0 }) // git remote
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git add -u
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git ls-files --others
				.mockResolvedValueOnce({ stdout: 'M file.ts', stderr: '', exitCode: 0 }) // git status --porcelain
				.mockResolvedValueOnce({
					stdout: '',
					stderr: 'error: pre-commit hook failed',
					exitCode: 1,
				}); // git commit

			const gadget = new CreatePR();
			await expect(
				gadget.execute({
					title: 'Test PR',
					body: 'Test body',
					head: 'feature/test',
				}),
			).rejects.toThrow('COMMIT FAILED');

			expect(githubClient.createPR).not.toHaveBeenCalled();
		});

		it('throws error when push fails', async () => {
			vi.mocked(runCommand)
				.mockResolvedValueOnce({ stdout: REMOTE_URL, stderr: '', exitCode: 0 }) // git remote
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git add -u
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git ls-files --others
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git status --porcelain (no changes)
				.mockResolvedValueOnce({
					stdout: '',
					stderr: 'error: failed to push some refs',
					exitCode: 1,
				}); // git push

			const gadget = new CreatePR();
			await expect(
				gadget.execute({
					title: 'Test PR',
					body: 'Test body',
					head: 'feature/test',
				}),
			).rejects.toThrow('PUSH FAILED');

			expect(githubClient.createPR).not.toHaveBeenCalled();
		});

		it('returns existing PR when GitHub returns 422 "already exists"', async () => {
			const error = new Error('A pull request already exists for test-owner:feature/test');
			Object.assign(error, { status: 422 });

			mockRunCommand(async (_cmd, args) => {
				if (args?.[0] === 'ls-remote') {
					return { stdout: 'abc123\trefs/heads/feature/test', stderr: '', exitCode: 0 };
				}
				return { stdout: '', stderr: '', exitCode: 0 };
			});
			vi.mocked(githubClient.createPR).mockRejectedValue(error);
			vi.mocked(githubClient.getOpenPRByBranch).mockResolvedValue({
				number: 4,
				htmlUrl: 'https://github.com/test-owner/test-repo/pull/4',
				title: 'Existing PR',
			});

			const { recordPRCreation } = await import('../../../src/gadgets/sessionState.js');

			const gadget = new CreatePR();
			const result = await gadget.execute({
				title: 'Test PR',
				body: 'Test body',
				head: 'feature/test',
				commit: false,
				push: false,
			});

			expect(result).toContain('PR already exists');
			expect(result).toContain('#4');
			expect(result).toContain('https://github.com/test-owner/test-repo/pull/4');
			expect(recordPRCreation).toHaveBeenCalledWith(
				'https://github.com/test-owner/test-repo/pull/4',
			);
		});

		it('re-throws non-422 errors from createPR', async () => {
			const error = new Error('Internal Server Error');
			Object.assign(error, { status: 500 });

			mockRunCommand(async (_cmd, args) => {
				if (args?.[0] === 'ls-remote') {
					return { stdout: 'abc123\trefs/heads/feature/test', stderr: '', exitCode: 0 };
				}
				return { stdout: '', stderr: '', exitCode: 0 };
			});
			vi.mocked(githubClient.createPR).mockRejectedValue(error);

			const gadget = new CreatePR();
			await expect(
				gadget.execute({
					title: 'Test PR',
					body: 'Test body',
					head: 'feature/test',
					commit: false,
					push: false,
				}),
			).rejects.toThrow('Internal Server Error');

			expect(githubClient.getOpenPRByBranch).not.toHaveBeenCalled();
		});

		it('throws when git remote is not available', async () => {
			vi.mocked(runCommand).mockResolvedValue({
				stdout: '',
				stderr: 'fatal: not a git repository',
				exitCode: 128,
			});

			const gadget = new CreatePR();
			await expect(
				gadget.execute({
					title: 'Test PR',
					body: 'Test body',
					head: 'feature/test',
					commit: false,
					push: false,
				}),
			).rejects.toThrow('no git remote "origin" found');
		});

		it('parses SSH remote URL correctly', async () => {
			vi.mocked(runCommand).mockImplementation(async (_cmd, args) => {
				if (args?.[0] === 'remote') {
					return { stdout: 'git@github.com:my-org/my-repo.git', stderr: '', exitCode: 0 };
				}
				if (args?.[0] === 'ls-remote') {
					return { stdout: 'abc123\trefs/heads/feature/test', stderr: '', exitCode: 0 };
				}
				return { stdout: '', stderr: '', exitCode: 0 };
			});
			vi.mocked(githubClient.createPR).mockResolvedValue({
				number: 50,
				htmlUrl: 'https://github.com/my-org/my-repo/pull/50',
				title: 'Test PR',
			});

			const gadget = new CreatePR();
			await gadget.execute({
				title: 'Test PR',
				body: 'Test body',
				head: 'feature/test',
				commit: false,
				push: false,
			});

			expect(githubClient.createPR).toHaveBeenCalledWith('my-org', 'my-repo', expect.any(Object));
		});
	});
});
