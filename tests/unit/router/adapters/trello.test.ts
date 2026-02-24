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
	postTrelloAck: vi.fn(),
	resolveTrelloBotMemberId: vi.fn(),
}));
vi.mock('../../../../src/router/ackMessageGenerator.js', () => ({
	extractTrelloContext: vi.fn().mockReturnValue('Card: Test card'),
	generateAckMessage: vi.fn().mockResolvedValue('Starting implementation...'),
}));
vi.mock('../../../../src/router/platformClients.js', () => ({
	resolveTrelloCredentials: vi.fn().mockResolvedValue({ apiKey: 'key', token: 'tok' }),
}));
vi.mock('../../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn().mockImplementation((_creds: unknown, fn: () => unknown) => fn()),
}));
vi.mock('../../../../src/router/trello.js', () => ({
	isAgentLogFilename: vi.fn().mockReturnValue(false),
	isAgentLogAttachmentUploaded: vi.fn().mockReturnValue(false),
	isCardInTriggerList: vi.fn().mockReturnValue(false),
	isReadyToProcessLabelAdded: vi.fn().mockReturnValue(false),
	isSelfAuthoredTrelloComment: vi.fn().mockResolvedValue(false),
}));

import { postTrelloAck } from '../../../../src/router/acknowledgments.js';
import { TrelloRouterAdapter } from '../../../../src/router/adapters/trello.js';
import { loadProjectConfig } from '../../../../src/router/config.js';
import type { RouterProjectConfig } from '../../../../src/router/config.js';
import { addJob } from '../../../../src/router/queue.js';
import { sendAcknowledgeReaction } from '../../../../src/router/reactions.js';
import { isCardInTriggerList, isSelfAuthoredTrelloComment } from '../../../../src/router/trello.js';
import type { TriggerRegistry } from '../../../../src/triggers/registry.js';

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
	vi.mocked(loadProjectConfig).mockResolvedValue({
		projects: [mockProject],
		fullProjects: [{ id: 'p1' } as never],
	});
});

