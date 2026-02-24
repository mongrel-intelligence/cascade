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
	postJiraAck: vi.fn(),
	resolveJiraBotAccountId: vi.fn(),
}));
vi.mock('../../../../src/router/ackMessageGenerator.js', () => ({
	extractJiraContext: vi.fn().mockReturnValue('Issue: PROJ-1'),
	generateAckMessage: vi.fn().mockResolvedValue('Working on it...'),
}));
vi.mock('../../../../src/router/platformClients.js', () => ({
	resolveJiraCredentials: vi.fn().mockResolvedValue({
		email: 'bot@example.com',
		apiToken: 'tok',
		baseUrl: 'https://test.atlassian.net',
		auth: 'base64stuff',
	}),
}));
vi.mock('../../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn().mockImplementation((_creds: unknown, fn: () => unknown) => fn()),
}));

import { postJiraAck, resolveJiraBotAccountId } from '../../../../src/router/acknowledgments.js';
import { JiraRouterAdapter } from '../../../../src/router/adapters/jira.js';
import { loadProjectConfig } from '../../../../src/router/config.js';
import type { RouterProjectConfig } from '../../../../src/router/config.js';
import { sendAcknowledgeReaction } from '../../../../src/router/reactions.js';
import type { TriggerRegistry } from '../../../../src/triggers/registry.js';

const mockProject: RouterProjectConfig = {
	id: 'p1',
	repo: 'owner/repo',
	pmType: 'jira',
	jira: {
		projectKey: 'PROJ',
		baseUrl: 'https://test.atlassian.net',
	},
};

const mockTriggerRegistry = {
	dispatch: vi.fn().mockResolvedValue(null),
} as unknown as TriggerRegistry;

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(loadProjectConfig).mockResolvedValue({
		projects: [mockProject],
		fullProjects: [{ id: 'p1' } as never],
	});
});

