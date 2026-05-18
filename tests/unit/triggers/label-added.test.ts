import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	mockAcknowledgmentsModule,
	mockConfigProvider,
	mockConfigResolverModule,
	mockJiraClientModule,
	mockReactionsModule,
	mockTrelloClientModule,
	mockTriggerCheckModule,
} from '../../helpers/sharedMocks.js';

const { mockGetCustomWorkflowStatusDefinition } = vi.hoisted(() => ({
	mockGetCustomWorkflowStatusDefinition: vi.fn(),
}));

vi.mock('../../../src/db/repositories/workflowStatusDefinitionsRepository.js', () => ({
	getCustomWorkflowStatusDefinition: mockGetCustomWorkflowStatusDefinition,
	listCustomWorkflowStatusDefinitions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/triggers/config-resolver.js', () => mockConfigResolverModule);
vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

import type { TriggerContext } from '../../../src/triggers/types.js';

// Mocks required for PM integration registration (pm/index.js side-effect)
vi.mock('../../../src/config/provider.js', () => mockConfigProvider);
vi.mock('../../../src/trello/client.js', () => mockTrelloClientModule);
vi.mock('../../../src/jira/client.js', () => mockJiraClientModule);
vi.mock('../../../src/router/acknowledgments.js', () => mockAcknowledgmentsModule);
vi.mock('../../../src/router/reactions.js', () => mockReactionsModule);

// Register PM integrations in the registry
import '../../../src/pm/index.js';

import { trelloClient } from '../../../src/trello/client.js';
import { checkTriggerEnabled } from '../../../src/triggers/shared/trigger-check.js';
import { ReadyToProcessLabelTrigger } from '../../../src/triggers/trello/label-added.js';
import {
	createMockProject,
	createTrelloActionPayload,
	createTrelloCard,
} from '../../helpers/factories.js';

describe('ReadyToProcessLabelTrigger', () => {
	const trigger = new ReadyToProcessLabelTrigger();
	const mockGetCard = vi.mocked(trelloClient.getCard);

	beforeEach(() => {
		mockGetCustomWorkflowStatusDefinition.mockReset();
		mockGetCustomWorkflowStatusDefinition.mockResolvedValue(null);
	});

	const mockProject = createMockProject({
		trello: {
			boardId: 'board123',
			lists: {
				splitting: 'splitting-list-id',
				planning: 'planning-list-id',
				todo: 'todo-list-id',
			},
			labels: {
				readyToProcess: 'ready-label-id',
			},
		},
	});

	describe('matches', () => {
		it('matches when ready-to-process label is added', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: createTrelloActionPayload({
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card1', name: 'Test Card', idShort: 1, shortLink: 'abc' },
							label: { id: 'ready-label-id', name: 'Ready', color: 'green' },
						},
					},
				}),
			};

			expect(trigger.matches(ctx)).toBe(true);
		});

		it('does not match when different label is added', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: createTrelloActionPayload({
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card1', name: 'Test Card', idShort: 1, shortLink: 'abc' },
							label: { id: 'other-label-id', name: 'Other', color: 'red' },
						},
					},
				}),
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match for non-addLabelToCard action', () => {
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
						},
					},
				}),
			};

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
	});

	describe('handle', () => {
		it('should return null when trigger is disabled for the resolved agent', async () => {
			vi.mocked(checkTriggerEnabled).mockResolvedValueOnce(false);
			mockGetCard.mockResolvedValue(
				createTrelloCard({ id: 'card123', idList: 'splitting-list-id' }),
			);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: createTrelloActionPayload({
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card123', name: 'Test Card', idShort: 1, shortLink: 'abc' },
							label: { id: 'ready-label-id', name: 'Ready', color: 'green' },
						},
					},
				}),
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
			expect(checkTriggerEnabled).toHaveBeenCalledWith(
				'test',
				'splitting',
				'pm:label-added',
				'ready-to-process-label-added',
			);
		});

		it('returns splitting agent when card is in splitting list', async () => {
			mockGetCard.mockResolvedValue(
				createTrelloCard({ id: 'card123', idList: 'splitting-list-id' }),
			);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: createTrelloActionPayload({
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card123', name: 'Test Card', idShort: 1, shortLink: 'abc' },
							label: { id: 'ready-label-id', name: 'Ready', color: 'green' },
						},
					},
				}),
			};

			const result = await trigger.handle(ctx);

			expect(result.agentType).toBe('splitting');
			expect(result.workItemId).toBe('card123');
			expect(mockGetCard).toHaveBeenCalledWith('card123');
			expect(result.agentInput.triggerEvent).toBe('pm:label-added');
		});

		it('populates workItemUrl and workItemTitle from fetched card data', async () => {
			mockGetCard.mockResolvedValue(
				createTrelloCard({
					id: 'card123',
					name: 'My Feature Card',
					url: 'https://trello.com/c/xyz123/my-feature-card',
					shortUrl: 'https://trello.com/c/xyz123',
					idList: 'splitting-list-id',
				}),
			);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: createTrelloActionPayload({
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card123', name: 'My Feature Card', idShort: 1, shortLink: 'xyz123' },
							label: { id: 'ready-label-id', name: 'Ready', color: 'green' },
						},
					},
				}),
			};

			const result = await trigger.handle(ctx);

			expect(result.workItemUrl).toBe('https://trello.com/c/xyz123');
			expect(result.workItemTitle).toBe('My Feature Card');
			expect(result.agentInput.workItemUrl).toBe('https://trello.com/c/xyz123');
			expect(result.agentInput.workItemTitle).toBe('My Feature Card');
		});

		it('returns planning agent when card is in planning list', async () => {
			mockGetCard.mockResolvedValue(
				createTrelloCard({ id: 'card456', name: 'Planning Card', idList: 'planning-list-id' }),
			);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: createTrelloActionPayload({
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card456', name: 'Planning Card', idShort: 2, shortLink: 'def' },
							label: { id: 'ready-label-id', name: 'Ready', color: 'green' },
						},
					},
				}),
			};

			const result = await trigger.handle(ctx);

			expect(result.agentType).toBe('planning');
			expect(result.workItemId).toBe('card456');
		});

		it('returns implementation agent when card is in todo list', async () => {
			mockGetCard.mockResolvedValue(
				createTrelloCard({ id: 'card789', name: 'Todo Card', idList: 'todo-list-id' }),
			);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: createTrelloActionPayload({
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card789', name: 'Todo Card', idShort: 3, shortLink: 'ghi' },
							label: { id: 'ready-label-id', name: 'Ready', color: 'green' },
						},
					},
				}),
			};

			const result = await trigger.handle(ctx);

			expect(result.agentType).toBe('implementation');
			expect(result.workItemId).toBe('card789');
		});

		it('returns null when card is in an unrecognized list (e.g. IN PROGRESS)', async () => {
			mockGetCard.mockResolvedValue(
				createTrelloCard({ id: 'card999', idList: 'in-progress-list-id' }),
			);

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: createTrelloActionPayload({
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card999', name: 'Unknown List Card', idShort: 4, shortLink: 'xyz' },
							label: { id: 'ready-label-id', name: 'Ready', color: 'green' },
						},
					},
				}),
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('returns null when card ID is missing', async () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: createTrelloActionPayload({
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							label: { id: 'ready-label-id', name: 'Ready', color: 'green' },
						},
					},
				}),
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});
	});

	describe('custom workflow status mapping', () => {
		const customProject = createMockProject({
			trello: {
				boardId: 'board123',
				lists: {
					splitting: 'splitting-list-id',
					planning: 'planning-list-id',
					todo: 'todo-list-id',
					prd: 'prd-list-id',
					ux: 'ux-list-id',
				},
				labels: {
					readyToProcess: 'ready-label-id',
				},
			},
		});

		it('dispatches a custom agent when the card is in a list mapped to a custom workflow status', async () => {
			mockGetCustomWorkflowStatusDefinition.mockImplementation(async (key: string) => {
				if (key === 'prd') {
					return {
						id: 1,
						key: 'prd',
						label: 'PRD',
						agentType: 'prd',
						sortOrder: 1000,
						createdAt: null,
						updatedAt: null,
					};
				}
				return null;
			});

			mockGetCard.mockResolvedValue(
				createTrelloCard({
					id: 'card-custom',
					name: 'Custom Card',
					url: 'https://trello.com/c/abc/custom-card',
					shortUrl: 'https://trello.com/c/abc',
					idList: 'prd-list-id',
				}),
			);

			const ctx: TriggerContext = {
				project: customProject,
				source: 'trello',
				payload: createTrelloActionPayload({
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card-custom', name: 'Custom Card', idShort: 99, shortLink: 'abc' },
							label: { id: 'ready-label-id', name: 'Ready', color: 'green' },
						},
					},
				}),
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('prd');
			expect(result?.workItemId).toBe('card-custom');
			expect(result?.workItemUrl).toBe('https://trello.com/c/abc');
			expect(result?.workItemTitle).toBe('Custom Card');
			expect(result?.agentInput.triggerEvent).toBe('pm:label-added');
		});

		it('returns null when a custom mapped status has no dispatch agent configured', async () => {
			mockGetCustomWorkflowStatusDefinition.mockImplementation(async (key: string) => {
				if (key === 'ux') {
					return {
						id: 2,
						key: 'ux',
						label: 'UX',
						agentType: null,
						sortOrder: 2000,
						createdAt: null,
						updatedAt: null,
					};
				}
				return null;
			});

			mockGetCard.mockResolvedValue(createTrelloCard({ id: 'card-ux', idList: 'ux-list-id' }));

			const ctx: TriggerContext = {
				project: customProject,
				source: 'trello',
				payload: createTrelloActionPayload({
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card-ux', name: 'UX Card', idShort: 100, shortLink: 'uxx' },
							label: { id: 'ready-label-id', name: 'Ready', color: 'green' },
						},
					},
				}),
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when a custom mapped status is missing from workflow definitions', async () => {
			mockGetCustomWorkflowStatusDefinition.mockResolvedValue(null);

			mockGetCard.mockResolvedValue(createTrelloCard({ id: 'card-prd', idList: 'prd-list-id' }));

			const ctx: TriggerContext = {
				project: customProject,
				source: 'trello',
				payload: createTrelloActionPayload({
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card-prd', name: 'PRD Card', idShort: 101, shortLink: 'prdx' },
							label: { id: 'ready-label-id', name: 'Ready', color: 'green' },
						},
					},
				}),
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('checks trigger enablement for the resolved custom agent', async () => {
			mockGetCustomWorkflowStatusDefinition.mockImplementation(async (key: string) => {
				if (key === 'prd') {
					return {
						id: 1,
						key: 'prd',
						label: 'PRD',
						agentType: 'prd',
						sortOrder: 1000,
						createdAt: null,
						updatedAt: null,
					};
				}
				return null;
			});

			mockGetCard.mockResolvedValue(createTrelloCard({ id: 'card-custom', idList: 'prd-list-id' }));

			const ctx: TriggerContext = {
				project: customProject,
				source: 'trello',
				payload: createTrelloActionPayload({
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card-custom', name: 'Custom Card', idShort: 99, shortLink: 'abc' },
							label: { id: 'ready-label-id', name: 'Ready', color: 'green' },
						},
					},
				}),
			};

			await trigger.handle(ctx);

			expect(checkTriggerEnabled).toHaveBeenCalledWith(
				'test',
				'prd',
				'pm:label-added',
				'ready-to-process-label-added',
			);
		});

		it('returns null when the trigger is disabled for the resolved custom agent', async () => {
			mockGetCustomWorkflowStatusDefinition.mockImplementation(async (key: string) => {
				if (key === 'prd') {
					return {
						id: 1,
						key: 'prd',
						label: 'PRD',
						agentType: 'prd',
						sortOrder: 1000,
						createdAt: null,
						updatedAt: null,
					};
				}
				return null;
			});
			vi.mocked(checkTriggerEnabled).mockResolvedValueOnce(false);

			mockGetCard.mockResolvedValue(createTrelloCard({ id: 'card-custom', idList: 'prd-list-id' }));

			const ctx: TriggerContext = {
				project: customProject,
				source: 'trello',
				payload: createTrelloActionPayload({
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'addLabelToCard',
						date: '2024-01-01',
						data: {
							card: { id: 'card-custom', name: 'Custom Card', idShort: 99, shortLink: 'abc' },
							label: { id: 'ready-label-id', name: 'Ready', color: 'green' },
						},
					},
				}),
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});
	});
});
