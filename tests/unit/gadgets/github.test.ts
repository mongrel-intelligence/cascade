import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreatePR } from '../../../src/gadgets/github/CreatePR.js';
import { githubClient } from '../../../src/github/client.js';
import { runCommand } from '../../../src/utils/repo.js';

// Mock the github client
vi.mock('../../../src/github/client.js', () => ({
	githubClient: {
		branchExists: vi.fn(),
		createPR: vi.fn(),
	},
}));

// Mock runCommand for git push
vi.mock('../../../src/utils/repo.js', () => ({
	runCommand: vi.fn(),
}));

describe('GitHub Gadgets', () => {
	describe('CreatePR', () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

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

		it('mentions push behavior in description', () => {
			const gadget = new CreatePR();
			expect(gadget.description).toContain('Push the branch to remote');
		});

		it('throws error when branch does not exist (commit=false, push=false)', async () => {
			vi.mocked(githubClient.branchExists).mockResolvedValue(false);

			const gadget = new CreatePR();
			await expect(
				gadget.execute({
					owner: 'test-owner',
					repo: 'test-repo',
					title: 'Test PR',
					body: 'Test body',
					head: 'feature/test',
					base: 'main',
					commit: false,
					push: false,
				}),
			).rejects.toThrow('does not exist on remote');

			expect(githubClient.createPR).not.toHaveBeenCalled();
		});

		it('creates PR when branch exists (commit=false, push=false)', async () => {
			vi.mocked(githubClient.branchExists).mockResolvedValue(true);
			vi.mocked(githubClient.createPR).mockResolvedValue({
				number: 42,
				htmlUrl: 'https://github.com/test-owner/test-repo/pull/42',
				title: 'Test PR',
			});

			const gadget = new CreatePR();
			const result = await gadget.execute({
				owner: 'test-owner',
				repo: 'test-repo',
				title: 'Test PR',
				body: 'Test body',
				head: 'feature/test',
				base: 'main',
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
			expect(runCommand).not.toHaveBeenCalled();
		});

		it('includes draft label when creating draft PR', async () => {
			vi.mocked(githubClient.branchExists).mockResolvedValue(true);
			vi.mocked(githubClient.createPR).mockResolvedValue({
				number: 43,
				htmlUrl: 'https://github.com/test-owner/test-repo/pull/43',
				title: 'Draft PR',
			});

			const gadget = new CreatePR();
			const result = await gadget.execute({
				owner: 'test-owner',
				repo: 'test-repo',
				title: 'Draft PR',
				body: 'Test body',
				head: 'feature/draft',
				base: 'main',
				draft: true,
				commit: false,
				push: false,
			});

			expect(result).toContain('(draft)');
		});

		it('commits and pushes branch before creating PR by default', async () => {
			vi.mocked(runCommand).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
			vi.mocked(githubClient.branchExists).mockResolvedValue(true);
			vi.mocked(githubClient.createPR).mockResolvedValue({
				number: 44,
				htmlUrl: 'https://github.com/test-owner/test-repo/pull/44',
				title: 'Test PR',
			});

			const gadget = new CreatePR();
			const result = await gadget.execute({
				owner: 'test-owner',
				repo: 'test-repo',
				title: 'Test PR',
				body: 'Test body',
				head: 'feature/test',
				base: 'main',
			});

			// Should stage changes
			expect(runCommand).toHaveBeenCalledWith('git', ['add', '.'], expect.any(String));
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

		it('commits changes when there are unstaged changes', async () => {
			vi.mocked(runCommand)
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git add
				.mockResolvedValueOnce({ stdout: 'M file.ts', stderr: '', exitCode: 0 }) // git status --porcelain
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git commit
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }); // git push
			vi.mocked(githubClient.branchExists).mockResolvedValue(true);
			vi.mocked(githubClient.createPR).mockResolvedValue({
				number: 45,
				htmlUrl: 'https://github.com/test-owner/test-repo/pull/45',
				title: 'Test PR',
			});

			const gadget = new CreatePR();
			await gadget.execute({
				owner: 'test-owner',
				repo: 'test-repo',
				title: 'Test PR',
				body: 'Test body',
				head: 'feature/test',
				base: 'main',
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
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git add
				.mockResolvedValueOnce({ stdout: 'M file.ts', stderr: '', exitCode: 0 }) // git status --porcelain
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git commit
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }); // git push
			vi.mocked(githubClient.branchExists).mockResolvedValue(true);
			vi.mocked(githubClient.createPR).mockResolvedValue({
				number: 46,
				htmlUrl: 'https://github.com/test-owner/test-repo/pull/46',
				title: 'Test PR',
			});

			const gadget = new CreatePR();
			await gadget.execute({
				owner: 'test-owner',
				repo: 'test-repo',
				title: 'Test PR',
				body: 'Test body',
				head: 'feature/test',
				base: 'main',
				commitMessage: 'feat(test): custom commit message',
			});

			expect(runCommand).toHaveBeenCalledWith(
				'git',
				['commit', '-m', 'feat(test): custom commit message'],
				expect.any(String),
			);
		});

		it('skips commit when commit=false', async () => {
			vi.mocked(runCommand).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
			vi.mocked(githubClient.branchExists).mockResolvedValue(true);
			vi.mocked(githubClient.createPR).mockResolvedValue({
				number: 47,
				htmlUrl: 'https://github.com/test-owner/test-repo/pull/47',
				title: 'Test PR',
			});

			const gadget = new CreatePR();
			await gadget.execute({
				owner: 'test-owner',
				repo: 'test-repo',
				title: 'Test PR',
				body: 'Test body',
				head: 'feature/test',
				base: 'main',
				commit: false,
			});

			// Should NOT call git add or git commit
			expect(runCommand).not.toHaveBeenCalledWith('git', ['add', '.'], expect.any(String));
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
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git add
				.mockResolvedValueOnce({ stdout: 'M file.ts', stderr: '', exitCode: 0 }) // git status --porcelain
				.mockResolvedValueOnce({
					stdout: '',
					stderr: 'error: pre-commit hook failed',
					exitCode: 1,
				}); // git commit

			const gadget = new CreatePR();
			await expect(
				gadget.execute({
					owner: 'test-owner',
					repo: 'test-repo',
					title: 'Test PR',
					body: 'Test body',
					head: 'feature/test',
					base: 'main',
				}),
			).rejects.toThrow('COMMIT FAILED');

			expect(githubClient.branchExists).not.toHaveBeenCalled();
			expect(githubClient.createPR).not.toHaveBeenCalled();
		});

		it('throws error when push fails', async () => {
			vi.mocked(runCommand)
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git add
				.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git status --porcelain (no changes)
				.mockResolvedValueOnce({
					stdout: '',
					stderr: 'error: failed to push some refs',
					exitCode: 1,
				}); // git push

			const gadget = new CreatePR();
			await expect(
				gadget.execute({
					owner: 'test-owner',
					repo: 'test-repo',
					title: 'Test PR',
					body: 'Test body',
					head: 'feature/test',
					base: 'main',
				}),
			).rejects.toThrow('PUSH FAILED');

			expect(githubClient.branchExists).not.toHaveBeenCalled();
			expect(githubClient.createPR).not.toHaveBeenCalled();
		});
	});
});
