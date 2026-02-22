import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock heavy imports
vi.mock('../../../src/router/config.js', () => ({
	loadProjectConfig: vi.fn(),
}));
vi.mock('../../../src/router/queue.js', () => ({
	addJob: vi.fn(),
}));
vi.mock('../../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: vi.fn(),
}));
vi.mock('../../../src/router/acknowledgments.js', () => ({
	postJiraAck: vi.fn(),
	resolveJiraBotAccountId: vi.fn(),
}));
vi.mock('../../../src/config/agentMessages.js', () => ({
	INITIAL_MESSAGES: { implementation: 'Starting implementation...' },
}));

import { resolveJiraBotAccountId } from '../../../src/router/acknowledgments.js';
import { loadProjectConfig } from '../../../src/router/config.js';
import type { RouterProjectConfig } from '../../../src/router/config.js';
import {
	handleJiraWebhook,
	isSelfAuthoredJiraComment,
	queueJiraJob,
} from '../../../src/router/jira.js';
import { addJob } from '../../../src/router/queue.js';
import { sendAcknowledgeReaction } from '../../../src/router/reactions.js';
import type { TriggerRegistry } from '../../../src/triggers/registry.js';

const mockProject: RouterProjectConfig = {
	id: 'p1',
	repo: 'owner/repo',
	pmType: 'jira',
	jira: {
		projectKey: 'MYPROJ',
		baseUrl: 'https://mycompany.atlassian.net',
	},
};

const mockTriggerRegistry = {
	matchTrigger: vi.fn(),
} as unknown as TriggerRegistry;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('isSelfAuthoredJiraComment', () => {
	it('returns true when comment author matches bot account ID', async () => {
		vi.mocked(resolveJiraBotAccountId).mockResolvedValue('bot-account-id');
		const result = await isSelfAuthoredJiraComment(
			'comment_created',
			{ comment: { author: { accountId: 'bot-account-id' } } },
			'p1',
		);
		expect(result).toBe(true);
	});

	it('returns false when comment author does not match', async () => {
		vi.mocked(resolveJiraBotAccountId).mockResolvedValue('bot-account-id');
		const result = await isSelfAuthoredJiraComment(
			'comment_created',
			{ comment: { author: { accountId: 'user-account-id' } } },
			'p1',
		);
		expect(result).toBe(false);
	});

	it('returns false for non-comment webhook events', async () => {
		const result = await isSelfAuthoredJiraComment(
			'jira:issue_updated',
			{ comment: { author: { accountId: 'bot-account-id' } } },
			'p1',
		);
		expect(result).toBe(false);
		expect(resolveJiraBotAccountId).not.toHaveBeenCalled();
	});

	it('returns false when identity resolution fails', async () => {
		vi.mocked(resolveJiraBotAccountId).mockRejectedValue(new Error('DB error'));
		const result = await isSelfAuthoredJiraComment(
			'comment_created',
			{ comment: { author: { accountId: 'bot-account-id' } } },
			'p1',
		);
		expect(result).toBe(false);
	});
});

describe('queueJiraJob', () => {
	it('queues a jira job', async () => {
		vi.mocked(addJob).mockResolvedValue('job-1');
		await queueJiraJob(
			mockProject,
			'MYPROJ-123',
			'jira:issue_updated',
			{ issue: { key: 'MYPROJ-123' } },
			[],
			mockTriggerRegistry,
		);
		expect(addJob).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'jira',
				projectId: 'p1',
				issueKey: 'MYPROJ-123',
				webhookEvent: 'jira:issue_updated',
			}),
		);
	});

	it('sends ack reaction for comment events', async () => {
		vi.mocked(addJob).mockResolvedValue('job-1');
		vi.mocked(sendAcknowledgeReaction).mockResolvedValue(undefined);

		await queueJiraJob(
			mockProject,
			'MYPROJ-123',
			'comment_created',
			{ comment: {} },
			[],
			mockTriggerRegistry,
		);

		await vi.waitFor(() => {
			expect(sendAcknowledgeReaction).toHaveBeenCalledWith('jira', 'p1', expect.any(Object));
		});
	});

	it('does not send reaction for non-comment events', async () => {
		vi.mocked(addJob).mockResolvedValue('job-1');
		await queueJiraJob(
			mockProject,
			'MYPROJ-123',
			'jira:issue_updated',
			{},
			[],
			mockTriggerRegistry,
		);
		expect(sendAcknowledgeReaction).not.toHaveBeenCalled();
	});
});

describe('handleJiraWebhook', () => {
	it('ignores events with unknown project', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [],
			fullProjects: [],
		});
		const result = await handleJiraWebhook(
			{
				webhookEvent: 'jira:issue_updated',
				issue: { key: 'UNKNOWN-1', fields: { project: { key: 'UNKNOWN' } } },
			},
			mockTriggerRegistry,
		);
		expect(result.shouldProcess).toBe(false);
		expect(addJob).not.toHaveBeenCalled();
	});

	it('ignores unknown event types', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [mockProject],
			fullProjects: [],
		});
		const result = await handleJiraWebhook(
			{
				webhookEvent: 'unknown_event',
				issue: { key: 'MYPROJ-1', fields: { project: { key: 'MYPROJ' } } },
			},
			mockTriggerRegistry,
		);
		expect(result.shouldProcess).toBe(false);
		expect(addJob).not.toHaveBeenCalled();
	});

	it('processes jira:issue_updated events for known projects', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [mockProject],
			fullProjects: [],
		});
		vi.mocked(addJob).mockResolvedValue('job-1');

		const result = await handleJiraWebhook(
			{
				webhookEvent: 'jira:issue_updated',
				issue: { key: 'MYPROJ-1', fields: { project: { key: 'MYPROJ' } } },
			},
			mockTriggerRegistry,
		);

		expect(result.shouldProcess).toBe(true);
		expect(addJob).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'jira', projectId: 'p1', issueKey: 'MYPROJ-1' }),
		);
	});

	it('ignores self-authored JIRA comments', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [mockProject],
			fullProjects: [],
		});
		vi.mocked(resolveJiraBotAccountId).mockResolvedValue('bot-id');

		await handleJiraWebhook(
			{
				webhookEvent: 'comment_created',
				issue: { key: 'MYPROJ-1', fields: { project: { key: 'MYPROJ' } } },
				comment: { author: { accountId: 'bot-id' } },
			},
			mockTriggerRegistry,
		);

		expect(addJob).not.toHaveBeenCalled();
	});
});
