import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetIntegrationCredential = vi.fn();
const mockLoadProjectConfigByBoardId = vi.fn();

vi.mock('../../../../src/config/provider.js', () => ({
	getIntegrationCredential: (...args: unknown[]) => mockGetIntegrationCredential(...args),
	loadProjectConfigByBoardId: (...args: unknown[]) => mockLoadProjectConfigByBoardId(...args),
}));

const mockWithTrelloCredentials = vi.fn().mockImplementation((_creds, fn) => fn());
vi.mock('../../../../src/trello/client.js', () => ({
	withTrelloCredentials: (...args: unknown[]) => mockWithTrelloCredentials(...args),
}));

const mockPostTrelloAck = vi.fn();
const mockDeleteTrelloAck = vi.fn();
const mockResolveTrelloBotMemberId = vi.fn();
vi.mock('../../../../src/router/acknowledgments.js', () => ({
	postTrelloAck: (...args: unknown[]) => mockPostTrelloAck(...args),
	deleteTrelloAck: (...args: unknown[]) => mockDeleteTrelloAck(...args),
	resolveTrelloBotMemberId: (...args: unknown[]) => mockResolveTrelloBotMemberId(...args),
}));

const mockSendAcknowledgeReaction = vi.fn();
vi.mock('../../../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: (...args: unknown[]) => mockSendAcknowledgeReaction(...args),
}));

vi.mock('../../../../src/pm/config.js', () => ({
	getTrelloConfig: vi.fn().mockReturnValue({
		labels: {
			processing: 'label-processing',
			processed: 'label-processed',
			error: 'label-error',
			readyToProcess: 'label-ready',
			auto: 'label-auto',
		},
		lists: {
			backlog: 'list-backlog',
			inProgress: 'list-in-progress',
			inReview: 'list-in-review',
			done: 'list-done',
			merged: 'list-merged',
		},
	}),
}));

