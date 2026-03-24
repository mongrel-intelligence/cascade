import { describe, expect, it, vi } from 'vitest';
import {
	mockAcknowledgmentsModule,
	mockConfigProvider,
	mockConfigResolverModule,
	mockJiraClientModule,
	mockLogger,
	mockReactionsModule,
	mockTrelloClientModule,
	mockTriggerCheckModule,
} from '../../helpers/sharedMocks.js';

vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));

vi.mock('../../../src/triggers/config-resolver.js', () => mockConfigResolverModule);
vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

// Mocks required for PM integration registration (pm/index.js side-effect)
vi.mock('../../../src/config/provider.js', () => mockConfigProvider);
vi.mock('../../../src/trello/client.js', () => mockTrelloClientModule);
vi.mock('../../../src/jira/client.js', () => mockJiraClientModule);
vi.mock('../../../src/router/acknowledgments.js', () => mockAcknowledgmentsModule);
vi.mock('../../../src/router/reactions.js', () => mockReactionsModule);

// Mock the snapshot manager so we can verify invalidation calls
const mockInvalidateSnapshot = vi.fn();
vi.mock('../../../src/router/snapshot-manager.js', () => ({
	invalidateSnapshot: (...args: unknown[]) => mockInvalidateSnapshot(...args),
}));

// Register PM integrations in the registry
import '../../../src/pm/index.js';

import { checkTriggerEnabled } from '../../../src/triggers/shared/trigger-check.js';
import { TrelloStatusChangedMergedTrigger } from '../../../src/triggers/trello/status-changed.js';
import type { TriggerContext } from '../../../src/triggers/types.js';
import { createMockProject, createTrelloActionPayload } from '../../helpers/factories.js';

