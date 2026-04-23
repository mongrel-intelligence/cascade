import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockGetTrelloConfig, mockGetJiraConfig, mockGetLinearConfig, mockLogger } = vi.hoisted(
	() => ({
		mockGetTrelloConfig: vi.fn(),
		mockGetJiraConfig: vi.fn(),
		mockGetLinearConfig: vi.fn(),
		mockLogger: {
			info: vi.fn(),
			warn: vi.fn(),
			debug: vi.fn(),
			error: vi.fn(),
		},
	}),
);

vi.mock('../../../../src/pm/config.js', () => ({
	getTrelloConfig: mockGetTrelloConfig,
	getJiraConfig: mockGetJiraConfig,
	getLinearConfig: mockGetLinearConfig,
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

import { isPipelineAtCapacity } from '../../../../src/triggers/shared/backlog-check.js';
import {
	createMockJiraProject,
	createMockLinearProject,
	createMockProject,
} from '../../../helpers/factories.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock PMProvider whose `listWorkItems(undefined, { status: <key> })`
 * resolves to `itemsByStatus[key]`. Keys MUST be CASCADE-canonical statuses
 * (`'backlog'`, `'todo'`, `'inProgress'`, `'inReview'`) — same shape that
 * `isPipelineAtCapacity` and the snapshot loader use.
 */
function makeProvider(
	type: 'trello' | 'jira' | 'linear',
	itemsByStatus: Record<string, unknown[]> = {},
) {
	return {
		type,
		listWorkItems: vi
			.fn()
			.mockImplementation((_containerId: string | undefined, opts?: { status?: string }) =>
				Promise.resolve(opts?.status ? (itemsByStatus[opts.status] ?? []) : []),
			),
	} as unknown as Parameters<typeof isPipelineAtCapacity>[1];
}

function makeErrorProvider(type: 'trello' | 'jira' | 'linear') {
	return {
		type,
		listWorkItems: vi.fn().mockRejectedValue(new Error('network error')),
	} as unknown as Parameters<typeof isPipelineAtCapacity>[1];
}

// ---------------------------------------------------------------------------
// isPipelineAtCapacity tests
// ---------------------------------------------------------------------------

describe('isPipelineAtCapacity', () => {
	// =========================================================================
	// Trello
	// =========================================================================

	describe('Trello', () => {
		const trelloProject = createMockProject({
			trello: {
				boardId: 'board-1',
				lists: {
					backlog: 'backlog-list-id',
					todo: 'todo-list-id',
					inProgress: 'in-progress-list-id',
					inReview: 'in-review-list-id',
				},
				labels: {},
			},
			maxInFlightItems: 1,
		});

		it('returns at-capacity (backlog-empty) when the backlog list is empty', async () => {
			mockGetTrelloConfig.mockReturnValue({
				lists: {
					backlog: 'backlog-list-id',
					todo: 'todo-list-id',
					inProgress: 'in-progress-list-id',
					inReview: 'in-review-list-id',
				},
			});
			const provider = makeProvider('trello', {});

			const result = await isPipelineAtCapacity(trelloProject, provider);

			expect(result.atCapacity).toBe(true);
			expect(result.reason).toBe('backlog-empty');
			expect(result.inFlightCount).toBe(0);
			expect(result.limit).toBe(1);
			expect(result.availableSlots).toBe(1);
		});

		it('returns at-capacity when in-flight count equals limit (default 1)', async () => {
			mockGetTrelloConfig.mockReturnValue({
				lists: {
					backlog: 'backlog-list-id',
					todo: 'todo-list-id',
					inProgress: 'in-progress-list-id',
					inReview: 'in-review-list-id',
				},
			});
			const provider = makeProvider('trello', {
				backlog: [{ id: 'card-backlog-1' }],
				todo: [{ id: 'card-todo-1' }],
			});

			const result = await isPipelineAtCapacity(trelloProject, provider);

			expect(result.atCapacity).toBe(true);
			expect(result.reason).toBe('at-capacity');
			expect(result.inFlightCount).toBe(1);
			expect(result.limit).toBe(1);
			expect(result.availableSlots).toBe(0);
		});

		it('returns at-capacity when in-flight count exceeds limit', async () => {
			const project = createMockProject({
				trello: {
					boardId: 'board-1',
					lists: {
						backlog: 'backlog-list-id',
						todo: 'todo-list-id',
						inProgress: 'in-progress-list-id',
						inReview: 'in-review-list-id',
					},
					labels: {},
				},
				maxInFlightItems: 2,
			});

			mockGetTrelloConfig.mockReturnValue({
				lists: {
					backlog: 'backlog-list-id',
					todo: 'todo-list-id',
					inProgress: 'in-progress-list-id',
					inReview: 'in-review-list-id',
				},
			});
			const provider = makeProvider('trello', {
				backlog: [{ id: 'card-backlog-1' }],
				todo: [{ id: 'card-todo-1' }],
				inProgress: [{ id: 'card-wip-1' }, { id: 'card-wip-2' }],
			});

			const result = await isPipelineAtCapacity(project, provider);

			expect(result.atCapacity).toBe(true);
			expect(result.reason).toBe('at-capacity');
			expect(result.inFlightCount).toBe(3);
			expect(result.limit).toBe(2);
			expect(result.availableSlots).toBe(0);
		});

		it('returns below-capacity when in-flight count is below limit=3', async () => {
			const project = createMockProject({
				trello: {
					boardId: 'board-1',
					lists: {
						backlog: 'backlog-list-id',
						todo: 'todo-list-id',
						inProgress: 'in-progress-list-id',
						inReview: 'in-review-list-id',
					},
					labels: {},
				},
				maxInFlightItems: 3,
			});

			mockGetTrelloConfig.mockReturnValue({
				lists: {
					backlog: 'backlog-list-id',
					todo: 'todo-list-id',
					inProgress: 'in-progress-list-id',
					inReview: 'in-review-list-id',
				},
			});
			const provider = makeProvider('trello', {
				backlog: [{ id: 'card-backlog-1' }],
				todo: [{ id: 'card-todo-1' }],
				inProgress: [{ id: 'card-wip-1' }],
			});

			const result = await isPipelineAtCapacity(project, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('below-capacity');
			expect(result.inFlightCount).toBe(2);
			expect(result.limit).toBe(3);
			expect(result.availableSlots).toBe(1);
		});

		it('uses default limit=1 when maxInFlightItems is not set', async () => {
			const projectNoLimit = createMockProject({
				trello: {
					boardId: 'board-1',
					lists: {
						backlog: 'backlog-list-id',
						todo: 'todo-list-id',
					},
					labels: {},
				},
				// maxInFlightItems not set → defaults to 1
			});

			mockGetTrelloConfig.mockReturnValue({
				lists: { backlog: 'backlog-list-id', todo: 'todo-list-id' },
			});
			const provider = makeProvider('trello', {
				backlog: [{ id: 'card-backlog-1' }],
				todo: [{ id: 'card-todo-1' }],
			});

			const result = await isPipelineAtCapacity(projectNoLimit, provider);

			expect(result.atCapacity).toBe(true);
			expect(result.reason).toBe('at-capacity');
			expect(result.limit).toBe(1);
		});

		it('returns below-capacity when in-flight count is 0 with limit=5', async () => {
			const project = createMockProject({
				trello: {
					boardId: 'board-1',
					lists: { backlog: 'backlog-list-id', todo: 'todo-list-id' },
					labels: {},
				},
				maxInFlightItems: 5,
			});

			mockGetTrelloConfig.mockReturnValue({
				lists: { backlog: 'backlog-list-id', todo: 'todo-list-id' },
			});
			const provider = makeProvider('trello', {
				backlog: [{ id: 'card-backlog-1' }],
				// todo is empty
			});

			const result = await isPipelineAtCapacity(project, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('below-capacity');
			expect(result.inFlightCount).toBe(0);
			expect(result.limit).toBe(5);
			expect(result.availableSlots).toBe(5);
		});

		it('returns not-at-capacity (error fallback) when Trello API throws', async () => {
			mockGetTrelloConfig.mockReturnValue({
				lists: { backlog: 'backlog-list-id', todo: 'todo-list-id' },
			});
			const provider = makeErrorProvider('trello');

			const result = await isPipelineAtCapacity(trelloProject, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('error');
			expect(result.availableSlots).toBeUndefined();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				'isPipelineAtCapacity: failed to check capacity, assuming not at capacity',
				expect.objectContaining({ projectId: trelloProject.id, error: expect.any(String) }),
			);
		});

		it('returns misconfigured when Trello has no backlog list', async () => {
			mockGetTrelloConfig.mockReturnValue({ lists: {} }); // no backlog key
			const provider = makeProvider('trello');

			const result = await isPipelineAtCapacity(trelloProject, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('misconfigured');
			expect(result.availableSlots).toBeUndefined();
		});

		it('returns misconfigured when Trello config is missing entirely', async () => {
			mockGetTrelloConfig.mockReturnValue(undefined);
			const provider = makeProvider('trello');

			const result = await isPipelineAtCapacity(trelloProject, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('misconfigured');
			expect(result.availableSlots).toBeUndefined();
		});

		it('counts items across todo, inProgress, and inReview lists', async () => {
			const project = createMockProject({
				trello: {
					boardId: 'board-1',
					lists: {
						backlog: 'backlog-list-id',
						todo: 'todo-list-id',
						inProgress: 'in-progress-list-id',
						inReview: 'in-review-list-id',
					},
					labels: {},
				},
				maxInFlightItems: 10,
			});

			mockGetTrelloConfig.mockReturnValue({
				lists: {
					backlog: 'backlog-list-id',
					todo: 'todo-list-id',
					inProgress: 'in-progress-list-id',
					inReview: 'in-review-list-id',
				},
			});
			const provider = makeProvider('trello', {
				backlog: [{ id: 'card-backlog-1' }],
				todo: [{ id: 'todo-1' }, { id: 'todo-2' }],
				inProgress: [{ id: 'wip-1' }],
				inReview: [{ id: 'review-1' }, { id: 'review-2' }, { id: 'review-3' }],
			});

			const result = await isPipelineAtCapacity(project, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('below-capacity');
			expect(result.inFlightCount).toBe(6); // 2 + 1 + 3
			expect(result.limit).toBe(10);
			expect(result.availableSlots).toBe(4); // 10 - 6
		});
	});

	// =========================================================================
	// JIRA
	// =========================================================================

	describe('JIRA', () => {
		const jiraProject = createMockJiraProject({
			jira: {
				projectKey: 'PROJ',
				baseUrl: 'https://test.atlassian.net',
				statuses: {
					backlog: 'Backlog',
					todo: 'To Do',
					inProgress: 'In Progress',
					inReview: 'In Review',
				},
			},
			maxInFlightItems: 1,
		});

		it('returns at-capacity (backlog-empty) when the JIRA backlog status has no items', async () => {
			mockGetJiraConfig.mockReturnValue({
				projectKey: 'PROJ',
				statuses: {
					backlog: 'Backlog',
					todo: 'To Do',
					inProgress: 'In Progress',
					inReview: 'In Review',
				},
			});
			const provider = makeProvider('jira', {});

			const result = await isPipelineAtCapacity(jiraProject, provider);

			expect(result.atCapacity).toBe(true);
			expect(result.reason).toBe('backlog-empty');
			expect(result.inFlightCount).toBe(0);
			expect(result.limit).toBe(1);
			expect(result.availableSlots).toBe(1);
		});

		it('returns at-capacity when in-flight count equals limit=1', async () => {
			mockGetJiraConfig.mockReturnValue({
				projectKey: 'PROJ',
				statuses: {
					backlog: 'Backlog',
					todo: 'To Do',
					inProgress: 'In Progress',
					inReview: 'In Review',
				},
			});
			const provider = makeProvider('jira', {
				backlog: [{ id: 'PROJ-1' }],
				todo: [{ id: 'PROJ-2' }],
			});

			const result = await isPipelineAtCapacity(jiraProject, provider);

			expect(result.atCapacity).toBe(true);
			expect(result.reason).toBe('at-capacity');
			expect(result.inFlightCount).toBe(1);
			expect(result.limit).toBe(1);
			expect(result.availableSlots).toBe(0);
		});

		it('returns below-capacity when in-flight count is less than limit=3', async () => {
			const project = createMockJiraProject({
				jira: {
					projectKey: 'PROJ',
					baseUrl: 'https://test.atlassian.net',
					statuses: {
						backlog: 'Backlog',
						todo: 'To Do',
						inProgress: 'In Progress',
						inReview: 'In Review',
					},
				},
				maxInFlightItems: 3,
			});

			mockGetJiraConfig.mockReturnValue({
				projectKey: 'PROJ',
				statuses: {
					backlog: 'Backlog',
					todo: 'To Do',
					inProgress: 'In Progress',
					inReview: 'In Review',
				},
			});
			const provider = makeProvider('jira', {
				backlog: [{ id: 'PROJ-1' }],
				todo: [{ id: 'PROJ-2' }],
				inProgress: [{ id: 'PROJ-3' }],
			});

			const result = await isPipelineAtCapacity(project, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('below-capacity');
			expect(result.inFlightCount).toBe(2);
			expect(result.limit).toBe(3);
			expect(result.availableSlots).toBe(1);
		});

		it('returns at-capacity when in-flight count exceeds limit=2', async () => {
			const project = createMockJiraProject({
				jira: {
					projectKey: 'PROJ',
					baseUrl: 'https://test.atlassian.net',
					statuses: {
						backlog: 'Backlog',
						todo: 'To Do',
						inProgress: 'In Progress',
						inReview: 'In Review',
					},
				},
				maxInFlightItems: 2,
			});

			mockGetJiraConfig.mockReturnValue({
				projectKey: 'PROJ',
				statuses: {
					backlog: 'Backlog',
					todo: 'To Do',
					inProgress: 'In Progress',
					inReview: 'In Review',
				},
			});
			const provider = makeProvider('jira', {
				backlog: [{ id: 'PROJ-1' }],
				todo: [{ id: 'PROJ-2' }],
				inProgress: [{ id: 'PROJ-3' }],
				inReview: [{ id: 'PROJ-4' }],
			});

			const result = await isPipelineAtCapacity(project, provider);

			expect(result.atCapacity).toBe(true);
			expect(result.reason).toBe('at-capacity');
			expect(result.inFlightCount).toBe(3);
			expect(result.limit).toBe(2);
			expect(result.availableSlots).toBe(0);
		});

		it('uses default limit=1 when maxInFlightItems is not set', async () => {
			const projectNoLimit = createMockJiraProject({
				jira: {
					projectKey: 'PROJ',
					baseUrl: 'https://test.atlassian.net',
					statuses: {
						backlog: 'Backlog',
						todo: 'To Do',
					},
				},
				// maxInFlightItems not set → defaults to 1
			});

			mockGetJiraConfig.mockReturnValue({
				projectKey: 'PROJ',
				statuses: { backlog: 'Backlog', todo: 'To Do' },
			});
			const provider = makeProvider('jira', {
				backlog: [{ id: 'PROJ-1' }],
				todo: [{ id: 'PROJ-2' }],
			});

			const result = await isPipelineAtCapacity(projectNoLimit, provider);

			expect(result.atCapacity).toBe(true);
			expect(result.reason).toBe('at-capacity');
			expect(result.limit).toBe(1);
		});

		it('returns below-capacity with limit=5 when in-flight is 0', async () => {
			const project = createMockJiraProject({
				jira: {
					projectKey: 'PROJ',
					baseUrl: 'https://test.atlassian.net',
					statuses: { backlog: 'Backlog', todo: 'To Do' },
				},
				maxInFlightItems: 5,
			});

			mockGetJiraConfig.mockReturnValue({
				projectKey: 'PROJ',
				statuses: { backlog: 'Backlog', todo: 'To Do' },
			});
			const provider = makeProvider('jira', {
				backlog: [{ id: 'PROJ-1' }],
				// To Do is empty
			});

			const result = await isPipelineAtCapacity(project, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('below-capacity');
			expect(result.inFlightCount).toBe(0);
			expect(result.limit).toBe(5);
			expect(result.availableSlots).toBe(5);
		});

		it('returns not-at-capacity (error fallback) when JIRA API throws', async () => {
			mockGetJiraConfig.mockReturnValue({
				projectKey: 'PROJ',
				statuses: { backlog: 'Backlog', todo: 'To Do' },
			});
			const provider = makeErrorProvider('jira');

			const result = await isPipelineAtCapacity(jiraProject, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('error');
			expect(result.availableSlots).toBeUndefined();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				'isPipelineAtCapacity: failed to check capacity, assuming not at capacity',
				expect.objectContaining({ projectId: jiraProject.id, error: expect.any(String) }),
			);
		});

		it('returns misconfigured when JIRA config has no backlog status', async () => {
			mockGetJiraConfig.mockReturnValue({
				projectKey: 'PROJ',
				statuses: {}, // no backlog key
			});
			const provider = makeProvider('jira');

			const result = await isPipelineAtCapacity(jiraProject, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('misconfigured');
			expect(result.availableSlots).toBeUndefined();
		});

		it('returns misconfigured when JIRA config has no projectKey', async () => {
			mockGetJiraConfig.mockReturnValue({
				statuses: { backlog: 'Backlog' },
				// no projectKey
			});
			const provider = makeProvider('jira');

			const result = await isPipelineAtCapacity(jiraProject, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('misconfigured');
			expect(result.availableSlots).toBeUndefined();
		});

		it('returns misconfigured when JIRA config is missing entirely', async () => {
			mockGetJiraConfig.mockReturnValue(undefined);
			const provider = makeProvider('jira');

			const result = await isPipelineAtCapacity(jiraProject, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('misconfigured');
			expect(result.availableSlots).toBeUndefined();
		});
	});

	// =========================================================================
	// Linear
	// =========================================================================

	describe('Linear', () => {
		const linearProject = createMockLinearProject({
			linear: {
				teamId: 'T1',
				statuses: {
					backlog: 'state-backlog',
					todo: 'state-todo',
					inProgress: 'state-inprog',
					inReview: 'state-inrev',
				},
				labels: {},
			},
			maxInFlightItems: 1,
		});

		it('returns at-capacity (backlog-empty) when the Linear backlog is empty', async () => {
			mockGetLinearConfig.mockReturnValue({
				teamId: 'T1',
				statuses: { backlog: 'state-backlog' },
			});
			const provider = makeProvider('linear', {});

			const result = await isPipelineAtCapacity(linearProject, provider);

			expect(result.atCapacity).toBe(true);
			expect(result.reason).toBe('backlog-empty');
			expect(result.availableSlots).toBe(1);
			expect(provider.listWorkItems).toHaveBeenCalledWith(undefined, { status: 'backlog' });
		});

		it('returns below-capacity when Linear in-flight count is below limit', async () => {
			mockGetLinearConfig.mockReturnValue({
				teamId: 'T1',
				statuses: { backlog: 'state-backlog' },
			});
			const provider = makeProvider('linear', {
				backlog: [{ id: 'MNG-97' }],
				todo: [],
				inProgress: [],
				inReview: [],
			});

			const result = await isPipelineAtCapacity(linearProject, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('below-capacity');
			expect(result.inFlightCount).toBe(0);
			expect(result.limit).toBe(1);
			expect(result.availableSlots).toBe(1);
		});

		it('returns at-capacity when Linear in-flight count meets the limit', async () => {
			mockGetLinearConfig.mockReturnValue({
				teamId: 'T1',
				statuses: { backlog: 'state-backlog' },
			});
			const provider = makeProvider('linear', {
				backlog: [{ id: 'MNG-97' }],
				todo: [{ id: 'MNG-96' }],
			});

			const result = await isPipelineAtCapacity(linearProject, provider);

			expect(result.atCapacity).toBe(true);
			expect(result.reason).toBe('at-capacity');
			expect(result.inFlightCount).toBe(1);
			expect(result.availableSlots).toBe(0);
		});

		it('returns misconfigured when Linear has no statuses.backlog configured', async () => {
			mockGetLinearConfig.mockReturnValue({
				teamId: 'T1',
				statuses: {}, // no backlog
			});
			const provider = makeProvider('linear');

			const result = await isPipelineAtCapacity(linearProject, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('misconfigured');
			expect(result.availableSlots).toBeUndefined();
			expect(provider.listWorkItems).not.toHaveBeenCalled();
		});

		it('returns misconfigured when Linear has no teamId configured', async () => {
			mockGetLinearConfig.mockReturnValue({
				teamId: '',
				statuses: { backlog: 'state-backlog' },
			});
			const provider = makeProvider('linear');

			const result = await isPipelineAtCapacity(linearProject, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('misconfigured');
			expect(result.availableSlots).toBeUndefined();
		});
	});

	// =========================================================================
	// Unsupported provider type — exhaustiveness safety net
	// =========================================================================

	describe('unsupported provider type', () => {
		it('throws when an unknown provider.type sneaks past TypeScript', async () => {
			// In normal use, PMType (`'trello' | 'jira' | 'linear'`) is enforced at
			// compile time. The cast here simulates a JS-side path bypassing the
			// type system (e.g. the oclif command loader). The exhaustive switch
			// in isProviderMisconfigured throws via assertNeverPMType so the bug
			// surfaces immediately rather than silently reporting "misconfigured".
			const project = createMockProject();
			const provider = {
				type: 'unknown-provider' as unknown as 'trello',
				listWorkItems: vi.fn(),
			} as unknown as Parameters<typeof isPipelineAtCapacity>[1];

			await expect(isPipelineAtCapacity(project, provider)).rejects.toThrow(/Unhandled PMType/);
			expect(provider.listWorkItems).not.toHaveBeenCalled();
		});
	});
});