import { TrelloIntegration } from '../../../../src/pm/trello/integration.js';
import type { ProjectConfig } from '../../../../src/types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
	return {
		id: 'proj-1',
		orgId: 'org-1',
		name: 'Test Project',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		pm: { type: 'trello' },
		trello: {
			boardId: 'board-123',
			lists: { splitting: 'list-1', planning: 'list-2', todo: 'list-3' },
			labels: {},
		},
		...overrides,
	} as ProjectConfig;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TrelloIntegration', () => {
	let integration: TrelloIntegration;

	beforeEach(() => {
		integration = new TrelloIntegration();
	});

	it('has type "trello"', () => {
		expect(integration.type).toBe('trello');
	});

	// =========================================================================
	// createProvider
	// =========================================================================
	describe('createProvider', () => {
		it('returns a TrelloPMProvider instance', () => {
			const project = makeProject();
			const provider = integration.createProvider(project);
			expect(provider).toBeDefined();
			expect(provider.type).toBe('trello');
		});
	});

	// =========================================================================
	// withCredentials
	// =========================================================================
	describe('withCredentials', () => {
		it('fetches api_key and token then calls withTrelloCredentials', async () => {
			mockGetIntegrationCredential.mockResolvedValueOnce('my-api-key');
			mockGetIntegrationCredential.mockResolvedValueOnce('my-token');

			const fn = vi.fn().mockResolvedValue('result');
			const result = await integration.withCredentials('proj-1', fn);

			expect(mockGetIntegrationCredential).toHaveBeenCalledWith('proj-1', 'pm', 'api_key');
			expect(mockGetIntegrationCredential).toHaveBeenCalledWith('proj-1', 'pm', 'token');
			expect(mockWithTrelloCredentials).toHaveBeenCalledWith(
				{ apiKey: 'my-api-key', token: 'my-token' },
				fn,
			);
			expect(result).toBe('result');
		});
	});

	// =========================================================================
	// resolveLifecycleConfig
	// =========================================================================
	describe('resolveLifecycleConfig', () => {
		it('maps trello labels and lists to lifecycle config', () => {
			const project = makeProject();
			const config = integration.resolveLifecycleConfig(project);

			expect(config.labels.processing).toBe('label-processing');
			expect(config.labels.processed).toBe('label-processed');
			expect(config.labels.error).toBe('label-error');
			expect(config.labels.readyToProcess).toBe('label-ready');
			expect(config.labels.auto).toBe('label-auto');
			expect(config.statuses.backlog).toBe('list-backlog');
			expect(config.statuses.inProgress).toBe('list-in-progress');
			expect(config.statuses.inReview).toBe('list-in-review');
			expect(config.statuses.done).toBe('list-done');
			expect(config.statuses.merged).toBe('list-merged');
		});
	});

	// =========================================================================
	// parseWebhookPayload
	// =========================================================================
	describe('parseWebhookPayload', () => {
		it('returns null when payload is null', () => {
			expect(integration.parseWebhookPayload(null)).toBeNull();
		});

		it('returns null when payload is not an object', () => {
			expect(integration.parseWebhookPayload('string')).toBeNull();
		});

		it('returns null when action or model is missing', () => {
			expect(integration.parseWebhookPayload({ action: {} })).toBeNull();
			expect(integration.parseWebhookPayload({ model: {} })).toBeNull();
		});

		it('parses a typical updateCard webhook payload', () => {
			const raw = {
				action: {
					type: 'updateCard',
					data: { card: { id: 'card-abc' } },
				},
				model: { id: 'board-123' },
			};

			const result = integration.parseWebhookPayload(raw);

			expect(result).not.toBeNull();
			expect(result?.eventType).toBe('updateCard');
			expect(result?.projectIdentifier).toBe('board-123');
			expect(result?.workItemId).toBe('card-abc');
			expect(result?.raw).toBe(raw);
		});

		it('returns undefined workItemId when no card in data', () => {
			const raw = {
				action: { type: 'createList', data: {} },
				model: { id: 'board-123' },
			};

			const result = integration.parseWebhookPayload(raw);
			expect(result?.workItemId).toBeUndefined();
		});
	});

	// =========================================================================
	// isSelfAuthored
	// =========================================================================
	describe('isSelfAuthored', () => {
		it('returns false when action has no idMemberCreator', async () => {
			const event = {
				eventType: 'commentCard',
				projectIdentifier: 'board-123',
				raw: { action: {} },
			};
			const result = await integration.isSelfAuthored(event, 'proj-1');
			expect(result).toBe(false);
		});

		it('returns true when author matches bot ID', async () => {
			mockResolveTrelloBotMemberId.mockResolvedValue('bot-member-id');
			const event = {
				eventType: 'commentCard',
				projectIdentifier: 'board-123',
				raw: { action: { idMemberCreator: 'bot-member-id' } },
			};
			const result = await integration.isSelfAuthored(event, 'proj-1');
			expect(result).toBe(true);
		});

		it('returns false when author does not match bot ID', async () => {
			mockResolveTrelloBotMemberId.mockResolvedValue('bot-member-id');
			const event = {
				eventType: 'commentCard',
				projectIdentifier: 'board-123',
				raw: { action: { idMemberCreator: 'human-member-id' } },
			};
			const result = await integration.isSelfAuthored(event, 'proj-1');
			expect(result).toBe(false);
		});

		it('returns false when resolveTrelloBotMemberId throws', async () => {
			mockResolveTrelloBotMemberId.mockRejectedValue(new Error('network error'));
			const event = {
				eventType: 'commentCard',
				projectIdentifier: 'board-123',
				raw: { action: { idMemberCreator: 'some-member-id' } },
			};
			const result = await integration.isSelfAuthored(event, 'proj-1');
			expect(result).toBe(false);
		});
	});

	// =========================================================================
	// postAckComment
	// =========================================================================
	describe('postAckComment', () => {
		it('delegates to postTrelloAck and returns its result', async () => {
			mockPostTrelloAck.mockResolvedValue('comment-id-123');
			const result = await integration.postAckComment('proj-1', 'card-1', 'Working on it...');
			expect(mockPostTrelloAck).toHaveBeenCalledWith('proj-1', 'card-1', 'Working on it...');
			expect(result).toBe('comment-id-123');
		});
	});

	// =========================================================================
	// deleteAckComment
	// =========================================================================
	describe('deleteAckComment', () => {
		it('delegates to deleteTrelloAck', async () => {
			mockDeleteTrelloAck.mockResolvedValue(undefined);
			await integration.deleteAckComment('proj-1', 'card-1', 'action-123');
			expect(mockDeleteTrelloAck).toHaveBeenCalledWith('proj-1', 'card-1', 'action-123');
		});
	});

	// =========================================================================
	// sendReaction
	// =========================================================================
	describe('sendReaction', () => {
		it('calls sendAcknowledgeReaction with trello provider and raw payload', async () => {
			const rawPayload = { action: { type: 'commentCard' } };
			const event = {
				eventType: 'commentCard',
				projectIdentifier: 'board-123',
				raw: rawPayload,
			};
			mockSendAcknowledgeReaction.mockResolvedValue(undefined);

			await integration.sendReaction('proj-1', event);

			expect(mockSendAcknowledgeReaction).toHaveBeenCalledWith('trello', 'proj-1', rawPayload);
		});
	});

	// =========================================================================
	// lookupProject
	// =========================================================================
	describe('lookupProject', () => {
		it('returns project config when found by board ID', async () => {
			const mockResult = {
				project: makeProject(),
				config: { projects: [] },
			};
			mockLoadProjectConfigByBoardId.mockResolvedValue(mockResult);

			const result = await integration.lookupProject('board-123');

			expect(mockLoadProjectConfigByBoardId).toHaveBeenCalledWith('board-123');
			expect(result).toBe(mockResult);
		});

		it('returns null when no project found', async () => {
			mockLoadProjectConfigByBoardId.mockResolvedValue(null);
			const result = await integration.lookupProject('unknown-board');
			expect(result).toBeNull();
		});
	});

	// =========================================================================
	// extractWorkItemId
	// =========================================================================
	describe('extractWorkItemId', () => {
		it('extracts card ID from a trello.com URL', () => {
			const result = integration.extractWorkItemId(
				'See this card: https://trello.com/c/abc123/card-name',
			);
			expect(result).toBe('abc123');
		});

		it('extracts card ID with only short URL', () => {
			const result = integration.extractWorkItemId('https://trello.com/c/XYZ789');
			expect(result).toBe('XYZ789');
		});

		it('returns null when no trello URL present', () => {
			const result = integration.extractWorkItemId('No link here, just text.');
			expect(result).toBeNull();
		});

		it('returns null for unrelated URLs', () => {
			const result = integration.extractWorkItemId('https://github.com/owner/repo/pull/42');
			expect(result).toBeNull();
		});
	});
});
