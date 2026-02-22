import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/github/client.js', () => ({
	githubClient: {
		createPR: vi.fn(),
		getOpenPRByBranch: vi.fn(),
	},
}));

vi.mock('../../../../../src/utils/repo.js', () => ({
	runCommand: vi.fn(),
}));

import { createPR } from '../../../../../src/gadgets/github/core/createPR.js';
import { githubClient } from '../../../../../src/github/client.js';
import { runCommand } from '../../../../../src/utils/repo.js';

const mockGithub = vi.mocked(githubClient);
const mockRunCommand = vi.mocked(runCommand);

const HTTPS_URL = 'https://github.com/test-owner/test-repo.git';
const SSH_URL = 'git@github.com:test-owner/test-repo.git';

function mockGitCommands(
	delegate?: (cmd: string, args?: string[]) => { stdout: string; stderr: string; exitCode: number },
) {
	mockRunCommand.mockImplementation(async (cmd, args) => {
		// Auto-detect owner/repo from git remote
		if (args?.[0] === 'remote') {
			return { stdout: HTTPS_URL, stderr: '', exitCode: 0 };
		}
		if (delegate) {
			return delegate(cmd, args);
		}
		// Default: all git commands succeed
		return { stdout: '', stderr: '', exitCode: 0 };
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('detectOwnerRepo (tested through createPR)', () => {
	it('parses HTTPS URL', async () => {
		mockRunCommand.mockImplementation(async (_cmd, args) => {
			if (args?.[0] === 'remote') {
				return { stdout: HTTPS_URL, stderr: '', exitCode: 0 };
			}
			if (args?.[0] === 'ls-remote') {
				return { stdout: 'abc123\trefs/heads/feat', stderr: '', exitCode: 0 };
			}
			return { stdout: '', stderr: '', exitCode: 0 };
		});

		mockGithub.createPR.mockResolvedValue({
			number: 1,
			htmlUrl: 'https://github.com/test-owner/test-repo/pull/1',
		} as Awaited<ReturnType<typeof mockGithub.createPR>>);

		const result = await createPR({
			title: 'Test',
			body: 'Body',
			head: 'feat',
			base: 'main',
			commit: false,
			push: false,
		});

		expect(mockGithub.createPR).toHaveBeenCalledWith('test-owner', 'test-repo', expect.any(Object));
	});

	it('parses SSH URL', async () => {
		mockRunCommand.mockImplementation(async (_cmd, args) => {
			if (args?.[0] === 'remote') {
				return { stdout: SSH_URL, stderr: '', exitCode: 0 };
			}
			if (args?.[0] === 'ls-remote') {
				return { stdout: 'abc123\trefs/heads/feat', stderr: '', exitCode: 0 };
			}
			return { stdout: '', stderr: '', exitCode: 0 };
		});

		mockGithub.createPR.mockResolvedValue({
			number: 1,
			htmlUrl: 'https://github.com/test-owner/test-repo/pull/1',
		} as Awaited<ReturnType<typeof mockGithub.createPR>>);

		await createPR({
			title: 'Test',
			body: 'Body',
			head: 'feat',
			base: 'main',
			commit: false,
			push: false,
		});

		expect(mockGithub.createPR).toHaveBeenCalledWith('test-owner', 'test-repo', expect.any(Object));
	});

	it('handles URLs without .git suffix', async () => {
		mockRunCommand.mockImplementation(async (_cmd, args) => {
			if (args?.[0] === 'remote') {
				return { stdout: 'https://github.com/owner/repo', stderr: '', exitCode: 0 };
			}
			if (args?.[0] === 'ls-remote') {
				return { stdout: 'abc123\trefs/heads/feat', stderr: '', exitCode: 0 };
			}
			return { stdout: '', stderr: '', exitCode: 0 };
		});

		mockGithub.createPR.mockResolvedValue({
			number: 1,
			htmlUrl: 'https://github.com/owner/repo/pull/1',
		} as Awaited<ReturnType<typeof mockGithub.createPR>>);

		await createPR({
			title: 'Test',
			body: 'Body',
			head: 'feat',
			base: 'main',
			commit: false,
			push: false,
		});

		expect(mockGithub.createPR).toHaveBeenCalledWith('owner', 'repo', expect.any(Object));
	});

	it('throws when no remote origin', async () => {
		mockRunCommand.mockImplementation(async (_cmd, args) => {
			if (args?.[0] === 'remote') {
				return { stdout: '', stderr: 'fatal: not found', exitCode: 1 };
			}
			return { stdout: '', stderr: '', exitCode: 0 };
		});

		await expect(
			createPR({ title: 'T', body: 'B', head: 'feat', base: 'main', commit: false, push: false }),
		).rejects.toThrow('no git remote "origin"');
	});

	it('throws when URL format is unparseable', async () => {
		mockRunCommand.mockImplementation(async (_cmd, args) => {
			if (args?.[0] === 'remote') {
				return { stdout: 'https://notgithub.example.com/repo', stderr: '', exitCode: 0 };
			}
			return { stdout: '', stderr: '', exitCode: 0 };
		});

		await expect(
			createPR({ title: 'T', body: 'B', head: 'feat', base: 'main', commit: false, push: false }),
		).rejects.toThrow('Cannot parse owner/repo');
	});
});

describe('stageAndCommit (tested through createPR)', () => {
	it('stages tracked changes and commits', async () => {
		const calls: string[][] = [];
		mockRunCommand.mockImplementation(async (cmd, args) => {
			calls.push(args || []);
			if (args?.[0] === 'remote') {
				return { stdout: HTTPS_URL, stderr: '', exitCode: 0 };
			}
			if (args?.[0] === 'ls-files') {
				return { stdout: '', stderr: '', exitCode: 0 }; // no untracked files
			}
			if (args?.[0] === 'status' && args?.[1] === '--porcelain') {
				return { stdout: 'M file.ts', stderr: '', exitCode: 0 };
			}
			if (args?.[0] === 'ls-remote') {
				return { stdout: 'abc123\trefs/heads/feat', stderr: '', exitCode: 0 };
			}
			return { stdout: '', stderr: '', exitCode: 0 };
		});

		mockGithub.createPR.mockResolvedValue({
			number: 1,
			htmlUrl: 'https://github.com/test-owner/test-repo/pull/1',
		} as Awaited<ReturnType<typeof mockGithub.createPR>>);

		await createPR({
			title: 'Test PR',
			body: 'Body',
			head: 'feat',
			base: 'main',
		});

		// Should have called git add -u
		expect(calls.some((c) => c[0] === 'add' && c[1] === '-u')).toBe(true);
		// Should have called git commit
		expect(calls.some((c) => c[0] === 'commit')).toBe(true);
	});

	it('stages untracked files individually', async () => {
		const calls: string[][] = [];
		mockRunCommand.mockImplementation(async (cmd, args) => {
			calls.push(args || []);
			if (args?.[0] === 'remote') {
				return { stdout: HTTPS_URL, stderr: '', exitCode: 0 };
			}
			if (args?.[0] === 'ls-files') {
				return { stdout: 'new-file.ts\nanother.ts', stderr: '', exitCode: 0 };
			}
			if (args?.[0] === 'status' && args?.[1] === '--porcelain') {
				return { stdout: 'A new-file.ts', stderr: '', exitCode: 0 };
			}
			if (args?.[0] === 'ls-remote') {
				return { stdout: 'abc123\trefs/heads/feat', stderr: '', exitCode: 0 };
			}
			return { stdout: '', stderr: '', exitCode: 0 };
		});

		mockGithub.createPR.mockResolvedValue({
			number: 1,
			htmlUrl: 'https://github.com/test-owner/test-repo/pull/1',
		} as Awaited<ReturnType<typeof mockGithub.createPR>>);

		await createPR({
			title: 'Test',
			body: 'Body',
			head: 'feat',
			base: 'main',
		});

		// Should have called git add -- new-file.ts another.ts
		expect(calls.some((c) => c[0] === 'add' && c[1] === '--' && c.includes('new-file.ts'))).toBe(
			true,
		);
	});

	it('skips commit when nothing staged', async () => {
		const calls: string[][] = [];
		mockRunCommand.mockImplementation(async (cmd, args) => {
			calls.push(args || []);
			if (args?.[0] === 'remote') {
				return { stdout: HTTPS_URL, stderr: '', exitCode: 0 };
			}
			if (args?.[0] === 'ls-files') {
				return { stdout: '', stderr: '', exitCode: 0 };
			}
			if (args?.[0] === 'status' && args?.[1] === '--porcelain') {
				return { stdout: '', stderr: '', exitCode: 0 }; // nothing staged
			}
			if (args?.[0] === 'ls-remote') {
				return { stdout: 'abc123\trefs/heads/feat', stderr: '', exitCode: 0 };
			}
			return { stdout: '', stderr: '', exitCode: 0 };
		});

		mockGithub.createPR.mockResolvedValue({
			number: 1,
			htmlUrl: 'https://github.com/test-owner/test-repo/pull/1',
		} as Awaited<ReturnType<typeof mockGithub.createPR>>);

		await createPR({ title: 'Test', body: 'Body', head: 'feat', base: 'main' });

		// Should NOT have called git commit
		expect(calls.some((c) => c[0] === 'commit')).toBe(false);
	});

	it('throws with hook output when commit fails', async () => {
		mockRunCommand.mockImplementation(async (_cmd, args) => {
			if (args?.[0] === 'remote') {
				return { stdout: HTTPS_URL, stderr: '', exitCode: 0 };
			}
			if (args?.[0] === 'ls-files') {
				return { stdout: '', stderr: '', exitCode: 0 };
			}
			if (args?.[0] === 'status' && args?.[1] === '--porcelain') {
				return { stdout: 'M file.ts', stderr: '', exitCode: 0 };
			}
			if (args?.[0] === 'commit') {
				return { stdout: 'hook output', stderr: 'pre-commit failed', exitCode: 1 };
			}
			return { stdout: '', stderr: '', exitCode: 0 };
		});

		await expect(
			createPR({ title: 'Test', body: 'Body', head: 'feat', base: 'main' }),
		).rejects.toThrow('COMMIT FAILED');
	});
});

describe('pushBranch (tested through createPR)', () => {
	it('pushes with -u origin flag', async () => {
		const calls: string[][] = [];
		mockGitCommands((cmd, args) => {
			calls.push(args || []);
			if (args?.[0] === 'status' && args?.[1] === '--porcelain') {
				return { stdout: '', stderr: '', exitCode: 0 };
			}
			if (args?.[0] === 'ls-remote') {
				return { stdout: 'abc\trefs/heads/feat', stderr: '', exitCode: 0 };
			}
			return { stdout: '', stderr: '', exitCode: 0 };
		});

		mockGithub.createPR.mockResolvedValue({
			number: 1,
			htmlUrl: 'https://github.com/test-owner/test-repo/pull/1',
		} as Awaited<ReturnType<typeof mockGithub.createPR>>);

		await createPR({ title: 'Test', body: 'Body', head: 'feat', base: 'main', commit: false });

		expect(calls.some((c) => c[0] === 'push' && c.includes('-u') && c.includes('feat'))).toBe(true);
	});

	it('throws with hook output when push fails', async () => {
		mockRunCommand.mockImplementation(async (_cmd, args) => {
			if (args?.[0] === 'remote') {
				return { stdout: HTTPS_URL, stderr: '', exitCode: 0 };
			}
			if (args?.[0] === 'push') {
				return { stdout: '', stderr: 'pre-push hook failed', exitCode: 1 };
			}
			return { stdout: '', stderr: '', exitCode: 0 };
		});

		await expect(
			createPR({ title: 'Test', body: 'Body', head: 'feat', base: 'main', commit: false }),
		).rejects.toThrow('PUSH FAILED');
	});
});

describe('verifyBranchOnRemote (tested through createPR)', () => {
	it('throws when branch not on remote', async () => {
		mockGitCommands((cmd, args) => {
			if (args?.[0] === 'ls-remote') {
				return { stdout: '', stderr: '', exitCode: 0 }; // empty = not found
			}
			return { stdout: '', stderr: '', exitCode: 0 };
		});

		await expect(
			createPR({
				title: 'Test',
				body: 'Body',
				head: 'feat',
				base: 'main',
				commit: false,
				push: false,
			}),
		).rejects.toThrow("Branch 'feat' does not exist on remote");
	});
});

describe('createPR', () => {
	function setupSuccessfulGitCommands() {
		mockGitCommands((cmd, args) => {
			if (args?.[0] === 'status' && args?.[1] === '--porcelain') {
				return { stdout: '', stderr: '', exitCode: 0 };
			}
			if (args?.[0] === 'ls-remote') {
				return { stdout: 'abc\trefs/heads/feat', stderr: '', exitCode: 0 };
			}
			return { stdout: '', stderr: '', exitCode: 0 };
		});
	}

	it('commits and pushes by default', async () => {
		const calls: string[][] = [];
		mockRunCommand.mockImplementation(async (cmd, args) => {
			calls.push(args || []);
			if (args?.[0] === 'remote') return { stdout: HTTPS_URL, stderr: '', exitCode: 0 };
			if (args?.[0] === 'status' && args?.[1] === '--porcelain')
				return { stdout: '', stderr: '', exitCode: 0 };
			if (args?.[0] === 'ls-remote')
				return { stdout: 'abc\trefs/heads/feat', stderr: '', exitCode: 0 };
			return { stdout: '', stderr: '', exitCode: 0 };
		});

		mockGithub.createPR.mockResolvedValue({
			number: 1,
			htmlUrl: 'https://github.com/test-owner/test-repo/pull/1',
		} as Awaited<ReturnType<typeof mockGithub.createPR>>);

		await createPR({ title: 'Test', body: 'Body', head: 'feat', base: 'main' });

		// Should call git add (part of commit) and git push
		expect(calls.some((c) => c[0] === 'add')).toBe(true);
		expect(calls.some((c) => c[0] === 'push')).toBe(true);
	});

	it('skips commit when commit=false', async () => {
		const calls: string[][] = [];
		mockRunCommand.mockImplementation(async (cmd, args) => {
			calls.push(args || []);
			if (args?.[0] === 'remote') return { stdout: HTTPS_URL, stderr: '', exitCode: 0 };
			if (args?.[0] === 'ls-remote')
				return { stdout: 'abc\trefs/heads/feat', stderr: '', exitCode: 0 };
			return { stdout: '', stderr: '', exitCode: 0 };
		});

		mockGithub.createPR.mockResolvedValue({
			number: 1,
			htmlUrl: 'https://github.com/test-owner/test-repo/pull/1',
		} as Awaited<ReturnType<typeof mockGithub.createPR>>);

		await createPR({ title: 'Test', body: 'Body', head: 'feat', base: 'main', commit: false });

		expect(calls.some((c) => c[0] === 'add' && c[1] === '-u')).toBe(false);
		expect(calls.some((c) => c[0] === 'commit')).toBe(false);
	});

	it('skips push when push=false', async () => {
		const calls: string[][] = [];
		mockRunCommand.mockImplementation(async (cmd, args) => {
			calls.push(args || []);
			if (args?.[0] === 'remote') return { stdout: HTTPS_URL, stderr: '', exitCode: 0 };
			if (args?.[0] === 'ls-remote')
				return { stdout: 'abc\trefs/heads/feat', stderr: '', exitCode: 0 };
			return { stdout: '', stderr: '', exitCode: 0 };
		});

		mockGithub.createPR.mockResolvedValue({
			number: 1,
			htmlUrl: 'https://github.com/test-owner/test-repo/pull/1',
		} as Awaited<ReturnType<typeof mockGithub.createPR>>);

		await createPR({
			title: 'Test',
			body: 'Body',
			head: 'feat',
			base: 'main',
			commit: false,
			push: false,
		});

		expect(calls.some((c) => c[0] === 'push')).toBe(false);
	});

	it('returns CreatePRResult on success', async () => {
		setupSuccessfulGitCommands();
		mockGithub.createPR.mockResolvedValue({
			number: 42,
			htmlUrl: 'https://github.com/test-owner/test-repo/pull/42',
		} as Awaited<ReturnType<typeof mockGithub.createPR>>);

		const result = await createPR({
			title: 'My PR',
			body: 'Body',
			head: 'feat',
			base: 'main',
			commit: false,
			push: false,
		});

		expect(result).toEqual({
			prNumber: 42,
			prUrl: 'https://github.com/test-owner/test-repo/pull/42',
			repoFullName: 'test-owner/test-repo',
			alreadyExisted: false,
		});
	});

	it('handles 422 duplicate PR — returns existing PR with alreadyExisted=true', async () => {
		setupSuccessfulGitCommands();

		const error = new Error('A pull request already exists for this branch');
		(error as Error & { status: number }).status = 422;
		mockGithub.createPR.mockRejectedValue(error);

		mockGithub.getOpenPRByBranch.mockResolvedValue({
			number: 10,
			htmlUrl: 'https://github.com/test-owner/test-repo/pull/10',
		} as Awaited<ReturnType<typeof mockGithub.getOpenPRByBranch>>);

		const result = await createPR({
			title: 'Test',
			body: 'Body',
			head: 'feat',
			base: 'main',
			commit: false,
			push: false,
		});

		expect(result).toEqual({
			prNumber: 10,
			prUrl: 'https://github.com/test-owner/test-repo/pull/10',
			repoFullName: 'test-owner/test-repo',
			alreadyExisted: true,
		});
	});

	it('re-throws non-422 errors', async () => {
		setupSuccessfulGitCommands();

		const error = new Error('Server error');
		(error as Error & { status: number }).status = 500;
		mockGithub.createPR.mockRejectedValue(error);

		await expect(
			createPR({
				title: 'Test',
				body: 'Body',
				head: 'feat',
				base: 'main',
				commit: false,
				push: false,
			}),
		).rejects.toThrow('Server error');
	});

	it('uses custom commitMessage when provided', async () => {
		const calls: string[][] = [];
		mockRunCommand.mockImplementation(async (cmd, args) => {
			calls.push(args || []);
			if (args?.[0] === 'remote') return { stdout: HTTPS_URL, stderr: '', exitCode: 0 };
			if (args?.[0] === 'status' && args?.[1] === '--porcelain')
				return { stdout: 'M file.ts', stderr: '', exitCode: 0 };
			if (args?.[0] === 'ls-remote')
				return { stdout: 'abc\trefs/heads/feat', stderr: '', exitCode: 0 };
			return { stdout: '', stderr: '', exitCode: 0 };
		});

		mockGithub.createPR.mockResolvedValue({
			number: 1,
			htmlUrl: 'https://github.com/test-owner/test-repo/pull/1',
		} as Awaited<ReturnType<typeof mockGithub.createPR>>);

		await createPR({
			title: 'PR Title',
			body: 'Body',
			head: 'feat',
			base: 'main',
			commitMessage: 'Custom commit message',
		});

		const commitCall = calls.find((c) => c[0] === 'commit');
		expect(commitCall).toBeDefined();
		expect(commitCall).toContain('Custom commit message');
	});
});
