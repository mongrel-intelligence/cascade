import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../../src/router/config.js', () => ({
	loadProjectConfig: vi.fn(),
}));
vi.mock('../../../../src/router/queue.js', () => ({
	addJob: vi.fn(),
}));
vi.mock('../../../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../src/router/acknowledgments.js', () => ({
	postGitHubAck: vi.fn(),
	resolveGitHubTokenForAckByAgent: vi.fn(),
}));
vi.mock('../../../../src/router/notifications.js', () => ({
	extractPRNumber: vi.fn(),
}));
vi.mock('../../../../src/router/pre-actions.js', () => ({
	addEyesReactionToPR: vi.fn(),
}));
vi.mock('../../../../src/router/ackMessageGenerator.js', () => ({
	extractGitHubContext: vi.fn().mockReturnValue('PR: Test PR'),
	generateAckMessage: vi.fn().mockResolvedValue('Starting implementation...'),
}));
vi.mock('../../../../src/config/projects.js', () => ({
	getProjectGitHubToken: vi.fn().mockResolvedValue('ghp_mock'),
}));
vi.mock('../../../../src/config/provider.js', () => ({
	findProjectByRepo: vi.fn(),
}));
vi.mock('../../../../src/github/personas.js', () => ({
	resolvePersonaIdentities: vi.fn().mockResolvedValue({}),
	isCascadeBot: vi.fn().mockReturnValue(false),
}));
vi.mock('../../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn().mockImplementation((_t: unknown, fn: () => unknown) => fn()),
}));
vi.mock('../../../../src/pm/context.js', () => ({
	withPMProvider: vi.fn().mockImplementation((_p: unknown, fn: () => unknown) => fn()),
	withPMCredentials: vi
		.fn()
		.mockImplementation((_id: unknown, _type: unknown, _get: unknown, fn: () => unknown) => fn()),
}));
vi.mock('../../../../src/pm/registry.js', () => ({
	pmRegistry: {
		getOrNull: vi.fn().mockReturnValue(null),
		createProvider: vi.fn().mockReturnValue({}),
		register: vi.fn(),
	},
}));
vi.mock('../../../../src/pm/jira/integration.js', () => ({
	JiraIntegration: vi.fn(),
}));
vi.mock('../../../../src/pm/trello/integration.js', () => ({
	TrelloIntegration: vi.fn(),
}));
vi.mock('../../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

import { findProjectByRepo } from '../../../../src/config/provider.js';
import { isCascadeBot, resolvePersonaIdentities } from '../../../../src/github/personas.js';
import {
	postGitHubAck,
	resolveGitHubTokenForAckByAgent,
} from '../../../../src/router/acknowledgments.js';
import { GitHubRouterAdapter, injectEventType } from '../../../../src/router/adapters/github.js';
import { loadProjectConfig } from '../../../../src/router/config.js';
import type { RouterProjectConfig } from '../../../../src/router/config.js';
import { extractPRNumber } from '../../../../src/router/notifications.js';
import { addEyesReactionToPR } from '../../../../src/router/pre-actions.js';
import type { GitHubJob } from '../../../../src/router/queue.js';
import { sendAcknowledgeReaction } from '../../../../src/router/reactions.js';
import type { TriggerRegistry } from '../../../../src/triggers/registry.js';

const mockProject: RouterProjectConfig = {
	id: 'p1',
	repo: 'owner/repo',
	pmType: 'trello',
};

const mockTriggerRegistry = {
	dispatch: vi.fn().mockResolvedValue(null),
} as unknown as TriggerRegistry;

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(loadProjectConfig).mockResolvedValue({
		projects: [mockProject],
		fullProjects: [{ id: 'p1', repo: 'owner/repo' } as never],
	});
});

describe('injectEventType', () => {
	it('injects _eventType into payload', () => {
		const result = injectEventType({ action: 'opened' }, 'pull_request');
		expect(result._eventType).toBe('pull_request');
		expect(result.action).toBe('opened');
	});
});

