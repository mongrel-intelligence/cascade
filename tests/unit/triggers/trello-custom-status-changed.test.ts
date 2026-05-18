import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const { mockGetCustomWorkflowStatusDefinition } = vi.hoisted(() => ({
	mockGetCustomWorkflowStatusDefinition: vi.fn(),
}));

vi.mock('../../../src/db/repositories/workflowStatusDefinitionsRepository.js', () => ({
	getCustomWorkflowStatusDefinition: mockGetCustomWorkflowStatusDefinition,
	listCustomWorkflowStatusDefinitions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));

vi.mock('../../../src/triggers/config-resolver.js', () => mockConfigResolverModule);
vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

// Spec 017 / plan 2: the capacity gate is now fail-closed when no
// PM-provider AsyncLocalStorage scope is in effect (the case in these
// unit tests). Mock as passthrough so trigger-logic assertions still run.
vi.mock('../../../src/triggers/shared/pipeline-capacity-gate.js', () => ({
	shouldBlockForPipelineCapacity: vi.fn().mockResolvedValue(false),
}));

// Mocks required for PM integration registration (pm/index.js side-effect)
vi.mock('../../../src/config/provider.js', () => mockConfigProvider);
vi.mock('../../../src/trello/client.js', () => mockTrelloClientModule);
vi.mock('../../../src/jira/client.js', () => mockJiraClientModule);
vi.mock('../../../src/router/acknowledgments.js', () => mockAcknowledgmentsModule);
vi.mock('../../../src/router/reactions.js', () => mockReactionsModule);

// Register PM integrations in the registry
import '../../../src/pm/index.js';

import { checkTriggerEnabledWithParams } from '../../../src/triggers/shared/trigger-check.js';
import { TrelloCustomStatusChangedTrigger } from '../../../src/triggers/trello/status-changed.js';
import type { TriggerContext } from '../../../src/triggers/types.js';
import { createMockProject, createTrelloActionPayload } from '../../helpers/factories.js';

/** Default mock: enabled, onCreate=true onMove=true (matches Trello's backfilled state). */
function mockTriggerConfig(
	enabled: boolean,
	parameters: Record<string, unknown> = { onCreate: true, onMove: true },
) {
	vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({ enabled, parameters });
}

// Project with both built-in and custom mapped lists. The custom 'prd' and
// 'ux' keys map to non-built-in workflow status definitions.
const customProject = createMockProject({
	trello: {
		boardId: 'board123',
		lists: {
			splitting: 'splitting-list-id',
			planning: 'planning-list-id',
			todo: 'todo-list-id',
			backlog: 'backlog-list-id',
			merged: 'merged-list-id',
			prd: 'prd-list-id',
			ux: 'ux-list-id',
		},
		labels: {},
	},
});

function movePayload(targetListId: string, fromListId = 'other-list-id') {
	return createTrelloActionPayload({
		action: {
			id: 'action1',
			idMemberCreator: 'member1',
			type: 'updateCard',
			date: '2024-01-01',
			data: {
				card: { id: 'card789', name: 'Custom Card', idShort: 1, shortLink: 'xyz' },
				listBefore: { id: fromListId, name: 'From' },
				listAfter: { id: targetListId, name: 'To' },
			},
		},
	});
}

function createPayload(targetListId: string) {
	return createTrelloActionPayload({
		action: {
			id: 'action1',
			idMemberCreator: 'member1',
			type: 'createCard',
			date: '2024-01-01',
			data: {
				card: { id: 'card789', name: 'Custom Card', idShort: 1, shortLink: 'xyz' },
				list: { id: targetListId, name: 'To' },
			},
		},
	});
}

describe('TrelloCustomStatusChangedTrigger', () => {
	const trigger = new TrelloCustomStatusChangedTrigger();

	beforeEach(() => {
		mockGetCustomWorkflowStatusDefinition.mockReset();
		mockGetCustomWorkflowStatusDefinition.mockResolvedValue(null);
		mockTriggerConfig(true);
	});

	describe('matches', () => {
		it('matches when card moved to a list mapped under a custom workflow status key', () => {
			const ctx: TriggerContext = {
				project: customProject,
				source: 'trello',
				payload: movePayload('prd-list-id'),
			};
			expect(trigger.matches(ctx)).toBe(true);
		});

		it('matches when card created directly in a custom-mapped list', () => {
			const ctx: TriggerContext = {
				project: customProject,
				source: 'trello',
				payload: createPayload('ux-list-id'),
			};
			expect(trigger.matches(ctx)).toBe(true);
		});

		it('does not match destination lists mapped under built-in status keys (handled by built-in triggers)', () => {
			for (const builtInListId of [
				'splitting-list-id',
				'planning-list-id',
				'todo-list-id',
				'backlog-list-id',
				'merged-list-id',
			]) {
				const ctx: TriggerContext = {
					project: customProject,
					source: 'trello',
					payload: movePayload(builtInListId),
				};
				expect(trigger.matches(ctx)).toBe(false);
			}
		});

		it('does not match when destination list is not in the project config', () => {
			const ctx: TriggerContext = {
				project: customProject,
				source: 'trello',
				payload: movePayload('some-other-list-id'),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match when the move is a no-op (same list before and after)', () => {
			const ctx: TriggerContext = {
				project: customProject,
				source: 'trello',
				payload: movePayload('prd-list-id', 'prd-list-id'),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match non-trello source', () => {
			const ctx: TriggerContext = {
				project: customProject,
				source: 'github',
				payload: {},
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match unrelated trello action types (e.g. addLabelToCard)', () => {
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
							card: { id: 'card789', name: 'Custom Card', idShort: 1, shortLink: 'xyz' },
							label: { id: 'label-1', name: 'Label', color: 'blue' },
						},
					},
				}),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match when trello config has no lists', () => {
			const noListsProject = createMockProject({
				trello: { boardId: 'board123', lists: {}, labels: {} },
			});
			const ctx: TriggerContext = {
				project: noListsProject,
				source: 'trello',
				payload: movePayload('prd-list-id'),
			};
			expect(trigger.matches(ctx)).toBe(false);
		});
	});

	describe('handle — custom mapped status dispatch', () => {
		it('dispatches a custom agent when the destination list maps to a custom workflow status', async () => {
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

			const ctx: TriggerContext = {
				project: customProject,
				source: 'trello',
				payload: movePayload('prd-list-id'),
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('prd');
			expect(result?.workItemId).toBe('card789');
			expect(result?.agentInput.workItemId).toBe('card789');
			expect(result?.workItemUrl).toBe('https://trello.com/c/xyz');
			expect(result?.workItemTitle).toBe('Custom Card');
			expect(result?.agentInput.triggerEvent).toBe('pm:status-changed');
			expect(result?.coalesceKey).toBe('test:card789');
		});

		it('dispatches a custom agent on create when onCreate is enabled', async () => {
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
			mockTriggerConfig(true, { onCreate: true, onMove: true });

			const ctx: TriggerContext = {
				project: customProject,
				source: 'trello',
				payload: createPayload('prd-list-id'),
			};

			const result = await trigger.handle(ctx);
			expect(result?.agentType).toBe('prd');
		});

		it('calls checkTriggerEnabledWithParams with the resolved custom agent type', async () => {
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

			const ctx: TriggerContext = {
				project: customProject,
				source: 'trello',
				payload: movePayload('prd-list-id'),
			};

			await trigger.handle(ctx);

			expect(checkTriggerEnabledWithParams).toHaveBeenCalledWith(
				'test',
				'prd',
				'pm:status-changed',
				'trello-status-changed-custom',
			);
		});
	});

	describe('handle — no-agent / no-match behavior', () => {
		it('returns null when the custom status has no dispatch agent configured', async () => {
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

			const ctx: TriggerContext = {
				project: customProject,
				source: 'trello',
				payload: movePayload('ux-list-id'),
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when the custom status is missing from workflow definitions table', async () => {
			mockGetCustomWorkflowStatusDefinition.mockResolvedValue(null);

			const ctx: TriggerContext = {
				project: customProject,
				source: 'trello',
				payload: movePayload('prd-list-id'),
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
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
			mockTriggerConfig(false);

			const ctx: TriggerContext = {
				project: customProject,
				source: 'trello',
				payload: movePayload('prd-list-id'),
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when card ID is missing', async () => {
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

			const ctx: TriggerContext = {
				project: customProject,
				source: 'trello',
				payload: createTrelloActionPayload({
					action: {
						id: 'action1',
						idMemberCreator: 'member1',
						type: 'updateCard',
						date: '2024-01-01',
						data: {
							listBefore: { id: 'other-list-id', name: 'From' },
							listAfter: { id: 'prd-list-id', name: 'To' },
						},
					},
				}),
			};

			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});
	});

	describe('handle — onCreate / onMove gating', () => {
		beforeEach(() => {
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
		});

		it('does NOT fire on create when onCreate=false', async () => {
			mockTriggerConfig(true, { onCreate: false, onMove: true });
			const ctx: TriggerContext = {
				project: customProject,
				source: 'trello',
				payload: createPayload('prd-list-id'),
			};
			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('does NOT fire on move when onMove=false', async () => {
			mockTriggerConfig(true, { onCreate: true, onMove: false });
			const ctx: TriggerContext = {
				project: customProject,
				source: 'trello',
				payload: movePayload('prd-list-id'),
			};
			expect(await trigger.handle(ctx)).toBeNull();
		});

		it('fires only on create when onCreate=true and onMove=false', async () => {
			mockTriggerConfig(true, { onCreate: true, onMove: false });
			const createCtx: TriggerContext = {
				project: customProject,
				source: 'trello',
				payload: createPayload('prd-list-id'),
			};
			expect((await trigger.handle(createCtx))?.agentType).toBe('prd');

			mockTriggerConfig(true, { onCreate: true, onMove: false });
			const moveCtx: TriggerContext = {
				project: customProject,
				source: 'trello',
				payload: movePayload('prd-list-id'),
			};
			expect(await trigger.handle(moveCtx)).toBeNull();
		});
	});
});
