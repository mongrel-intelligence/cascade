import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

// Mock heavy imports
vi.mock('../../../src/router/queue.js', () => ({
	addJob: vi.fn(),
}));
vi.mock('../../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/router/config.js', () => ({
	loadProjectConfig: vi.fn().mockResolvedValue({ projects: [], fullProjects: [] }),
}));
vi.mock('../../../src/router/acknowledgments.js', () => ({
	postGitHubAck: vi.fn(),
	resolveGitHubTokenForAck: vi.fn(),
}));
vi.mock('../../../src/router/notifications.js', () => ({
	extractPRNumber: vi.fn(),
}));
vi.mock('../../../src/router/pre-actions.js', () => ({
	addEyesReactionToPR: vi.fn(),
}));
vi.mock('../../../src/router/ackMessageGenerator.js', () => ({
	extractGitHubContext: vi.fn().mockReturnValue('PR: Test PR'),
	generateAckMessage: vi.fn().mockResolvedValue('Starting implementation...'),
}));
vi.mock('../../../src/config/projects.js', () => ({
	getProjectGitHubToken: vi.fn().mockResolvedValue('ghp_mock'),
}));
vi.mock('../../../src/config/provider.js', () => ({
	findProjectByRepo: vi.fn(),
}));
vi.mock('../../../src/github/personas.js', () => ({
	resolvePersonaIdentities: vi.fn(),
	isCascadeBot: vi.fn(),
}));
vi.mock('../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn().mockImplementation((_t: unknown, fn: () => unknown) => fn()),
}));
vi.mock('../../../src/pm/context.js', () => ({
	withPMProvider: vi.fn().mockImplementation((_p: unknown, fn: () => unknown) => fn()),
	withPMCredentials: vi
		.fn()
		.mockImplementation((_id: unknown, _type: unknown, _get: unknown, fn: () => unknown) => fn()),
}));
vi.mock('../../../src/pm/registry.js', () => ({
	pmRegistry: {
		getOrNull: vi.fn().mockReturnValue(null),
		createProvider: vi.fn().mockReturnValue({}),
		register: vi.fn(),
	},
}));
vi.mock('../../../src/pm/jira/integration.js', () => ({
	JiraIntegration: vi.fn(),
}));
vi.mock('../../../src/pm/trello/integration.js', () => ({
	TrelloIntegration: vi.fn(),
}));
vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

import { findProjectByRepo } from '../../../src/config/provider.js';
import { isCascadeBot, resolvePersonaIdentities } from '../../../src/github/personas.js';
import { generateAckMessage } from '../../../src/router/ackMessageGenerator.js';
import { postGitHubAck, resolveGitHubTokenForAck } from '../../../src/router/acknowledgments.js';
import { loadProjectConfig } from '../../../src/router/config.js';
import {
	firePreActions,
	handleGitHubWebhook,
	isSelfAuthoredGitHubComment,
	processGitHubWebhookEvent,
} from '../../../src/router/github.js';
import { extractPRNumber } from '../../../src/router/notifications.js';
import { addEyesReactionToPR } from '../../../src/router/pre-actions.js';
import { addJob } from '../../../src/router/queue.js';
import type { GitHubJob } from '../../../src/router/queue.js';
import { sendAcknowledgeReaction } from '../../../src/router/reactions.js';
import type { TriggerRegistry } from '../../../src/triggers/registry.js';

