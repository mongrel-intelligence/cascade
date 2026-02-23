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
vi.mock('../../../src/router/ackMessageGenerator.js', () => ({
	extractJiraContext: vi.fn().mockReturnValue('Issue: Test issue'),
	generateAckMessage: vi.fn().mockResolvedValue('Starting implementation...'),
}));
vi.mock('../../../src/router/platformClients.js', () => ({
	resolveJiraCredentials: vi
		.fn()
		.mockResolvedValue({ email: 'e@x.com', apiToken: 'tok', baseUrl: 'https://x.atlassian.net' }),
}));
vi.mock('../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn().mockImplementation((_c: unknown, fn: () => unknown) => fn()),
}));

import { resolveJiraBotAccountId } from '../../../src/router/acknowledgments.js';
import { loadProjectConfig } from '../../../src/router/config.js';
import type { RouterProjectConfig } from '../../../src/router/config.js';
import {
	handleJiraWebhook,
	isSelfAuthoredJiraComment,
	processJiraWebhookEvent,
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
	dispatch: vi.fn().mockResolvedValue(null),
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

describe('processJiraWebhookEvent', () => {
	const fullProject = { id: 'p1', repo: 'owner/repo' };

	it('queues a jira job when dispatch matches', async () => {
		vi.mocked(addJob).mockResolvedValue('job-1');
		(mockTriggerRegistry.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue({
			agentType: 'implementation',
			agentInput: { issueKey: 'MYPROJ-123' },
		});

		await processJiraWebhookEvent(
			mockProject,
			'MYPROJ-123',
			'jira:issue_updated',
			{ issue: { key: 'MYPROJ-123' } },
			[fullProject] as never,
			mockTriggerRegistry,
		);
		expect(addJob).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'jira',
				projectId: 'p1',
				issueKey: 'MYPROJ-123',
				webhookEvent: 'jira:issue_updated',
				triggerResult: expect.objectContaining({ agentType: 'implementation' }),
			}),
		);
	});

	it('does not queue when dispatch returns null', async () => {
		(mockTriggerRegistry.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue(null);

		await processJiraWebhookEvent(
			mockProject,
			'MYPROJ-123',
			'jira:issue_updated',
			{ issue: { key: 'MYPROJ-123' } },
			[fullProject] as never,
			mockTriggerRegistry,
		);
		expect(addJob).not.toHaveBeenCalled();
	});

	it('sends ack reaction for comment events', async () => {
		vi.mocked(addJob).mockResolvedValue('job-1');
		vi.mocked(sendAcknowledgeReaction).mockResolvedValue(undefined);
		(mockTriggerRegistry.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue({
			agentType: 'implementation',
			agentInput: {},
		});

		await processJiraWebhookEvent(
			mockProject,
			'MYPROJ-123',
			'comment_created',
			{ comment: {} },
			[fullProject] as never,
			mockTriggerRegistry,
		);

		await vi.waitFor(() => {
			expect(sendAcknowledgeReaction).toHaveBeenCalledWith('jira', 'p1', expect.any(Object));
		});
	});

	it('does not send reaction for non-comment events', async () => {
		vi.mocked(addJob).mockResolvedValue('job-1');
		(mockTriggerRegistry.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue({
			agentType: 'implementation',
			agentInput: {},
		});

		await processJiraWebhookEvent(
			mockProject,
			'MYPROJ-123',
			'jira:issue_updated',
			{},
			[fullProject] as never,
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

	it('processes jira:issue_updated events for known projects when dispatch matches', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [mockProject],
			fullProjects: [{ id: 'p1' }],
		} as never);
		vi.mocked(addJob).mockResolvedValue('job-1');
		(mockTriggerRegistry.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue({
			agentType: 'implementation',
			agentInput: {},
		});

		const result = await handleJiraWebhook(
			{
				webhookEvent: 'jira:issue_updated',
				issue: { key: 'MYPROJ-1', fields: { project: { key: 'MYPROJ' } } },
			},
			mockTriggerRegistry,
		);

		expect(result.shouldProcess).toBe(true);
		expect(addJob).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'jira',
				projectId: 'p1',
				issueKey: 'MYPROJ-1',
				triggerResult: expect.objectContaining({ agentType: 'implementation' }),
			}),
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
