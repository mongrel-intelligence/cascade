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
		it('extracts an issue number from a GitHub issue URL', () => {
			expect(integration.extractWorkItemId('see https://github.com/octocat/repo/issues/123')).toBe(
				'123',
			);
		});

		it('extracts a PR number from a GitHub pull URL', () => {
			expect(integration.extractWorkItemId('https://github.com/octocat/repo/pull/456')).toBe('456');
		});

		it('returns null when no GitHub URL is present', () => {
			expect(integration.extractWorkItemId('no url here')).toBeNull();
		});
	});
});
