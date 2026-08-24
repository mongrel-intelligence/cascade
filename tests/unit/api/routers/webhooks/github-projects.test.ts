import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockOctokitCtor, mockListWebhooks, mockCreateWebhook, mockDeleteWebhook, mockLoggerWarn } =
	vi.hoisted(() => ({
		mockOctokitCtor: vi.fn(),
		mockListWebhooks: vi.fn(),
		mockCreateWebhook: vi.fn(),
		mockDeleteWebhook: vi.fn(),
		mockLoggerWarn: vi.fn(),
	}));

vi.mock('@octokit/rest', () => ({
	Octokit: mockOctokitCtor,
}));

vi.mock('../../../../../src/utils/logging.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: mockLoggerWarn, error: vi.fn() },
}));

import {
	GITHUB_PROJECTS_WEBHOOK_EVENTS,
	githubProjectsCreateWebhook,
	githubProjectsDeleteWebhook,
	githubProjectsListWebhooks,
} from '../../../../../src/api/routers/webhooks/github-projects.js';
import type { ProjectContext } from '../../../../../src/api/routers/webhooks/types.js';

const CALLBACK = 'https://cascade.example.com/github-projects/webhook';

function orgCtx(overrides: Partial<ProjectContext> = {}): ProjectContext {
	return {
		projectId: 'proj-1',
		orgId: 'org-1',
		pmType: 'github-projects',
		trelloApiKey: '',
		trelloToken: '',
		githubToken: '',
		githubProjectsOwner: 'acme-org',
		githubProjectsOwnerType: 'organization',
		githubProjectsToken: 'ghp_projects_test',
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockOctokitCtor.mockImplementation(() => ({
		orgs: {
			listWebhooks: mockListWebhooks,
			createWebhook: mockCreateWebhook,
			deleteWebhook: mockDeleteWebhook,
		},
	}));
});

