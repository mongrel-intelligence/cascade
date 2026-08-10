import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — keep the integration module's DB/provider deps inert so we can test
// the pure methods (parse / lifecycle / createProvider / extractWorkItemId).
// ---------------------------------------------------------------------------

const mockGetIntegrationCredential = vi.fn();
const mockGetIntegrationCredentialOrNull = vi.fn();
const mockLoadProjectConfigByGitHubProjectsProjectId = vi.fn();
vi.mock('../../../../src/config/provider.js', () => ({
	getIntegrationCredential: (...args: unknown[]) => mockGetIntegrationCredential(...args),
	getIntegrationCredentialOrNull: (...args: unknown[]) =>
		mockGetIntegrationCredentialOrNull(...args),
	loadProjectConfigByGitHubProjectsProjectId: (...args: unknown[]) =>
		mockLoadProjectConfigByGitHubProjectsProjectId(...args),
}));

const mockGetIntegrationProvider = vi.fn();
vi.mock('../../../../src/db/repositories/credentialsRepository.js', () => ({
	getIntegrationProvider: (...args: unknown[]) => mockGetIntegrationProvider(...args),
}));

vi.mock('../../../../src/github-projects/client.js', () => ({
	addCommentToIssue: vi.fn(),
	withGitHubProjectsCredentials: vi.fn((_creds, fn) => fn()),
	getViewer: vi.fn(),
	deleteComment: vi.fn(),
}));