describe('JiraRouterAdapter', () => {
	let adapter: JiraRouterAdapter;

	beforeEach(() => {
		adapter = new JiraRouterAdapter();
	});

	describe('parseWebhook', () => {
		it('returns null for empty payload', async () => {
			const result = await adapter.parseWebhook({});
			expect(result).toBeNull();
		});

		it('returns null for non-processable event', async () => {
			const result = await adapter.parseWebhook({
				webhookEvent: 'jira:sprint_updated',
				issue: { key: 'PROJ-1', fields: { project: { key: 'PROJ' } } },
			});
			expect(result).toBeNull();
		});

		it('returns null when no project matches', async () => {
			vi.mocked(loadProjectConfig).mockResolvedValue({ projects: [], fullProjects: [] });
			const result = await adapter.parseWebhook({
				webhookEvent: 'jira:issue_updated',
				issue: { key: 'OTHER-1', fields: { project: { key: 'OTHER' } } },
			});
			expect(result).toBeNull();
		});

		it('returns parsed event for jira:issue_updated', async () => {
			const result = await adapter.parseWebhook({
				webhookEvent: 'jira:issue_updated',
				issue: { key: 'PROJ-1', fields: { project: { key: 'PROJ' } } },
			});
			expect(result).not.toBeNull();
			expect(result?.eventType).toBe('jira:issue_updated');
			expect(result?.workItemId).toBe('PROJ-1');
			expect(result?.isCommentEvent).toBe(false);
		});

		it('returns parsed event for comment_created (isCommentEvent=true)', async () => {
			const result = await adapter.parseWebhook({
				webhookEvent: 'comment_created',
				issue: { key: 'PROJ-1', fields: { project: { key: 'PROJ' } } },
				comment: { author: { accountId: 'user-123' } },
			});
			expect(result).not.toBeNull();
			expect(result?.isCommentEvent).toBe(true);
		});
	});

	describe('isSelfAuthored', () => {
		it('returns false for non-comment events', async () => {
			const result = await adapter.isSelfAuthored(
				{ projectIdentifier: 'PROJ', eventType: 'jira:issue_updated', isCommentEvent: false },
				{},
			);
			expect(result).toBe(false);
		});

		it('returns true when comment author matches bot ID', async () => {
			vi.mocked(resolveJiraBotAccountId).mockResolvedValue('bot-account-id');
			const result = await adapter.isSelfAuthored(
				{
					projectIdentifier: 'PROJ',
					eventType: 'comment_created',
					isCommentEvent: true,
					// @ts-expect-error extended field
					projectId: 'p1',
				},
				{ comment: { author: { accountId: 'bot-account-id' } } },
			);
			expect(result).toBe(true);
		});

		it('returns false when comment author does not match', async () => {
			vi.mocked(resolveJiraBotAccountId).mockResolvedValue('bot-account-id');
			const result = await adapter.isSelfAuthored(
				{
					projectIdentifier: 'PROJ',
					eventType: 'comment_created',
					isCommentEvent: true,
					// @ts-expect-error extended field
					projectId: 'p1',
				},
				{ comment: { author: { accountId: 'other-user' } } },
			);
			expect(result).toBe(false);
		});
	});

	describe('sendReaction', () => {
		it('does nothing for non-comment events', () => {
			adapter.sendReaction(
				{ projectIdentifier: 'PROJ', eventType: 'jira:issue_updated', isCommentEvent: false },
				{},
			);
			expect(sendAcknowledgeReaction).not.toHaveBeenCalled();
		});

		it('fires reaction for comment events', async () => {
			vi.mocked(sendAcknowledgeReaction).mockResolvedValue(undefined);
			adapter.sendReaction(
				{
					projectIdentifier: 'PROJ',
					eventType: 'comment_created',
					isCommentEvent: true,
					// @ts-expect-error extended field
					projectId: 'p1',
				},
				{ comment: {} },
			);
			await vi.waitFor(() => {
				expect(sendAcknowledgeReaction).toHaveBeenCalledWith('jira', 'p1', expect.any(Object));
			});
		});
	});

	describe('resolveProject', () => {
		it('returns project matching JIRA project key', async () => {
			const project = await adapter.resolveProject({
				projectIdentifier: 'PROJ',
				eventType: 'jira:issue_updated',
				isCommentEvent: false,
			});
			expect(project?.id).toBe('p1');
		});

		it('returns null for unknown project key', async () => {
			const project = await adapter.resolveProject({
				projectIdentifier: 'UNKNOWN',
				eventType: 'jira:issue_updated',
				isCommentEvent: false,
			});
			expect(project).toBeNull();
		});
	});

	describe('postAck', () => {
		it('posts ack and returns AckResult with commentId and message', async () => {
			vi.mocked(postJiraAck).mockResolvedValue('jira-comment-456');
			const ackResult = await adapter.postAck(
				{
					projectIdentifier: 'PROJ',
					eventType: 'jira:issue_updated',
					workItemId: 'PROJ-1',
					isCommentEvent: false,
					// @ts-expect-error extended field
					issueKey: 'PROJ-1',
				},
				{},
				mockProject,
				'implementation',
			);
			expect(ackResult?.commentId).toBe('jira-comment-456');
			expect(ackResult?.message).toBe('Working on it...');
		});

		it('returns undefined when no issueKey', async () => {
			const ackResult = await adapter.postAck(
				{
					projectIdentifier: 'PROJ',
					eventType: 'jira:issue_updated',
					isCommentEvent: false,
					// @ts-expect-error extended field
					issueKey: '',
				},
				{},
				mockProject,
				'implementation',
			);
			expect(ackResult).toBeUndefined();
		});
	});

	describe('buildJob', () => {
		it('builds a jira job with correct fields', () => {
			const result = { agentType: 'implementation', agentInput: { issueKey: 'PROJ-1' } };
			const job = adapter.buildJob(
				{
					projectIdentifier: 'PROJ',
					eventType: 'jira:issue_updated',
					workItemId: 'PROJ-1',
					isCommentEvent: false,
					// @ts-expect-error extended field
					issueKey: 'PROJ-1',
					webhookEvent: 'jira:issue_updated',
					projectId: 'p1',
				},
				{},
				mockProject,
				result as never,
				'jira-comment-789',
			);
			expect(job.type).toBe('jira');
			expect((job as { issueKey: string }).issueKey).toBe('PROJ-1');
			expect((job as { ackCommentId: string }).ackCommentId).toBe('jira-comment-789');
		});
	});
});