describe('TrelloStatusChangedMergedTrigger', () => {
	const trigger = TrelloStatusChangedMergedTrigger;

	const mockProject = createMockProject({
		trello: {
			boardId: 'board123',
			lists: {
				splitting: 'splitting-list-id',
				planning: 'planning-list-id',
				todo: 'todo-list-id',
				backlog: 'backlog-list-id',
				merged: 'merged-list-id',
			},
			labels: {},
		},
	});

	it('matches when card moved to merged list', () => {
		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createTrelloActionPayload({
				action: {
					id: 'action1',
					idMemberCreator: 'member1',
					type: 'updateCard',
					date: '2024-01-01',
					data: {
						card: { id: 'card1', name: 'Test Card', idShort: 1, shortLink: 'abc' },
						listBefore: { id: 'in-review-list', name: 'In Review' },
						listAfter: { id: 'merged-list-id', name: 'Merged' },
					},
				},
			}),
		};

		expect(trigger.matches(ctx)).toBe(true);
	});

	it('does not match when card moved from merged to merged', () => {
		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createTrelloActionPayload({
				action: {
					id: 'action1',
					idMemberCreator: 'member1',
					type: 'updateCard',
					date: '2024-01-01',
					data: {
						card: { id: 'card1', name: 'Test Card', idShort: 1, shortLink: 'abc' },
						listBefore: { id: 'merged-list-id', name: 'Merged' },
						listAfter: { id: 'merged-list-id', name: 'Merged' },
					},
				},
			}),
		};

		expect(trigger.matches(ctx)).toBe(false);
	});

	it('matches when card created directly in merged list', () => {
		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createTrelloActionPayload({
				action: {
					id: 'action1',
					idMemberCreator: 'member1',
					type: 'createCard',
					date: '2024-01-01',
					data: {
						card: { id: 'card1', name: 'Test Card', idShort: 1, shortLink: 'abc' },
						list: { id: 'merged-list-id', name: 'Merged' },
					},
				},
			}),
		};

		expect(trigger.matches(ctx)).toBe(true);
	});

	it('does not match when card moved to a different list', () => {
		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createTrelloActionPayload({
				action: {
					id: 'action1',
					idMemberCreator: 'member1',
					type: 'updateCard',
					date: '2024-01-01',
					data: {
						card: { id: 'card1', name: 'Test Card', idShort: 1, shortLink: 'abc' },
						listBefore: { id: 'other-list', name: 'Other' },
						listAfter: { id: 'todo-list-id', name: 'TODO' },
					},
				},
			}),
		};

		expect(trigger.matches(ctx)).toBe(false);
	});

	it('does not match when merged list is not configured', () => {
		const projectWithoutMerged = createMockProject();
		const ctx: TriggerContext = {
			project: projectWithoutMerged,
			source: 'trello',
			payload: createTrelloActionPayload({
				action: {
					id: 'action1',
					idMemberCreator: 'member1',
					type: 'updateCard',
					date: '2024-01-01',
					data: {
						card: { id: 'card1', name: 'Test Card', idShort: 1, shortLink: 'abc' },
						listBefore: { id: 'other-list', name: 'Other' },
						listAfter: { id: 'merged-list-id', name: 'Merged' },
					},
				},
			}),
		};

		// merged list not configured, so targetListId is undefined — won't match
		expect(trigger.matches(ctx)).toBe(false);
	});

	it('does not match github source', () => {
		const ctx: TriggerContext = {
			project: mockProject,
			source: 'github',
			payload: {},
		};

		expect(trigger.matches(ctx)).toBe(false);
	});

	it('handles and returns backlog-manager agent with pm:status-changed event', async () => {
		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createTrelloActionPayload({
				action: {
					id: 'action1',
					idMemberCreator: 'member1',
					type: 'updateCard',
					date: '2024-01-01',
					data: {
						card: { id: 'card789', name: 'Resolved Dependency', idShort: 1, shortLink: 'abc' },
						listBefore: { id: 'in-review-list', name: 'In Review' },
						listAfter: { id: 'merged-list-id', name: 'Merged' },
					},
				},
			}),
		};

		const result = await trigger.handle(ctx);

		expect(result?.agentType).toBe('backlog-manager');
		expect(result?.workItemId).toBe('card789');
		expect(result?.agentInput.workItemId).toBe('card789');
		expect(result?.agentInput.triggerEvent).toBe('pm:status-changed');
	});

	it('returns null when trigger is disabled', async () => {
		vi.mocked(checkTriggerEnabled).mockResolvedValueOnce(false);

		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createTrelloActionPayload({
				action: {
					id: 'action1',
					idMemberCreator: 'member1',
					type: 'updateCard',
					date: '2024-01-01',
					data: {
						card: { id: 'card1', name: 'Test Card', idShort: 1, shortLink: 'abc' },
						listBefore: { id: 'in-review-list', name: 'In Review' },
						listAfter: { id: 'merged-list-id', name: 'Merged' },
					},
				},
			}),
		};

		const result = await trigger.handle(ctx);
		expect(result).toBeNull();
		expect(checkTriggerEnabled).toHaveBeenCalledWith(
			mockProject.id,
			'backlog-manager',
			'pm:status-changed',
			'trello-status-changed-merged',
		);
	});

	it('returns null when card ID is missing from payload', async () => {
		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createTrelloActionPayload({
				action: {
					id: 'action1',
					idMemberCreator: 'member1',
					type: 'updateCard',
					date: '2024-01-01',
					data: {
						// No card field
						listBefore: { id: 'other-list', name: 'Other' },
						listAfter: { id: 'merged-list-id', name: 'Merged' },
					},
				},
			}),
		};

		const result = await trigger.handle(ctx);
		expect(result).toBeNull();
	});

	it('invalidates snapshot when card is moved to merged list', async () => {
		mockInvalidateSnapshot.mockClear();

		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createTrelloActionPayload({
				action: {
					id: 'action1',
					idMemberCreator: 'member1',
					type: 'updateCard',
					date: '2024-01-01',
					data: {
						card: { id: 'card789', name: 'Resolved Dependency', idShort: 1, shortLink: 'abc' },
						listBefore: { id: 'in-review-list', name: 'In Review' },
						listAfter: { id: 'merged-list-id', name: 'Merged' },
					},
				},
			}),
		};

		await trigger.handle(ctx);

		expect(mockInvalidateSnapshot).toHaveBeenCalledWith(mockProject.id, 'card789');
	});

	it('does not invalidate snapshot when trigger is disabled (returns null before invalidation)', async () => {
		mockInvalidateSnapshot.mockClear();
		vi.mocked(checkTriggerEnabled).mockResolvedValueOnce(false);

		const ctx: TriggerContext = {
			project: mockProject,
			source: 'trello',
			payload: createTrelloActionPayload({
				action: {
					id: 'action1',
					idMemberCreator: 'member1',
					type: 'updateCard',
					date: '2024-01-01',
					data: {
						card: { id: 'card789', name: 'Test Card', idShort: 1, shortLink: 'abc' },
						listBefore: { id: 'in-review-list', name: 'In Review' },
						listAfter: { id: 'merged-list-id', name: 'Merged' },
					},
				},
			}),
		};

		const result = await trigger.handle(ctx);

		// Trigger returned null (disabled) — but snapshot is still invalidated since
		// the card truly moved to merged regardless of agent configuration
		expect(result).toBeNull();
		// invalidateSnapshot is NOT called when trigger is disabled (returns early)
		expect(mockInvalidateSnapshot).not.toHaveBeenCalled();
	});
});
