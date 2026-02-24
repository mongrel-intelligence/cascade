import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubWebhookManager } from '../../../../src/api/services/github-webhooks.js';

const mockListWebhooks = vi.fn();
const mockCreateWebhook = vi.fn();
const mockDeleteWebhook = vi.fn();

vi.mock('@octokit/rest', () => ({
	Octokit: vi.fn(() => ({
		repos: {
			listWebhooks: mockListWebhooks,
			createWebhook: mockCreateWebhook,
			deleteWebhook: mockDeleteWebhook,
		},
	})),
}));

vi.mock('../../../../src/utils/repo.js', () => ({
	parseRepoFullName: (fullName: string) => {
		const idx = fullName.indexOf('/');
		return { owner: fullName.slice(0, idx), repo: fullName.slice(idx + 1) };
	},
}));

const baseCtx = {
	githubToken: 'ghp_test',
	repo: 'owner/my-repo',
};

describe('GitHubWebhookManager', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('list', () => {
		it('returns webhooks from Octokit', async () => {
			const webhooks = [
				{ id: 1, name: 'web', active: true, events: ['push'], config: { url: 'http://a' } },
			];
			mockListWebhooks.mockResolvedValue({ data: webhooks });

			const mgr = new GitHubWebhookManager(baseCtx);
			const result = await mgr.list();

			expect(result).toHaveLength(1);
			expect(result[0].id).toBe(1);
			expect(mockListWebhooks).toHaveBeenCalledWith({ owner: 'owner', repo: 'my-repo' });
		});
	});

	describe('create', () => {
		it('creates a webhook with required events', async () => {
			const created = {
				id: 42,
				name: 'web',
				active: true,
				events: ['pull_request', 'pull_request_review', 'check_suite', 'issue_comment'],
				config: { url: 'http://example.com/github/webhook', content_type: 'json' },
			};
			mockCreateWebhook.mockResolvedValue({ data: created });

			const mgr = new GitHubWebhookManager(baseCtx);
			const result = await mgr.create('http://example.com/github/webhook');

			expect(result.id).toBe(42);
			expect(mockCreateWebhook).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: 'owner',
					repo: 'my-repo',
					config: expect.objectContaining({ content_type: 'json' }),
					events: expect.arrayContaining(['pull_request', 'check_suite']),
					active: true,
				}),
			);
		});
	});

	describe('delete', () => {
		it('deletes a webhook by hookId', async () => {
			mockDeleteWebhook.mockResolvedValue({});

			const mgr = new GitHubWebhookManager(baseCtx);
			await expect(mgr.delete(42)).resolves.toBeUndefined();

			expect(mockDeleteWebhook).toHaveBeenCalledWith({
				owner: 'owner',
				repo: 'my-repo',
				hook_id: 42,
			});
		});
	});
});