const { mockLoggerWarn } = vi.hoisted(() => ({ mockLoggerWarn: vi.fn() }));
vi.mock('../../../../src/utils/logging.js', () => ({
	logger: { warn: mockLoggerWarn, debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
	addCommentToIssue,
	deleteComment,
	getViewer,
	withGitHubProjectsCredentials,
} from '../../../../src/github-projects/client.js';
import { GitHubProjectsIntegration } from '../../../../src/pm/github-projects/integration.js';
import type { ProjectConfig } from '../../../../src/types/index.js';

const projectWithConfig = {
	id: 'proj-ghp',
	pm: { type: 'github-projects' },
	githubProjects: {
		projectId: 'PVT_project',
		owner: 'octocat',
		ownerType: 'user',
		statuses: { todo: 'opt-todo', done: 'opt-done', friction: 'opt-friction' },
		labels: { processing: 'label-processing', readyToProcess: 'label-ready' },
	},
} as unknown as ProjectConfig;

describe('GitHubProjectsIntegration', () => {
	let integration: GitHubProjectsIntegration;

	beforeEach(() => {
		vi.clearAllMocks();
		integration = new GitHubProjectsIntegration();
	});

	it('has type "github-projects" and category "pm"', () => {
		expect(integration.type).toBe('github-projects');
		expect(integration.category).toBe('pm');
	});

	describe('parseWebhookPayload', () => {
		it('parses a projects_v2_item webhook into a PMWebhookEvent', () => {
			const event = integration.parseWebhookPayload({
				action: 'edited',
				projects_v2_item: {
					project_node_id: 'PVT_project',
					content_node_id: 'I_content',
				},
			});

			expect(event).not.toBeNull();
			expect(event?.eventType).toBe('projects_v2_item.edited');
			expect(event?.projectIdentifier).toBe('PVT_project');
			expect(event?.workItemId).toBe('I_content');
		});

		it('returns null for non-object payloads', () => {
			expect(integration.parseWebhookPayload(null)).toBeNull();
			expect(integration.parseWebhookPayload('nope')).toBeNull();
		});

		it('returns null when projects_v2_item is missing', () => {
			expect(integration.parseWebhookPayload({ action: 'edited' })).toBeNull();
		});

		it('returns null when project_node_id is missing', () => {
			expect(
				integration.parseWebhookPayload({
					action: 'edited',
					projects_v2_item: { content_node_id: 'I_content' },
				}),
			).toBeNull();
		});
	});

	describe('resolveLifecycleConfig', () => {
		it('maps labels and spreads the full statuses record (custom keys survive)', () => {
			const config = integration.resolveLifecycleConfig(projectWithConfig);

			expect(config.labels.processing).toBe('label-processing');
			expect(config.labels.readyToProcess).toBe('label-ready');
			// Full statuses record must be spread so custom/friction keys survive.
			expect(config.statuses).toEqual({
				todo: 'opt-todo',
				done: 'opt-done',
				friction: 'opt-friction',
			});
		});

		it('tolerates a project with no GitHub Projects config', () => {
			const config = integration.resolveLifecycleConfig({
				id: 'x',
				pm: { type: 'github-projects' },
			} as unknown as ProjectConfig);
			expect(config.statuses).toEqual({});
		});
	});

	describe('createProvider', () => {
		it('constructs a provider when projectId is present', () => {
			const provider = integration.createProvider(projectWithConfig);
			expect(provider.type).toBe('github-projects');
		});

		it('throws when projectId is missing from config', () => {
			expect(() =>
				integration.createProvider({
					id: 'x',
					pm: { type: 'github-projects' },
				} as unknown as ProjectConfig),
			).toThrow(/requires projectId/);
		});
	});

	describe('extractWorkItemId', () => {
		// The github-projects path keys work items by their content node ID
		// (`I_…` / `PR_…`), which can't be derived synchronously from a URL's issue
		// number. Text-based linking is therefore unsupported and always returns
		// null (mirrors the GitHub SCM integration), avoiding a misleading number.
		it('returns null for a GitHub issue URL (number is not a content node ID)', () => {
			expect(
				integration.extractWorkItemId('see https://github.com/octocat/repo/issues/123'),
			).toBeNull();
		});

		it('returns null for a GitHub pull URL', () => {
			expect(integration.extractWorkItemId('https://github.com/octocat/repo/pull/456')).toBeNull();
		});

		it('returns null when no GitHub URL is present', () => {
			expect(integration.extractWorkItemId('no url here')).toBeNull();
		});
	});

	describe('hasIntegration', () => {
		it('returns false when the PM provider is not github-projects', async () => {
			mockGetIntegrationProvider.mockResolvedValue('trello');

			const result = await integration.hasIntegration('proj-1');

			expect(result).toBe(false);
			expect(mockGetIntegrationCredentialOrNull).not.toHaveBeenCalled();
		});

		it('returns true when the provider is github-projects and the required token is present', async () => {
			mockGetIntegrationProvider.mockResolvedValue('github-projects');
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce('ghp_token');

			const result = await integration.hasIntegration('proj-1');

			// Only 'token' is required; 'webhook_secret' is optional and must not gate readiness.
			expect(mockGetIntegrationCredentialOrNull).toHaveBeenCalledTimes(1);
			expect(mockGetIntegrationCredentialOrNull).toHaveBeenCalledWith(
				'proj-1',
				'pm',
				'github-projects',
				'token',
			);
			expect(result).toBe(true);
		});

		it('returns false when the required token credential is missing', async () => {
			mockGetIntegrationProvider.mockResolvedValue('github-projects');
			mockGetIntegrationCredentialOrNull.mockResolvedValueOnce(null);

			const result = await integration.hasIntegration('proj-1');

			expect(result).toBe(false);
		});
	});

	describe('withCredentials', () => {
		it('fetches the token credential and scopes the callback via withGitHubProjectsCredentials', async () => {
			mockGetIntegrationCredential.mockResolvedValueOnce('ghp_token');
			const fn = vi.fn().mockResolvedValue('done');

			const result = await integration.withCredentials('proj-1', fn);

			expect(mockGetIntegrationCredential).toHaveBeenCalledWith(
				'proj-1',
				'pm',
				'github-projects',
				'token',
			);
			expect(withGitHubProjectsCredentials).toHaveBeenCalledWith({ token: 'ghp_token' }, fn);
			expect(result).toBe('done');
		});
	});

	describe('isSelfAuthored', () => {
		it('returns false for non-projects_v2_item event types', async () => {
			const result = await integration.isSelfAuthored(
				{ eventType: 'issue_comment.created', projectIdentifier: 'PVT_project', raw: {} },
				'proj-1',
			);
			expect(result).toBe(false);
			expect(mockGetIntegrationCredential).not.toHaveBeenCalled();
		});

		it('returns false when the webhook payload has no sender', async () => {
			const result = await integration.isSelfAuthored(
				{
					eventType: 'projects_v2_item.edited',
					projectIdentifier: 'PVT_project',
					raw: {},
				},
				'proj-1',
			);
			expect(result).toBe(false);
		});

		it('returns false when the sender has no login', async () => {
			const result = await integration.isSelfAuthored(
				{
					eventType: 'projects_v2_item.edited',
					projectIdentifier: 'PVT_project',
					raw: { sender: {} },
				},
				'proj-1',
			);
			expect(result).toBe(false);
		});

		it('returns true when the webhook sender matches the authenticated viewer', async () => {
			mockGetIntegrationCredential.mockResolvedValueOnce('ghp_token');
			vi.mocked(getViewer).mockResolvedValueOnce({
				id: 'U_bot',
				login: 'cascade-bot',
				name: 'Cascade Bot',
			});

			const result = await integration.isSelfAuthored(
				{
					eventType: 'projects_v2_item.edited',
					projectIdentifier: 'PVT_project',
					raw: { sender: { login: 'cascade-bot' } },
				},
				'proj-1',
			);

			expect(result).toBe(true);
		});

		it('returns false when the webhook sender does not match the authenticated viewer', async () => {
			mockGetIntegrationCredential.mockResolvedValueOnce('ghp_token');
			vi.mocked(getViewer).mockResolvedValueOnce({
				id: 'U_bot',
				login: 'cascade-bot',
				name: 'Cascade Bot',
			});

			const result = await integration.isSelfAuthored(
				{
					eventType: 'projects_v2_item.edited',
					projectIdentifier: 'PVT_project',
					raw: { sender: { login: 'a-human' } },
				},
				'proj-1',
			);

			expect(result).toBe(false);
		});

		it('returns false when resolving credentials or the viewer throws', async () => {
			mockGetIntegrationCredential.mockRejectedValueOnce(new Error('no credential'));

			const result = await integration.isSelfAuthored(
				{
					eventType: 'projects_v2_item.edited',
					projectIdentifier: 'PVT_project',
					raw: { sender: { login: 'cascade-bot' } },
				},
				'proj-1',
			);

			expect(result).toBe(false);
		});
	});

	describe('postAckComment', () => {
		it('posts the comment and returns the comment ID', async () => {
			mockGetIntegrationCredential.mockResolvedValueOnce('ghp_token');
			vi.mocked(addCommentToIssue).mockResolvedValueOnce('comment-1');

			const result = await integration.postAckComment('proj-1', 'I_content', 'On it');

			expect(addCommentToIssue).toHaveBeenCalledWith('I_content', 'On it');
			expect(result).toBe('comment-1');
		});

		it('returns null and logs a warning when posting fails', async () => {
			mockGetIntegrationCredential.mockRejectedValueOnce(new Error('boom'));

			const result = await integration.postAckComment('proj-1', 'I_content', 'On it');

			expect(result).toBeNull();
			expect(mockLoggerWarn).toHaveBeenCalledWith(
				'[GitHubProjects] Failed to post ack comment',
				expect.objectContaining({ projectId: 'proj-1', workItemId: 'I_content' }),
			);
		});
	});

	describe('deleteAckComment', () => {
		it('deletes the comment', async () => {
			mockGetIntegrationCredential.mockResolvedValueOnce('ghp_token');
			vi.mocked(deleteComment).mockResolvedValueOnce(undefined);

			await integration.deleteAckComment('proj-1', 'I_content', 'comment-1');

			expect(deleteComment).toHaveBeenCalledWith('comment-1');
		});

		it('swallows the error and logs a warning when deletion fails', async () => {
			mockGetIntegrationCredential.mockRejectedValueOnce(new Error('boom'));

			await expect(
				integration.deleteAckComment('proj-1', 'I_content', 'comment-1'),
			).resolves.toBeUndefined();
			expect(mockLoggerWarn).toHaveBeenCalledWith(
				'[GitHubProjects] Failed to delete ack comment',
				expect.objectContaining({ projectId: 'proj-1', commentId: 'comment-1' }),
			);
		});
	});

	describe('sendReaction', () => {
		it('is a no-op', async () => {
			await expect(
				integration.sendReaction('proj-1', {
					eventType: 'projects_v2_item.edited',
					projectIdentifier: 'PVT_project',
					raw: {},
				}),
			).resolves.toBeUndefined();
		});
	});

	describe('lookupProject', () => {
		it('returns the project + config when a matching GitHub Projects project is found', async () => {
			const project = projectWithConfig;
			const config = { version: 1, agents: [] };
			mockLoadProjectConfigByGitHubProjectsProjectId.mockResolvedValueOnce({ project, config });

			const result = await integration.lookupProject('PVT_project');

			expect(mockLoadProjectConfigByGitHubProjectsProjectId).toHaveBeenCalledWith('PVT_project');
			expect(result).toEqual({ project, config });
		});

		it('returns null when no project matches the given identifier', async () => {
			mockLoadProjectConfigByGitHubProjectsProjectId.mockResolvedValueOnce(undefined);

			const result = await integration.lookupProject('unknown');

			expect(result).toBeNull();
		});
	});
});
