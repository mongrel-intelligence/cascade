import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config/provider.js', () => ({
	loadProjectConfigByRepo: vi.fn(),
}));

vi.mock('../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn().mockImplementation((_token, fn) => fn()),
}));

vi.mock('../../../src/github/personas.js', () => ({
	getPersonaToken: vi.fn().mockResolvedValue('gh-token-xxx'),
}));

vi.mock('../../../src/triggers/github/ack-comments.js', () => ({
	deleteProgressCommentOnSuccess: vi.fn().mockResolvedValue(undefined),
	updateInitialCommentWithError: vi.fn().mockResolvedValue(undefined),
}));

import { loadProjectConfigByRepo } from '../../../src/config/provider.js';
import { GitHubWebhookIntegration } from '../../../src/triggers/github/integration.js';

const mockLoadProjectConfigByRepo = vi.mocked(loadProjectConfigByRepo);

function makePayload(repoFullName?: string): unknown {
	if (!repoFullName) return {};
	return {
		repository: { full_name: repoFullName },
		pull_request: { number: 42 },
		action: 'opened',
	};
}

describe('GitHubWebhookIntegration', () => {
	const integration = new GitHubWebhookIntegration();

	describe('parseWebhookPayload', () => {
		it('returns null when payload has no repository', () => {
			expect(integration.parseWebhookPayload({})).toBeNull();
		});

		it('returns null for non-object payloads', () => {
			expect(integration.parseWebhookPayload(null)).toBeNull();
			expect(integration.parseWebhookPayload('string')).toBeNull();
		});

		it('returns PMWebhookEvent with repoFullName as projectIdentifier', () => {
			const payload = makePayload('owner/repo');
			const event = integration.parseWebhookPayload(payload);
			expect(event).not.toBeNull();
			expect(event?.projectIdentifier).toBe('owner/repo');
		});

		it('detects pull_request event type', () => {
			const payload = makePayload('owner/repo');
			const event = integration.parseWebhookPayload(payload);
			expect(event?.eventType).toBe('pull_request.opened');
		});

		it('detects check_suite event type', () => {
			const payload = { repository: { full_name: 'owner/repo' }, check_suite: {} };
			const event = integration.parseWebhookPayload(payload);
			expect(event?.eventType).toBe('check_suite');
		});

		it('returns unknown event type for unrecognized payloads', () => {
			const payload = { repository: { full_name: 'owner/repo' } };
			const event = integration.parseWebhookPayload(payload);
			expect(event?.eventType).toBe('unknown');
		});

		it('sets workItemId to undefined (GitHub does not embed PM IDs)', () => {
			const payload = makePayload('owner/repo');
			const event = integration.parseWebhookPayload(payload);
			expect(event?.workItemId).toBeUndefined();
		});
	});

	describe('lookupProject', () => {
		it('returns null when no project is configured for the repository', async () => {
			mockLoadProjectConfigByRepo.mockResolvedValue(undefined);
			const result = await integration.lookupProject('owner/unknown-repo');
			expect(result).toBeNull();
		});

		it('returns project config when found', async () => {
			const mockConfig = { project: { id: 'p1', name: 'Test' }, config: {} };
			mockLoadProjectConfigByRepo.mockResolvedValue(mockConfig as never);
			const result = await integration.lookupProject('owner/repo');
			expect(result).toBe(mockConfig);
		});
	});

	describe('withCredentials', () => {
		it('calls fn within GitHub token scope', async () => {
			const fn = vi.fn().mockResolvedValue('result');
			const result = await integration.withCredentials('project-1', fn);
			expect(fn).toHaveBeenCalled();
			expect(result).toBe('result');
		});
	});

	describe('resolveExecutionConfig', () => {
		it('returns config with skipPrepareForAgent=true', () => {
			const config = integration.resolveExecutionConfig();
			expect(config.skipPrepareForAgent).toBe(true);
		});

		it('returns config with skipHandleFailure=true', () => {
			const config = integration.resolveExecutionConfig();
			expect(config.skipHandleFailure).toBe(true);
		});

		it('returns config with handleSuccessOnlyForAgentType=implementation', () => {
			const config = integration.resolveExecutionConfig();
			expect(config.handleSuccessOnlyForAgentType).toBe('implementation');
		});

		it('provides onSuccess and onFailure callbacks', () => {
			const config = integration.resolveExecutionConfig();
			expect(config.onSuccess).toBeTypeOf('function');
			expect(config.onFailure).toBeTypeOf('function');
		});

		it('returns logLabel="GitHub agent"', () => {
			const config = integration.resolveExecutionConfig();
			expect(config.logLabel).toBe('GitHub agent');
		});
	});

	describe('extractWorkItemId', () => {
		it('returns null (GitHub does not extract PM work item IDs)', () => {
			expect(integration.extractWorkItemId('Closes card-123')).toBeNull();
		});
	});

	describe('type', () => {
		it('is "github"', () => {
			expect(integration.type).toBe('github');
		});
	});
});