const mockTriggerRegistry = {
	dispatch: vi.fn().mockResolvedValue(null),
} as unknown as TriggerRegistry;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('isSelfAuthoredGitHubComment', () => {
	it('returns true when comment author is a cascade bot', async () => {
		vi.mocked(findProjectByRepo).mockResolvedValue({ id: 'p1' } as never);
		vi.mocked(resolvePersonaIdentities).mockResolvedValue({
			implementer: { login: 'cascade-bot', id: 1 },
			reviewer: { login: 'cascade-reviewer', id: 2 },
		} as never);
		vi.mocked(isCascadeBot).mockReturnValue(true);

		const result = await isSelfAuthoredGitHubComment(
			{ comment: { user: { login: 'cascade-bot' } } },
			'owner/repo',
		);
		expect(result).toBe(true);
	});

	it('returns false when comment author is not a bot', async () => {
		vi.mocked(findProjectByRepo).mockResolvedValue({ id: 'p1' } as never);
		vi.mocked(resolvePersonaIdentities).mockResolvedValue({} as never);
		vi.mocked(isCascadeBot).mockReturnValue(false);

		const result = await isSelfAuthoredGitHubComment(
			{ comment: { user: { login: 'regular-user' } } },
			'owner/repo',
		);
		expect(result).toBe(false);
	});

	it('returns false when no login present', async () => {
		const result = await isSelfAuthoredGitHubComment({ comment: {} }, 'owner/repo');
		expect(result).toBe(false);
	});

	it('returns false when persona resolution fails', async () => {
		vi.mocked(findProjectByRepo).mockRejectedValue(new Error('DB error'));
		const result = await isSelfAuthoredGitHubComment(
			{ comment: { user: { login: 'cascade-bot' } } },
			'owner/repo',
		);
		expect(result).toBe(false);
	});
});

describe('firePreActions', () => {
	it('calls addEyesReactionToPR for successful check_suite', () => {
		vi.mocked(addEyesReactionToPR).mockResolvedValue(undefined);
		const job = { eventType: 'check_suite' } as GitHubJob;
		const payload = {
			action: 'completed',
			check_suite: { conclusion: 'success', pull_requests: [{}] },
		};
		firePreActions(job, payload);
		expect(addEyesReactionToPR).toHaveBeenCalledWith(job);
	});

	it('does nothing for non-check_suite events', () => {
		const job = { eventType: 'push' } as GitHubJob;
		firePreActions(job, {});
		expect(addEyesReactionToPR).not.toHaveBeenCalled();
	});

	it('does nothing when check_suite has no PRs', () => {
		const job = { eventType: 'check_suite' } as GitHubJob;
		const payload = {
			action: 'completed',
			check_suite: { conclusion: 'success', pull_requests: [] },
		};
		firePreActions(job, payload);
		expect(addEyesReactionToPR).not.toHaveBeenCalled();
	});

	it('does nothing when conclusion is not success', () => {
		const job = { eventType: 'check_suite' } as GitHubJob;
		const payload = {
			action: 'completed',
			check_suite: { conclusion: 'failure', pull_requests: [{}] },
		};
		firePreActions(job, payload);
		expect(addEyesReactionToPR).not.toHaveBeenCalled();
	});
});

describe('handleGitHubWebhook', () => {
	it('ignores non-processable events', async () => {
		const result = await handleGitHubWebhook('push', {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(false);
		expect(addJob).not.toHaveBeenCalled();
	});

	it('does not queue job when no project found', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [],
			fullProjects: [],
		} as never);

		const result = await handleGitHubWebhook(
			'pull_request',
			{ repository: { full_name: 'owner/repo' }, action: 'opened' },
			mockTriggerRegistry,
		);

		expect(result.shouldProcess).toBe(true);
		expect(addJob).not.toHaveBeenCalled();
	});

	it('queues job when dispatch returns a trigger result', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-1', repo: 'owner/repo' }],
		} as never);
		vi.mocked(resolvePersonaIdentities).mockResolvedValue({} as never);
		(mockTriggerRegistry.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue({
			agentType: 'implementation',
			agentInput: { prNumber: 1 },
			prNumber: 1,
		});
		vi.mocked(resolveGitHubTokenForAck).mockResolvedValue(null);
		vi.mocked(addJob).mockResolvedValue('job-1');

		const result = await handleGitHubWebhook(
			'pull_request',
			{ repository: { full_name: 'owner/repo' }, action: 'opened' },
			mockTriggerRegistry,
		);

		expect(result.shouldProcess).toBe(true);
		expect(result.repoFullName).toBe('owner/repo');
		expect(addJob).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'github',
				eventType: 'pull_request',
				repoFullName: 'owner/repo',
				triggerResult: expect.objectContaining({ agentType: 'implementation' }),
			}),
		);
	});

	it('ignores self-authored issue_comment events', async () => {
		vi.mocked(findProjectByRepo).mockResolvedValue({ id: 'p1' } as never);
		vi.mocked(resolvePersonaIdentities).mockResolvedValue({} as never);
		vi.mocked(isCascadeBot).mockReturnValue(true);

		const result = await handleGitHubWebhook(
			'issue_comment',
			{
				repository: { full_name: 'owner/repo' },
				comment: { user: { login: 'cascade-bot' } },
			},
			mockTriggerRegistry,
		);

		expect(result.shouldProcess).toBe(true); // Event IS processable type...
		expect(addJob).not.toHaveBeenCalled(); // ...but skipped because self-authored
	});

	it('does not queue when dispatch returns no match', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-1', repo: 'owner/repo' }],
		} as never);
		vi.mocked(resolvePersonaIdentities).mockResolvedValue({} as never);
		(mockTriggerRegistry.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue(null);

		await handleGitHubWebhook(
			'check_suite',
			{
				repository: { full_name: 'owner/repo' },
				action: 'completed',
				check_suite: { conclusion: 'success', pull_requests: [{}] },
			},
			mockTriggerRegistry,
		);

		expect(addJob).not.toHaveBeenCalled();
	});
});

