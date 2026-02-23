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
	sendAcknowledgeReaction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/router/acknowledgments.js', () => ({
	postTrelloAck: vi.fn(),
	resolveTrelloBotMemberId: vi.fn(),
}));
vi.mock('../../../src/router/ackMessageGenerator.js', () => ({
	extractTrelloContext: vi.fn().mockReturnValue('Card: Test card'),
	generateAckMessage: vi.fn().mockResolvedValue('Starting implementation...'),
}));
vi.mock('../../../src/router/platformClients.js', () => ({
	resolveTrelloCredentials: vi.fn().mockResolvedValue({ apiKey: 'key', token: 'tok' }),
}));
vi.mock('../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn().mockImplementation((_creds: unknown, fn: () => unknown) => fn()),
}));

import { postTrelloAck, resolveTrelloBotMemberId } from '../../../src/router/acknowledgments.js';
import { loadProjectConfig } from '../../../src/router/config.js';
import type { RouterProjectConfig } from '../../../src/router/config.js';
import { addJob } from '../../../src/router/queue.js';
import { sendAcknowledgeReaction } from '../../../src/router/reactions.js';
import {
	handleTrelloWebhook,
	isAgentLogAttachmentUploaded,
	isAgentLogFilename,
	isCardInTriggerList,
	isReadyToProcessLabelAdded,
	isSelfAuthoredTrelloComment,
	parseTrelloWebhook,
	processTrelloWebhookEvent,
} from '../../../src/router/trello.js';
import type { TriggerRegistry } from '../../../src/triggers/registry.js';

const mockProject: RouterProjectConfig = {
	id: 'p1',
	repo: 'owner/repo',
	pmType: 'trello',
	trello: {
		boardId: 'board1',
		lists: {
			briefing: 'list-briefing',
			planning: 'list-planning',
			todo: 'list-todo',
			debug: 'list-debug',
		},
		labels: { readyToProcess: 'label-ready' },
	},
};

const mockTriggerRegistry = {
	dispatch: vi.fn().mockResolvedValue(null),
} as unknown as TriggerRegistry;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('isAgentLogFilename', () => {
	it('matches valid agent log filenames', () => {
		expect(isAgentLogFilename('implementation-2026-01-02T16-30-24-339Z.zip')).toBe(true);
		expect(isAgentLogFilename('briefing-timeout-2026-01-02T12-34-56-789Z.zip')).toBe(true);
	});

	it('matches multi-hyphen agent names (e.g. respond-to-review)', () => {
		expect(isAgentLogFilename('respond-to-review-2026-01-02T16-30-24-339Z.zip')).toBe(true);
		expect(isAgentLogFilename('respond-to-pr-comment-2026-01-02T16-30-24-339Z.zip')).toBe(true);
	});

	it('does not match non-zip filenames', () => {
		expect(isAgentLogFilename('screenshot.png')).toBe(false);
	});

	it('does not match filenames without a timestamp', () => {
		expect(isAgentLogFilename('implementation.zip')).toBe(false);
	});

	it('matches debug-prefixed filenames (caller filters separately)', () => {
		expect(isAgentLogFilename('debug-2026-01-02T16-30-24-339Z.zip')).toBe(true);
	});
});

describe('isCardInTriggerList', () => {
	it('returns true when card moved to trigger list', () => {
		const result = isCardInTriggerList(
			'updateCard',
			{ listAfter: { id: 'list-todo' } },
			mockProject,
		);
		expect(result).toBe(true);
	});

	it('returns false when card moved to non-trigger list', () => {
		const result = isCardInTriggerList(
			'updateCard',
			{ listAfter: { id: 'list-other' } },
			mockProject,
		);
		expect(result).toBe(false);
	});

	it('returns true when card created in trigger list', () => {
		const result = isCardInTriggerList(
			'createCard',
			{ list: { id: 'list-briefing' } },
			mockProject,
		);
		expect(result).toBe(true);
	});

	it('returns false when project has no trello config', () => {
		const result = isCardInTriggerList(
			'updateCard',
			{ listAfter: { id: 'list-todo' } },
			{
				...mockProject,
				trello: undefined,
			},
		);
		expect(result).toBe(false);
	});
});

describe('isReadyToProcessLabelAdded', () => {
	it('returns true when ready-to-process label added', () => {
		const result = isReadyToProcessLabelAdded(
			'addLabelToCard',
			{ label: { id: 'label-ready' } },
			mockProject,
		);
		expect(result).toBe(true);
	});

	it('returns false for wrong action type', () => {
		const result = isReadyToProcessLabelAdded(
			'commentCard',
			{ label: { id: 'label-ready' } },
			mockProject,
		);
		expect(result).toBe(false);
	});

	it('returns false for different label', () => {
		const result = isReadyToProcessLabelAdded(
			'addLabelToCard',
			{ label: { id: 'label-other' } },
			mockProject,
		);
		expect(result).toBe(false);
	});
});

describe('isAgentLogAttachmentUploaded', () => {
	it('returns true for matching attachment name', () => {
		const result = isAgentLogAttachmentUploaded(
			'addAttachmentToCard',
			{ attachment: { name: 'implementation-2026-01-02T16-30-24-339Z.zip' } },
			mockProject,
		);
		expect(result).toBe(true);
	});

	it('returns false for debug- prefixed attachments', () => {
		const result = isAgentLogAttachmentUploaded(
			'addAttachmentToCard',
			{ attachment: { name: 'debug-2026-01-02T16-30-24-339Z.zip' } },
			mockProject,
		);
		expect(result).toBe(false);
	});

	it('returns false when project has no debug list', () => {
		const result = isAgentLogAttachmentUploaded(
			'addAttachmentToCard',
			{ attachment: { name: 'implementation-2026-01-02T16-30-24-339Z.zip' } },
			{
				...mockProject,
				trello: { ...mockProject.trello, lists: { ...mockProject.trello?.lists, debug: '' } },
			},
		);
		expect(result).toBe(false);
	});
});

