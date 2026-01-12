import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreatePR } from '../../../src/gadgets/github/CreatePR.js';
import { githubClient } from '../../../src/github/client.js';

// Mock the github client
vi.mock('../../../src/github/client.js', () => ({
	githubClient: {
		branchExists: vi.fn(),
		createPR: vi.fn(),
	},
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

		it('mentions push requirement in description', () => {
			const gadget = new CreatePR();
			expect(gadget.description).toContain('Push the branch to remote');
		});

		it('returns error when branch does not exist', async () => {
			vi.mocked(githubClient.branchExists).mockResolvedValue(false);

			const gadget = new CreatePR();
			const result = await gadget.execute({
				owner: 'test-owner',
				repo: 'test-repo',
				title: 'Test PR',
				body: 'Test body',
				head: 'feature/test',
				base: 'main',
			});

			expect(result).toContain('does not exist on remote');
			expect(result).toContain('feature/test');
			expect(result).toContain('git push');
			expect(githubClient.createPR).not.toHaveBeenCalled();
		});

		it('creates PR when branch exists', async () => {
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
			});

			expect(result).toContain('(draft)');
		});
	});
});
