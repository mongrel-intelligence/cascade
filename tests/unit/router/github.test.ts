import { beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('../../../src/config/provider.js', () => ({
	findProjectByRepo: vi.fn(),
}));
vi.mock('../../../src/github/personas.js', () => ({
	resolvePersonaIdentities: vi.fn(),
	isCascadeBot: vi.fn(),
}));

import { findProjectByRepo } from '../../../src/config/provider.js';
import { isCascadeBot, resolvePersonaIdentities } from '../../../src/github/personas.js';
import { resolveGitHubTokenForAck } from '../../../src/router/acknowledgments.js';
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
	matchTrigger: vi.fn(),
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

	it('processes pull_request events', async () => {
		vi.mocked(findProjectByRepo).mockResolvedValue(null);
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

	it('processes check_suite events', async () => {
		vi.mocked(addJob).mockResolvedValue('job-1');
		vi.mocked(addEyesReactionToPR).mockResolvedValue(undefined);

		await handleGitHubWebhook(
			'check_suite',
			{
				repository: { full_name: 'owner/repo' },
				action: 'completed',
				check_suite: { conclusion: 'success', pull_requests: [{}] },
			},
			mockTriggerRegistry,
		);

		expect(addJob).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'github', eventType: 'check_suite' }),
		);
	});
});

describe('processGitHubWebhookEvent', () => {
	it('sends ack reaction for comment events', async () => {
		vi.mocked(findProjectByRepo).mockResolvedValue({ id: 'p1' } as never);
		vi.mocked(resolvePersonaIdentities).mockResolvedValue({} as never);
		vi.mocked(addJob).mockResolvedValue('job-1');
		vi.mocked(sendAcknowledgeReaction).mockResolvedValue(undefined);

		await processGitHubWebhookEvent('issue_comment', 'owner/repo', {}, mockTriggerRegistry);

		await vi.waitFor(() => {
			expect(sendAcknowledgeReaction).toHaveBeenCalled();
		});
	});

	it('does not send ack reaction for non-comment events', async () => {
		vi.mocked(addJob).mockResolvedValue('job-1');
		vi.mocked(resolveGitHubTokenForAck).mockResolvedValue(null);
		vi.mocked(extractPRNumber).mockReturnValue(null);

		await processGitHubWebhookEvent('pull_request', 'owner/repo', {}, mockTriggerRegistry);

		expect(sendAcknowledgeReaction).not.toHaveBeenCalled();
	});
});
