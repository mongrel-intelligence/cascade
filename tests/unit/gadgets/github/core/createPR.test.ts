import { describe, expect, it, vi } from 'vitest';

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

		const _result = await createPR({
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
		mockRunCommand.mockImplementation(async (_cmd, args) => {
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
		mockRunCommand.mockImplementation(async (_cmd, args) => {
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
		mockRunCommand.mockImplementation(async (_cmd, args) => {
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
		mockGitCommands((_cmd, args) => {
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
		mockGitCommands((_cmd, args) => {
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
		mockGitCommands((_cmd, args) => {
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
		mockRunCommand.mockImplementation(async (_cmd, args) => {
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
		mockRunCommand.mockImplementation(async (_cmd, args) => {
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
		mockRunCommand.mockImplementation(async (_cmd, args) => {
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
		mockRunCommand.mockImplementation(async (_cmd, args) => {
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

// ────────────────────────────────────────────────────────────────────────────
// Spec 013: captured hook output preservation
// (The per-caller timeout assertions that used to live here were removed
// together with the timeouts they pinned — pre-commit / pre-push hooks can
// legitimately run for minutes and the harness handles long calls.  The new
// "regression: stay disabled" block below pins the current contract.)
// ────────────────────────────────────────────────────────────────────────────

describe('captured hook output preservation (spec 013)', () => {
	it('createPR result carries captured push output on success', async () => {
		mockRunCommand.mockImplementation(async (_cmd, args) => {
			if (args?.[0] === 'remote') return { stdout: HTTPS_URL, stderr: '', exitCode: 0 };
			if (args?.[0] === 'push')
				return {
					stdout: 'Pre-push hook ran: typecheck OK\n',
					stderr: 'To github.com...\n',
					exitCode: 0,
				};
			if (args?.[0] === 'ls-remote')
				return { stdout: 'abc\trefs/heads/feat', stderr: '', exitCode: 0 };
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
			push: true,
		});

		expect(result.pushOutput).toBeDefined();
		expect(result.pushOutput).toContain('Pre-push hook ran: typecheck OK');
	});

	it('createPR result carries captured commit output on success', async () => {
		mockRunCommand.mockImplementation(async (_cmd, args) => {
			if (args?.[0] === 'remote') return { stdout: HTTPS_URL, stderr: '', exitCode: 0 };
			if (args?.[0] === 'status') return { stdout: 'M foo.ts\n', stderr: '', exitCode: 0 };
			if (args?.[0] === 'commit')
				return {
					stdout: 'Pre-commit hook ran: biome OK\n[feat abc123] msg\n',
					stderr: '',
					exitCode: 0,
				};
			if (args?.[0] === 'ls-remote')
				return { stdout: 'abc\trefs/heads/feat', stderr: '', exitCode: 0 };
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
			commit: true,
			push: false,
		});

		expect(result.commitOutput).toBeDefined();
		expect(result.commitOutput).toContain('Pre-commit hook ran: biome OK');
	});

	// Prod regression 2026-05-09 (run d8e31665, cascade/fe82YUKV): a successful
	// `cascade-tools scm create-pr` returned 97 KB of `pushOutput` (lefthook's
	// pre-push test:fast suite — 159 files, 2981 tests captured into the gadget
	// result). Codex's tool-result parser couldn't extract the JSON envelope
	// buried under that volume, retried the call, and the resulting concurrent
	// invocations raced against the same sidecar path leaving prUrl missing.
	// The full hook output stays in the worker's engine log (LLMIST_LOG_FILE)
	// for operator visibility — only the agent-visible result-stream copy is
	// truncated.
	describe('hook-output truncation (prod regression d8e31665)', () => {
		it('truncates a 97 KB pushOutput to ~4 KB with a clear marker', async () => {
			const huge = 'A'.repeat(97 * 1024); // mimic the cascade prod payload
			mockRunCommand.mockImplementation(async (_cmd, args) => {
				if (args?.[0] === 'remote') return { stdout: HTTPS_URL, stderr: '', exitCode: 0 };
				if (args?.[0] === 'push') return { stdout: huge, stderr: '', exitCode: 0 };
				if (args?.[0] === 'ls-remote')
					return { stdout: 'abc\trefs/heads/feat', stderr: '', exitCode: 0 };
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
				push: true,
			});

			// Result shape unchanged; pushOutput just smaller.
			expect(result.prNumber).toBe(1);
			expect(result.prUrl).toBe('https://github.com/test-owner/test-repo/pull/1');
			expect(result.pushOutput).toBeDefined();
			// Capped well under the original 97 KB.
			expect(result.pushOutput!.length).toBeLessThan(10 * 1024);
			// Marker tells operators where to find the full output.
			expect(result.pushOutput).toMatch(/bytes truncated from push/i);
			// Both ends of the output are preserved (head + tail) for context.
			expect(result.pushOutput).toMatch(/^A+/);
			expect(result.pushOutput).toMatch(/A+$/);
		});

		it('truncates an oversized commitOutput the same way', async () => {
			const huge = 'C'.repeat(50 * 1024);
			mockRunCommand.mockImplementation(async (_cmd, args) => {
				if (args?.[0] === 'remote') return { stdout: HTTPS_URL, stderr: '', exitCode: 0 };
				if (args?.[0] === 'status') return { stdout: 'M foo.ts\n', stderr: '', exitCode: 0 };
				if (args?.[0] === 'commit') return { stdout: huge, stderr: '', exitCode: 0 };
				if (args?.[0] === 'ls-remote')
					return { stdout: 'abc\trefs/heads/feat', stderr: '', exitCode: 0 };
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
				commit: true,
				push: false,
			});

			expect(result.commitOutput).toBeDefined();
			expect(result.commitOutput!.length).toBeLessThan(10 * 1024);
			expect(result.commitOutput).toMatch(/bytes truncated from commit/i);
		});

		// Reviewer feedback (PR #1292): failing hooks embed the full captured
		// output in err.message, which createCLICommand serialises into the JSON
		// error envelope. A pre-push hook that fails after printing 97 KB of test
		// output still hits the parser/retry bloat path unless the error message
		// itself is truncated. Verify both commit and push failure paths.
		it('truncates error message when pre-push hook fails with large output', async () => {
			const huge = 'E'.repeat(50 * 1024); // 50 KB of hook failure output
			mockRunCommand.mockImplementation(async (_cmd, args) => {
				if (args?.[0] === 'remote') return { stdout: HTTPS_URL, stderr: '', exitCode: 0 };
				if (args?.[0] === 'push') return { stdout: huge, stderr: 'hook failed', exitCode: 1 };
				return { stdout: '', stderr: '', exitCode: 0 };
			});

			let thrownError: Error | undefined;
			try {
				await createPR({
					title: 'Test',
					body: 'Body',
					head: 'feat',
					base: 'main',
					commit: false,
					push: true,
				});
			} catch (e) {
				thrownError = e as Error;
			}
			expect(thrownError).toBeDefined();
			expect(thrownError?.message).toMatch(/PUSH FAILED/);
			// Error message must be capped — same 4 KB limit as the success path.
			expect((thrownError?.message ?? '').length).toBeLessThan(10 * 1024);
			expect(thrownError?.message).toMatch(/bytes truncated from push/i);
		});

		it('truncates error message when pre-commit hook fails with large output', async () => {
			const huge = 'F'.repeat(50 * 1024); // 50 KB of hook failure output
			mockRunCommand.mockImplementation(async (_cmd, args) => {
				if (args?.[0] === 'remote') return { stdout: HTTPS_URL, stderr: '', exitCode: 0 };
				if (args?.[0] === 'status') return { stdout: 'M foo.ts\n', stderr: '', exitCode: 0 };
				if (args?.[0] === 'commit')
					return { stdout: huge, stderr: 'pre-commit hook failed', exitCode: 1 };
				return { stdout: '', stderr: '', exitCode: 0 };
			});

			let thrownError: Error | undefined;
			try {
				await createPR({
					title: 'Test',
					body: 'Body',
					head: 'feat',
					base: 'main',
					commit: true,
					push: false,
				});
			} catch (e) {
				thrownError = e as Error;
			}
			expect(thrownError).toBeDefined();
			expect(thrownError?.message).toMatch(/COMMIT FAILED/);
			expect((thrownError?.message ?? '').length).toBeLessThan(10 * 1024);
			expect(thrownError?.message).toMatch(/bytes truncated from commit/i);
		});

		it('leaves small hook output untouched (no truncation marker)', async () => {
			mockRunCommand.mockImplementation(async (_cmd, args) => {
				if (args?.[0] === 'remote') return { stdout: HTTPS_URL, stderr: '', exitCode: 0 };
				if (args?.[0] === 'push')
					return {
						stdout: 'Pre-push hook ran: typecheck OK\n',
						stderr: 'To github.com...\n',
						exitCode: 0,
					};
				if (args?.[0] === 'ls-remote')
					return { stdout: 'abc\trefs/heads/feat', stderr: '', exitCode: 0 };
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
				push: true,
			});

			expect(result.pushOutput).toContain('Pre-push hook ran: typecheck OK');
			expect(result.pushOutput).not.toMatch(/bytes truncated/);
		});
	});
});

// ───────────────────────────────────────────────────────────────────────────
// Regression: subprocess timeouts on `git commit` and `git push` must stay
// disabled.  Pre-commit / pre-push hooks legitimately run for minutes (full
// test suites), and the agent harness that wraps this gadget already budgets
// long calls.  Re-introducing a shorter cap here is the exact failure mode
// that burned an earlier session — do not "just add a safety cap".
// ───────────────────────────────────────────────────────────────────────────
describe('subprocess timeouts — regression: stay disabled on hook-invoking calls', () => {
	function runCommandCallFor(args: string[]) {
		// Find the call whose args[0] matches (e.g. 'commit', 'push').
		return mockRunCommand.mock.calls.find((call) => {
			const callArgs = call[1];
			return Array.isArray(callArgs) && callArgs[0] === args[0];
		});
	}

	it('git commit is invoked with wallTimeoutMs=0 and idleTimeoutMs=0', async () => {
		mockRunCommand.mockReset();
		mockGitCommands((_cmd, args) => {
			if (args?.[0] === 'status') return { stdout: 'M foo.ts\n', stderr: '', exitCode: 0 };
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
			commit: true,
			push: false,
		});

		const commitCall = runCommandCallFor(['commit']);
		expect(commitCall).toBeDefined();
		// Positional arg 4 (0-indexed) is the RunCommandOptions bag.
		const opts = commitCall?.[4];
		expect(opts).toMatchObject({
			label: 'git-commit',
			wallTimeoutMs: 0,
			idleTimeoutMs: 0,
		});
	});

	it('git push is invoked with wallTimeoutMs=0 and idleTimeoutMs=0', async () => {
		mockRunCommand.mockReset();
		mockGitCommands((_cmd, args) => {
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
			push: true,
		});

		const pushCall = runCommandCallFor(['push']);
		expect(pushCall).toBeDefined();
		const opts = pushCall?.[4];
		expect(opts).toMatchObject({
			label: 'git-push',
			wallTimeoutMs: 0,
			idleTimeoutMs: 0,
		});
	});

	it('does not reference any legacy per-caller timeout constant name in runCommand options', async () => {
		// Sentinel against silent regression: if someone re-adds
		// PUSH_WALL_TIMEOUT_MS / COMMIT_IDLE_TIMEOUT_MS etc., they will likely
		// pass a non-zero number here.  Zero is the only accepted value.
		mockRunCommand.mockReset();
		mockGitCommands((_cmd, args) => {
			if (args?.[0] === 'status') return { stdout: 'M foo.ts\n', stderr: '', exitCode: 0 };
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
			commit: true,
			push: true,
		});

		for (const needle of ['commit', 'push']) {
			const call = runCommandCallFor([needle]);
			const opts = (call?.[4] ?? {}) as {
				wallTimeoutMs?: number;
				idleTimeoutMs?: number;
			};
			expect(opts.wallTimeoutMs, `${needle} wallTimeoutMs must be 0`).toBe(0);
			expect(opts.idleTimeoutMs, `${needle} idleTimeoutMs must be 0`).toBe(0);
		}
	});
});