describe('processGitHubWebhookEvent', () => {
	it('sends ack reaction for comment events', async () => {
		vi.mocked(findProjectByRepo).mockResolvedValue({ id: 'p1' } as never);
		vi.mocked(resolvePersonaIdentities).mockResolvedValue({} as never);
		vi.mocked(sendAcknowledgeReaction).mockResolvedValue(undefined);
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'p1', repo: 'owner/repo' }],
		} as never);

		await processGitHubWebhookEvent('issue_comment', 'owner/repo', {}, mockTriggerRegistry);

		await vi.waitFor(() => {
			expect(sendAcknowledgeReaction).toHaveBeenCalled();
		});
	});

	it('does not send ack reaction for non-comment events', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-1', repo: 'owner/repo' }],
		} as never);
		vi.mocked(resolvePersonaIdentities).mockResolvedValue({} as never);
		vi.mocked(resolveGitHubTokenForAck).mockResolvedValue(null);

		await processGitHubWebhookEvent('pull_request', 'owner/repo', {}, mockTriggerRegistry);

		expect(sendAcknowledgeReaction).not.toHaveBeenCalled();
	});

	it('stores ackCommentId and ackMessage on the job when ack succeeds', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-1', repo: 'owner/repo' }],
		} as never);
		vi.mocked(resolvePersonaIdentities).mockResolvedValue({} as never);
		(mockTriggerRegistry.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue({
			agentType: 'review',
			agentInput: { prNumber: 42 },
			prNumber: 42,
		});
		vi.mocked(generateAckMessage).mockResolvedValue('Looking into the PR now...');
		vi.mocked(resolveGitHubTokenForAck).mockResolvedValue({
			token: 'ghp_test',
			project: { id: 'proj-1' },
		} as never);
		vi.mocked(extractPRNumber).mockReturnValue(42);
		vi.mocked(postGitHubAck).mockResolvedValue(12345);
		vi.mocked(addJob).mockResolvedValue('job-1');

		await processGitHubWebhookEvent(
			'pull_request',
			'owner/repo',
			{ repository: { full_name: 'owner/repo' } },
			mockTriggerRegistry,
		);

		expect(addJob).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'github',
				ackCommentId: 12345,
				ackMessage: 'Looking into the PR now...',
				triggerResult: expect.objectContaining({ agentType: 'review' }),
			}),
		);
	});

	it('does not queue job when dispatch returns null', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-1', repo: 'owner/repo' }],
		} as never);
		vi.mocked(resolvePersonaIdentities).mockResolvedValue({} as never);
		(mockTriggerRegistry.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue(null);

		await processGitHubWebhookEvent(
			'pull_request',
			'owner/repo',
			{ repository: { full_name: 'owner/repo' } },
			mockTriggerRegistry,
		);

		expect(addJob).not.toHaveBeenCalled();
	});

	it('does not queue job for no-agent triggers', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-1', repo: 'owner/repo' }],
		} as never);
		vi.mocked(resolvePersonaIdentities).mockResolvedValue({} as never);
		(mockTriggerRegistry.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue({
			agentType: null,
			agentInput: {},
			prNumber: 42,
		});

		await processGitHubWebhookEvent(
			'pull_request',
			'owner/repo',
			{ repository: { full_name: 'owner/repo' } },
			mockTriggerRegistry,
		);

		expect(addJob).not.toHaveBeenCalled();
	});
});