describe('parseTrelloWebhook', () => {
	it('returns shouldProcess false for invalid payload', async () => {
		const result = await parseTrelloWebhook(null);
		expect(result.shouldProcess).toBe(false);
	});

	it('returns shouldProcess false when no matching project', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({ projects: [], fullProjects: [] });
		const result = await parseTrelloWebhook({
			action: { type: 'commentCard', data: {} },
			model: { id: 'unknown-board' },
		});
		expect(result.shouldProcess).toBe(false);
	});

	it('returns shouldProcess true for commentCard event', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [mockProject],
			fullProjects: [],
		});
		const result = await parseTrelloWebhook({
			action: { type: 'commentCard', data: { card: { id: 'card1' } } },
			model: { id: 'board1' },
		});
		expect(result.shouldProcess).toBe(true);
		expect(result.cardId).toBe('card1');
		expect(result.actionType).toBe('commentCard');
	});
});

describe('isSelfAuthoredTrelloComment', () => {
	it('returns true when comment author matches bot ID', async () => {
		vi.mocked(resolveTrelloBotMemberId).mockResolvedValue('bot-id');
		const result = await isSelfAuthoredTrelloComment(
			{ action: { idMemberCreator: 'bot-id' } },
			'p1',
		);
		expect(result).toBe(true);
	});

	it('returns false when comment author does not match', async () => {
		vi.mocked(resolveTrelloBotMemberId).mockResolvedValue('bot-id');
		const result = await isSelfAuthoredTrelloComment(
			{ action: { idMemberCreator: 'user-id' } },
			'p1',
		);
		expect(result).toBe(false);
	});

	it('returns false when identity resolution fails', async () => {
		vi.mocked(resolveTrelloBotMemberId).mockRejectedValue(new Error('DB error'));
		const result = await isSelfAuthoredTrelloComment(
			{ action: { idMemberCreator: 'bot-id' } },
			'p1',
		);
		expect(result).toBe(false);
	});
});

describe('processTrelloWebhookEvent', () => {
	it('ignores self-authored comments', async () => {
		vi.mocked(resolveTrelloBotMemberId).mockResolvedValue('bot-id');
		await processTrelloWebhookEvent(
			mockProject,
			'card1',
			'commentCard',
			{ action: { idMemberCreator: 'bot-id' } },
			mockTriggerRegistry,
		);
		expect(addJob).not.toHaveBeenCalled();
	});

	it('does not queue a job when dispatch returns null', async () => {
		vi.mocked(resolveTrelloBotMemberId).mockResolvedValue('bot-id');
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [mockProject],
			fullProjects: [{ id: 'p1' }],
		} as never);
		(mockTriggerRegistry.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue(null);

		await processTrelloWebhookEvent(
			mockProject,
			'card1',
			'commentCard',
			{ action: { idMemberCreator: 'user-id' } },
			mockTriggerRegistry,
		);
		expect(addJob).not.toHaveBeenCalled();
	});

	it('queues a job when dispatch returns a result', async () => {
		vi.mocked(resolveTrelloBotMemberId).mockResolvedValue('bot-id');
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [mockProject],
			fullProjects: [{ id: 'p1' }],
		} as never);
		vi.mocked(addJob).mockResolvedValue('job-1');
		(mockTriggerRegistry.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue({
			agentType: 'implementation',
			agentInput: { cardId: 'card1' },
		});

		await processTrelloWebhookEvent(
			mockProject,
			'card1',
			'commentCard',
			{ action: { idMemberCreator: 'user-id' } },
			mockTriggerRegistry,
		);
		expect(addJob).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'trello',
				projectId: 'p1',
				cardId: 'card1',
				actionType: 'commentCard',
				triggerResult: expect.objectContaining({ agentType: 'implementation' }),
			}),
		);
	});

	it('sends ack reaction for comment actions', async () => {
		vi.mocked(resolveTrelloBotMemberId).mockResolvedValue('bot-id');
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [mockProject],
			fullProjects: [{ id: 'p1' }],
		} as never);
		vi.mocked(addJob).mockResolvedValue('job-1');
		vi.mocked(sendAcknowledgeReaction).mockResolvedValue(undefined);
		(mockTriggerRegistry.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue({
			agentType: 'implementation',
			agentInput: { cardId: 'card1' },
		});

		await processTrelloWebhookEvent(
			mockProject,
			'card1',
			'commentCard',
			{ action: { idMemberCreator: 'user-id' } },
			mockTriggerRegistry,
		);
		// Reaction is fire-and-forget so we just check it was called
		await vi.waitFor(() => {
			expect(sendAcknowledgeReaction).toHaveBeenCalledWith('trello', 'p1', expect.any(Object));
		});
	});
});

describe('handleTrelloWebhook', () => {
	it('returns shouldProcess false and ignores invalid payload', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({ projects: [], fullProjects: [] });
		const result = await handleTrelloWebhook({}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(false);
		expect(addJob).not.toHaveBeenCalled();
	});

	it('processes a valid trello webhook', async () => {
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [mockProject],
			fullProjects: [],
		});
		vi.mocked(resolveTrelloBotMemberId).mockResolvedValue('bot-id');
		vi.mocked(addJob).mockResolvedValue('job-1');

		const result = await handleTrelloWebhook(
			{
				action: {
					type: 'commentCard',
					data: { card: { id: 'card1' } },
					idMemberCreator: 'user-id',
				},
				model: { id: 'board1' },
			},
			mockTriggerRegistry,
		);

		expect(result.shouldProcess).toBe(true);
	});
});