describe('webhooks/github-projects', () => {
	describe('githubProjectsListWebhooks', () => {
		it('returns [] without instantiating Octokit when pmType is not github-projects', async () => {
			const result = await githubProjectsListWebhooks(orgCtx({ pmType: 'trello' }));

			expect(result).toEqual([]);
			expect(mockOctokitCtor).not.toHaveBeenCalled();
		});

		it('returns [] without instantiating Octokit when ownerType is user', async () => {
			const result = await githubProjectsListWebhooks(orgCtx({ githubProjectsOwnerType: 'user' }));

			expect(result).toEqual([]);
			expect(mockOctokitCtor).not.toHaveBeenCalled();
		});

		it('returns [] without instantiating Octokit when owner is missing', async () => {
			const result = await githubProjectsListWebhooks(orgCtx({ githubProjectsOwner: undefined }));

			expect(result).toEqual([]);
			expect(mockOctokitCtor).not.toHaveBeenCalled();
		});

		it('returns [] without instantiating Octokit when token is missing', async () => {
			const result = await githubProjectsListWebhooks(orgCtx({ githubProjectsToken: undefined }));

			expect(result).toEqual([]);
			expect(mockOctokitCtor).not.toHaveBeenCalled();
		});

		it('returns the org webhooks from Octokit on success', async () => {
			const webhooks = [
				{
					id: 1,
					name: 'web',
					active: true,
					events: ['projects_v2_item'],
					config: { url: CALLBACK },
				},
			];
			mockListWebhooks.mockResolvedValue({ data: webhooks });

			const result = await githubProjectsListWebhooks(orgCtx());

			expect(mockListWebhooks).toHaveBeenCalledWith({ org: 'acme-org' });
			expect(result).toEqual(webhooks);
		});

		it('catches Octokit errors, logs a warning, and returns []', async () => {
			mockListWebhooks.mockRejectedValue(new Error('boom'));

			const result = await githubProjectsListWebhooks(orgCtx());

			expect(result).toEqual([]);
			expect(mockLoggerWarn).toHaveBeenCalledWith(
				'[GitHubProjectsWebhook] Could not list org webhooks (continuing)',
				expect.objectContaining({ projectId: 'proj-1', org: 'acme-org' }),
			);
		});
	});

	describe('githubProjectsCreateWebhook', () => {
		it('throws BAD_REQUEST when ownerType is not organization', async () => {
			const err = await githubProjectsCreateWebhook(
				orgCtx({ githubProjectsOwnerType: 'user' }),
				CALLBACK,
			).catch((e) => e);

			expect(err).toBeInstanceOf(TRPCError);
			expect(err.code).toBe('BAD_REQUEST');
			expect(err.message).toContain('organization-owned GitHub Projects');
			expect(mockOctokitCtor).not.toHaveBeenCalled();
		});

		it('throws BAD_REQUEST when ownerType is organization but owner is missing', async () => {
			const err = await githubProjectsCreateWebhook(
				orgCtx({ githubProjectsOwner: undefined }),
				CALLBACK,
			).catch((e) => e);

			expect(err).toBeInstanceOf(TRPCError);
			expect(err.code).toBe('BAD_REQUEST');
			expect(mockOctokitCtor).not.toHaveBeenCalled();
		});

		it('throws BAD_REQUEST when token is missing', async () => {
			const err = await githubProjectsCreateWebhook(
				orgCtx({ githubProjectsToken: undefined }),
				CALLBACK,
			).catch((e) => e);

			expect(err).toBeInstanceOf(TRPCError);
			expect(err.code).toBe('BAD_REQUEST');
			expect(err.message).toBe('GitHub Projects token not configured');
			expect(mockOctokitCtor).not.toHaveBeenCalled();
		});

		it('deletes an existing webhook with the same callback URL before creating (dedup)', async () => {
			mockListWebhooks.mockResolvedValue({
				data: [{ id: 42, name: 'web', active: true, events: [], config: { url: CALLBACK } }],
			});
			mockDeleteWebhook.mockResolvedValue({});
			mockCreateWebhook.mockResolvedValue({
				data: {
					id: 99,
					name: 'web',
					active: true,
					events: GITHUB_PROJECTS_WEBHOOK_EVENTS,
					config: { url: CALLBACK },
				},
			});

			const result = await githubProjectsCreateWebhook(orgCtx(), CALLBACK);

			expect(mockDeleteWebhook).toHaveBeenCalledWith({ org: 'acme-org', hook_id: 42 });
			expect(mockCreateWebhook).toHaveBeenCalledWith(
				expect.objectContaining({
					org: 'acme-org',
					events: GITHUB_PROJECTS_WEBHOOK_EVENTS,
				}),
			);
			expect(result).toMatchObject({ id: 99 });
		});

		it('still creates the webhook when the dedup delete fails (error swallowed + warned)', async () => {
			mockListWebhooks.mockResolvedValue({
				data: [{ id: 42, name: 'web', active: true, events: [], config: { url: CALLBACK } }],
			});
			mockDeleteWebhook.mockRejectedValue(new Error('delete failed'));
			mockCreateWebhook.mockResolvedValue({
				data: { id: 100, name: 'web', active: true, events: [], config: { url: CALLBACK } },
			});

			const result = await githubProjectsCreateWebhook(orgCtx(), CALLBACK);

			expect(mockLoggerWarn).toHaveBeenCalledWith(
				'[GitHubProjectsWebhook] Failed to delete existing webhook (continuing)',
				expect.objectContaining({ webhookId: 42, projectId: 'proj-1' }),
			);
			expect(mockCreateWebhook).toHaveBeenCalled();
			expect(result).toMatchObject({ id: 100 });
		});

		it('includes the secret in the webhook config when ctx.webhookSecret is set', async () => {
			mockListWebhooks.mockResolvedValue({ data: [] });
			mockCreateWebhook.mockResolvedValue({
				data: { id: 1, name: 'web', active: true, events: [], config: { url: CALLBACK } },
			});

			await githubProjectsCreateWebhook(orgCtx({ webhookSecret: 'shh-secret' }), CALLBACK);

			expect(mockCreateWebhook).toHaveBeenCalledWith(
				expect.objectContaining({
					config: expect.objectContaining({
						url: CALLBACK,
						content_type: 'json',
						secret: 'shh-secret',
					}),
				}),
			);
		});

		it('omits the secret from the webhook config when ctx.webhookSecret is not set', async () => {
			mockListWebhooks.mockResolvedValue({ data: [] });
			mockCreateWebhook.mockResolvedValue({
				data: { id: 1, name: 'web', active: true, events: [], config: { url: CALLBACK } },
			});

			await githubProjectsCreateWebhook(orgCtx(), CALLBACK);

			expect(mockCreateWebhook).toHaveBeenCalledWith(
				expect.objectContaining({
					config: expect.not.objectContaining({ secret: expect.anything() }),
				}),
			);
		});

		it('returns the created webhook data on success', async () => {
			mockListWebhooks.mockResolvedValue({ data: [] });
			const created = {
				id: 55,
				name: 'web',
				active: true,
				events: GITHUB_PROJECTS_WEBHOOK_EVENTS,
				config: { url: CALLBACK },
			};
			mockCreateWebhook.mockResolvedValue({ data: created });

			const result = await githubProjectsCreateWebhook(orgCtx(), CALLBACK);

			expect(result).toEqual(created);
		});

		it('throws FORBIDDEN with the admin:org_hook scope message on a 403', async () => {
			mockListWebhooks.mockResolvedValue({ data: [] });
			mockCreateWebhook.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));

			const err = await githubProjectsCreateWebhook(orgCtx(), CALLBACK).catch((e) => e);

			expect(err).toBeInstanceOf(TRPCError);
			expect(err.code).toBe('FORBIDDEN');
			expect(err.message).toContain('HTTP 403');
			expect(err.message).toContain('admin:org_hook');
			expect(err.message).toContain('acme-org');
		});

		it('throws FORBIDDEN with the admin:org_hook scope message on a 404', async () => {
			mockListWebhooks.mockResolvedValue({ data: [] });
			mockCreateWebhook.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));

			const err = await githubProjectsCreateWebhook(orgCtx(), CALLBACK).catch((e) => e);

			expect(err).toBeInstanceOf(TRPCError);
			expect(err.code).toBe('FORBIDDEN');
			expect(err.message).toContain('HTTP 404');
			expect(err.message).toContain('admin:org_hook');
		});

		it('throws FORBIDDEN with the generic message for a non-403/404 error', async () => {
			mockListWebhooks.mockResolvedValue({ data: [] });
			mockCreateWebhook.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));

			const err = await githubProjectsCreateWebhook(orgCtx(), CALLBACK).catch((e) => e);

			expect(err).toBeInstanceOf(TRPCError);
			expect(err.code).toBe('FORBIDDEN');
			expect(err.message).toContain('GitHub webhook operation failed for organization "acme-org"');
			expect(err.message).not.toContain('admin:org_hook');
			expect(err.message).toContain('boom');
		});
	});

	describe('githubProjectsDeleteWebhook', () => {
		it('no-ops without instantiating Octokit when ownerType is not organization', async () => {
			await githubProjectsDeleteWebhook(orgCtx({ githubProjectsOwnerType: 'user' }), 7);

			expect(mockOctokitCtor).not.toHaveBeenCalled();
			expect(mockDeleteWebhook).not.toHaveBeenCalled();
		});

		it('no-ops without instantiating Octokit when owner is missing', async () => {
			await githubProjectsDeleteWebhook(orgCtx({ githubProjectsOwner: undefined }), 7);

			expect(mockOctokitCtor).not.toHaveBeenCalled();
			expect(mockDeleteWebhook).not.toHaveBeenCalled();
		});

		it('no-ops without instantiating Octokit when token is missing', async () => {
			await githubProjectsDeleteWebhook(orgCtx({ githubProjectsToken: undefined }), 7);

			expect(mockOctokitCtor).not.toHaveBeenCalled();
			expect(mockDeleteWebhook).not.toHaveBeenCalled();
		});

		it('calls orgs.deleteWebhook with the org and hook id on the happy path', async () => {
			mockDeleteWebhook.mockResolvedValue({});

			await githubProjectsDeleteWebhook(orgCtx(), 42);

			expect(mockDeleteWebhook).toHaveBeenCalledWith({ org: 'acme-org', hook_id: 42 });
		});
	});
});