describe('TrelloRouterAdapter', () => {
	let adapter: TrelloRouterAdapter;

	beforeEach(() => {
		adapter = new TrelloRouterAdapter();
	});

	describe('parseWebhook', () => {
		it('returns null for invalid payload', async () => {
			const result = await adapter.parseWebhook(null);
			expect(result).toBeNull();
		});

		it('returns null when no matching project', async () => {
			vi.mocked(loadProjectConfig).mockResolvedValue({ projects: [], fullProjects: [] });
			const result = await adapter.parseWebhook({
				action: { type: 'commentCard', data: {} },
				model: { id: 'unknown-board' },
			});
			expect(result).toBeNull();
		});

		it('returns parsed event for commentCard action', async () => {
			vi.mocked(isCardInTriggerList).mockReturnValue(false);
			const result = await adapter.parseWebhook({
				action: { type: 'commentCard', data: { card: { id: 'card1' } } },
				model: { id: 'board1' },
			});
			expect(result).not.toBeNull();
			expect(result?.eventType).toBe('commentCard');
			expect(result?.workItemId).toBe('card1');
			expect(result?.isCommentEvent).toBe(true);
		});

		it('returns null for non-processable action on matching project', async () => {
			vi.mocked(isCardInTriggerList).mockReturnValue(false);
			const result = await adapter.parseWebhook({
				action: { type: 'createCheckItem', data: {} },
				model: { id: 'board1' },
			});
			expect(result).toBeNull();
		});
	});

	describe('isProcessableEvent', () => {
		it('always returns true (filtering done in parseWebhook)', () => {
			expect(
				adapter.isProcessableEvent({
					projectIdentifier: 'board1',
					eventType: 'commentCard',
					isCommentEvent: true,
				}),
			).toBe(true);
		});
	});

	describe('isSelfAuthored', () => {
		it('returns false for non-comment events', async () => {
			const result = await adapter.isSelfAuthored(
				{ projectIdentifier: 'board1', eventType: 'updateCard', isCommentEvent: false },
				{},
			);
			expect(result).toBe(false);
		});

		it('delegates to isSelfAuthoredTrelloComment for comment events', async () => {
			vi.mocked(isSelfAuthoredTrelloComment).mockResolvedValue(true);
			const result = await adapter.isSelfAuthored(
				{ projectIdentifier: 'board1', eventType: 'commentCard', isCommentEvent: true },
				{ action: { idMemberCreator: 'bot-id' } },
			);
			expect(result).toBe(true);
		});
	});

	describe('sendReaction', () => {
		it('does nothing for non-comment events', () => {
			adapter.sendReaction(
				{ projectIdentifier: 'board1', eventType: 'updateCard', isCommentEvent: false },
				{},
			);
			// No reaction should be dispatched
		});

		it('fires reaction for comment events', async () => {
			adapter.sendReaction(
				{ projectIdentifier: 'board1', eventType: 'commentCard', isCommentEvent: true },
				{ action: { type: 'commentCard' } },
			);
			// Wait for the fire-and-forget async to complete
			await vi.waitFor(() => {
				expect(sendAcknowledgeReaction).toHaveBeenCalledWith('trello', 'p1', expect.any(Object));
			});
		});
	});

	describe('resolveProject', () => {
		it('returns project matching boardId', async () => {
			const project = await adapter.resolveProject({
				projectIdentifier: 'board1',
				eventType: 'commentCard',
				isCommentEvent: true,
			});
			expect(project?.id).toBe('p1');
		});

		it('returns null for unknown boardId', async () => {
			const project = await adapter.resolveProject({
				projectIdentifier: 'unknown-board',
				eventType: 'commentCard',
				isCommentEvent: true,
			});
			expect(project).toBeNull();
		});
	});

	describe('dispatchWithCredentials', () => {
		it('dispatches to trigger registry', async () => {
			vi.mocked(mockTriggerRegistry.dispatch).mockResolvedValue({
				agentType: 'implementation',
				agentInput: { cardId: 'card1' },
			} as never);

			const result = await adapter.dispatchWithCredentials(
				{ projectIdentifier: 'board1', eventType: 'commentCard', isCommentEvent: true },
				{},
				mockProject,
				mockTriggerRegistry,
			);
			expect(result?.agentType).toBe('implementation');
		});

		it('returns null when no full project found', async () => {
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [mockProject],
				fullProjects: [],
			});

			const result = await adapter.dispatchWithCredentials(
				{ projectIdentifier: 'board1', eventType: 'commentCard', isCommentEvent: true },
				{},
				mockProject,
				mockTriggerRegistry,
			);
			expect(result).toBeNull();
		});
	});

	describe('postAck', () => {
		it('posts ack and returns comment ID', async () => {
			vi.mocked(postTrelloAck).mockResolvedValue('comment-123');
			const id = await adapter.postAck(
				{
					projectIdentifier: 'board1',
					eventType: 'commentCard',
					workItemId: 'card1',
					isCommentEvent: true,
				},
				{},
				mockProject,
				'implementation',
			);
			expect(id).toBe('comment-123');
		});

		it('returns undefined when no workItemId', async () => {
			const id = await adapter.postAck(
				{ projectIdentifier: 'board1', eventType: 'commentCard', isCommentEvent: true },
				{},
				mockProject,
				'implementation',
			);
			expect(id).toBeUndefined();
		});
	});

	describe('buildJob', () => {
		it('builds a trello job with correct fields', () => {
			const result = {
				agentType: 'implementation',
				agentInput: { cardId: 'card1' },
			};
			const job = adapter.buildJob(
				{
					projectIdentifier: 'board1',
					eventType: 'commentCard',
					workItemId: 'card1',
					isCommentEvent: true,
				},
				{ action: { type: 'commentCard' } },
				mockProject,
				result as never,
				'comment-abc',
			);
			expect(job.type).toBe('trello');
			expect(job.source).toBe('trello');
			expect((job as { cardId: string }).cardId).toBe('card1');
			expect((job as { ackCommentId: string }).ackCommentId).toBe('comment-abc');
		});
	});
});

describe('handleTrelloWebhookViaAdapter', () => {
	it('queues a job when dispatch returns a result', async () => {
		const { handleTrelloWebhookViaAdapter } = await import(
			'../../../../src/router/adapters/trello.js'
		);
		vi.mocked(isSelfAuthoredTrelloComment).mockResolvedValue(false);
		vi.mocked(isCardInTriggerList).mockReturnValue(false);
		vi.mocked(addJob).mockResolvedValue('job-1');
		vi.mocked(postTrelloAck).mockResolvedValue('comment-123');
		vi.mocked(mockTriggerRegistry.dispatch).mockResolvedValue({
			agentType: 'implementation',
			agentInput: { cardId: 'card1' },
		} as never);

		const result = await handleTrelloWebhookViaAdapter(
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
		expect(addJob).toHaveBeenCalled();
	});
});