describe('GitHubRouterAdapter', () => {
	let adapter: GitHubRouterAdapter;

	beforeEach(() => {
		adapter = new GitHubRouterAdapter();
	});

	describe('parseWebhook', () => {
		it('returns null for non-processable events', async () => {
			const payload = injectEventType({ repository: { full_name: 'owner/repo' } }, 'push');
			const result = await adapter.parseWebhook(payload);
			expect(result).toBeNull();
		});

		it('returns parsed event for pull_request', async () => {
			const payload = injectEventType(
				{
					repository: { full_name: 'owner/repo' },
					pull_request: { number: 42 },
					action: 'opened',
				},
				'pull_request',
			);
			const result = await adapter.parseWebhook(payload);
			expect(result).not.toBeNull();
			expect(result?.eventType).toBe('pull_request');
			expect(result?.isCommentEvent).toBe(false);
			expect(result?.workItemId).toBe('42');
		});

		it('marks issue_comment as isCommentEvent=true', async () => {
			const payload = injectEventType(
				{
					repository: { full_name: 'owner/repo' },
					issue: { number: 5 },
					comment: { body: 'hello' },
				},
				'issue_comment',
			);
			const result = await adapter.parseWebhook(payload);
			expect(result?.isCommentEvent).toBe(true);
		});
	});

	describe('isProcessableEvent', () => {
		it('returns true for pull_request', () => {
			expect(
				adapter.isProcessableEvent({
					projectIdentifier: 'owner/repo',
					eventType: 'pull_request',
					isCommentEvent: false,
				}),
			).toBe(true);
		});

		it('returns false for push', () => {
			expect(
				adapter.isProcessableEvent({
					projectIdentifier: 'owner/repo',
					eventType: 'push',
					isCommentEvent: false,
				}),
			).toBe(false);
		});
	});

	describe('isSelfAuthored', () => {
		it('returns false for non-comment events', async () => {
			const result = await adapter.isSelfAuthored(
				{ projectIdentifier: 'owner/repo', eventType: 'pull_request', isCommentEvent: false },
				{},
			);
			expect(result).toBe(false);
		});

		it('returns true when comment author is a cascade bot', async () => {
			vi.mocked(findProjectByRepo).mockResolvedValue({ id: 'p1' } as never);
			vi.mocked(resolvePersonaIdentities).mockResolvedValue({} as never);
			vi.mocked(isCascadeBot).mockReturnValue(true);

			const result = await adapter.isSelfAuthored(
				{
					projectIdentifier: 'owner/repo',
					eventType: 'issue_comment',
					isCommentEvent: true,
					// @ts-expect-error extended field
					repoFullName: 'owner/repo',
				},
				{ comment: { user: { login: 'cascade-bot' } } },
			);
			expect(result).toBe(true);
		});
	});

	describe('sendReaction', () => {
		it('does nothing for non-comment events', () => {
			adapter.sendReaction(
				{
					projectIdentifier: 'owner/repo',
					eventType: 'pull_request',
					isCommentEvent: false,
					// @ts-expect-error extended field
					repoFullName: 'owner/repo',
				},
				{},
			);
			// Reaction should not be fired
		});

		it('fires reaction for comment events', async () => {
			vi.mocked(findProjectByRepo).mockResolvedValue({ id: 'p1' } as never);
			vi.mocked(resolvePersonaIdentities).mockResolvedValue({} as never);
			vi.mocked(sendAcknowledgeReaction).mockResolvedValue(undefined);

			adapter.sendReaction(
				{
					projectIdentifier: 'owner/repo',
					eventType: 'issue_comment',
					isCommentEvent: true,
					// @ts-expect-error extended field
					repoFullName: 'owner/repo',
				},
				{ comment: { body: '@bot hello' } },
			);
			await vi.waitFor(() => {
				expect(sendAcknowledgeReaction).toHaveBeenCalledWith(
					'github',
					'owner/repo',
					expect.any(Object),
					expect.anything(),
					expect.anything(),
				);
			});
		});
	});

	describe('resolveProject', () => {
		it('returns project matching repoFullName', async () => {
			const project = await adapter.resolveProject({
				projectIdentifier: 'owner/repo',
				eventType: 'pull_request',
				isCommentEvent: false,
				// @ts-expect-error extended field
				repoFullName: 'owner/repo',
			});
			expect(project?.id).toBe('p1');
		});

		it('returns null for unknown repo', async () => {
			const project = await adapter.resolveProject({
				projectIdentifier: 'other/repo',
				eventType: 'pull_request',
				isCommentEvent: false,
				// @ts-expect-error extended field
				repoFullName: 'other/repo',
			});
			expect(project).toBeNull();
		});
	});

	describe('dispatchWithCredentials', () => {
		it('dispatches to trigger registry', async () => {
			vi.mocked(mockTriggerRegistry.dispatch).mockResolvedValue({
				agentType: 'review',
				agentInput: { prNumber: 1 },
				prNumber: 1,
			} as never);

			const result = await adapter.dispatchWithCredentials(
				{
					projectIdentifier: 'owner/repo',
					eventType: 'pull_request',
					isCommentEvent: false,
					// @ts-expect-error extended field
					repoFullName: 'owner/repo',
				},
				{},
				mockProject,
				mockTriggerRegistry,
			);
			expect(result?.agentType).toBe('review');
		});

		it('returns null when no full project found', async () => {
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [mockProject],
				fullProjects: [],
			});

			const result = await adapter.dispatchWithCredentials(
				{
					projectIdentifier: 'owner/repo',
					eventType: 'pull_request',
					isCommentEvent: false,
					// @ts-expect-error extended field
					repoFullName: 'owner/repo',
				},
				{},
				mockProject,
				mockTriggerRegistry,
			);
			expect(result).toBeNull();
		});
	});

	describe('postAck', () => {
		it('posts ack and returns AckResult with commentId and message', async () => {
			vi.mocked(resolveGitHubTokenForAckByAgent).mockResolvedValue({
				token: 'ghp_test',
				project: { id: 'p1' },
			} as never);
			vi.mocked(extractPRNumber).mockReturnValue(42);
			vi.mocked(postGitHubAck).mockResolvedValue(999);

			const ackResult = await adapter.postAck(
				{
					projectIdentifier: 'owner/repo',
					eventType: 'pull_request',
					workItemId: '42',
					isCommentEvent: false,
					// @ts-expect-error extended field
					repoFullName: 'owner/repo',
				},
				{},
				mockProject,
				'review',
			);
			expect(ackResult?.commentId).toBe(999);
			expect(ackResult?.message).toBe('Starting implementation...');
		});
	});

	describe('buildJob', () => {
		it('builds a github job with correct fields', () => {
			const result = { agentType: 'review', agentInput: { prNumber: 1 }, prNumber: 1 };
			const job = adapter.buildJob(
				{
					projectIdentifier: 'owner/repo',
					eventType: 'pull_request',
					isCommentEvent: false,
					// @ts-expect-error extended field
					repoFullName: 'owner/repo',
				},
				{},
				mockProject,
				result as never,
				42,
			);
			expect(job.type).toBe('github');
			expect((job as GitHubJob).repoFullName).toBe('owner/repo');
			expect((job as GitHubJob).ackCommentId).toBe(42);
		});
	});

	describe('firePreActions', () => {
		it('calls addEyesReactionToPR for successful check_suite with PRs', () => {
			vi.mocked(addEyesReactionToPR).mockResolvedValue(undefined);
			const job = { type: 'github', eventType: 'check_suite' } as GitHubJob;
			adapter.firePreActions(job, {
				action: 'completed',
				check_suite: { conclusion: 'success', pull_requests: [{}] },
			});
			expect(addEyesReactionToPR).toHaveBeenCalledWith(job);
		});

		it('does nothing for non-check_suite events', () => {
			const job = { type: 'github', eventType: 'pull_request' } as GitHubJob;
			adapter.firePreActions(job, {});
			expect(addEyesReactionToPR).not.toHaveBeenCalled();
		});

		it('does nothing when conclusion is not success', () => {
			const job = { type: 'github', eventType: 'check_suite' } as GitHubJob;
			adapter.firePreActions(job, {
				action: 'completed',
				check_suite: { conclusion: 'failure', pull_requests: [{}] },
			});
			expect(addEyesReactionToPR).not.toHaveBeenCalled();
		});
	});
});
