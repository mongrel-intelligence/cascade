import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockGetTrelloConfig, mockGetJiraConfig, mockLogger } = vi.hoisted(() => ({
	mockGetTrelloConfig: vi.fn(),
	mockGetJiraConfig: vi.fn(),
	mockLogger: {
		info: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../../src/pm/config.js', () => ({
	getTrelloConfig: mockGetTrelloConfig,
	getJiraConfig: mockGetJiraConfig,
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

import {
	isBacklogEmpty,
	isPipelineAtCapacity,
} from '../../../../src/triggers/shared/backlog-check.js';
import { createMockJiraProject, createMockProject } from '../../../helpers/factories.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeProvider(type: 'trello' | 'jira', itemsByList: Record<string, unknown[]> = {}) {
	return {
		type,
		listWorkItems: vi.fn().mockImplementation((listIdOrKey: string, opts?: { status?: string }) => {
			// For JIRA: look up by status value; for Trello: look up by list ID
			const key = opts?.status ?? listIdOrKey;
			return Promise.resolve(itemsByList[key] ?? []);
		}),
	} as unknown as Parameters<typeof isPipelineAtCapacity>[1];
}

function makeErrorProvider(type: 'trello' | 'jira') {
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
				'backlog-list-id': [{ id: 'card-backlog-1' }],
				'todo-list-id': [{ id: 'card-todo-1' }],
			});

			const result = await isPipelineAtCapacity(trelloProject, provider);

			expect(result.atCapacity).toBe(true);
			expect(result.reason).toBe('at-capacity');
			expect(result.inFlightCount).toBe(1);
			expect(result.limit).toBe(1);
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
				'backlog-list-id': [{ id: 'card-backlog-1' }],
				'todo-list-id': [{ id: 'card-todo-1' }],
				'in-progress-list-id': [{ id: 'card-wip-1' }, { id: 'card-wip-2' }],
			});

			const result = await isPipelineAtCapacity(project, provider);

			expect(result.atCapacity).toBe(true);
			expect(result.reason).toBe('at-capacity');
			expect(result.inFlightCount).toBe(3);
			expect(result.limit).toBe(2);
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
				'backlog-list-id': [{ id: 'card-backlog-1' }],
				'todo-list-id': [{ id: 'card-todo-1' }],
				'in-progress-list-id': [{ id: 'card-wip-1' }],
			});

			const result = await isPipelineAtCapacity(project, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('below-capacity');
			expect(result.inFlightCount).toBe(2);
			expect(result.limit).toBe(3);
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
				'backlog-list-id': [{ id: 'card-backlog-1' }],
				'todo-list-id': [{ id: 'card-todo-1' }],
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
				'backlog-list-id': [{ id: 'card-backlog-1' }],
				// todo is empty
			});

			const result = await isPipelineAtCapacity(project, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('below-capacity');
			expect(result.inFlightCount).toBe(0);
			expect(result.limit).toBe(5);
		});

		it('returns not-at-capacity (error fallback) when Trello API throws', async () => {
			mockGetTrelloConfig.mockReturnValue({
				lists: { backlog: 'backlog-list-id', todo: 'todo-list-id' },
			});
			const provider = makeErrorProvider('trello');

			const result = await isPipelineAtCapacity(trelloProject, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('error');
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
		});

		it('returns misconfigured when Trello config is missing entirely', async () => {
			mockGetTrelloConfig.mockReturnValue(undefined);
			const provider = makeProvider('trello');

			const result = await isPipelineAtCapacity(trelloProject, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('misconfigured');
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
				'backlog-list-id': [{ id: 'card-backlog-1' }],
				'todo-list-id': [{ id: 'todo-1' }, { id: 'todo-2' }],
				'in-progress-list-id': [{ id: 'wip-1' }],
				'in-review-list-id': [{ id: 'review-1' }, { id: 'review-2' }, { id: 'review-3' }],
			});

			const result = await isPipelineAtCapacity(project, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('below-capacity');
			expect(result.inFlightCount).toBe(6); // 2 + 1 + 3
			expect(result.limit).toBe(10);
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
				Backlog: [{ id: 'PROJ-1' }],
				'To Do': [{ id: 'PROJ-2' }],
			});

			const result = await isPipelineAtCapacity(jiraProject, provider);

			expect(result.atCapacity).toBe(true);
			expect(result.reason).toBe('at-capacity');
			expect(result.inFlightCount).toBe(1);
			expect(result.limit).toBe(1);
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
				Backlog: [{ id: 'PROJ-1' }],
				'To Do': [{ id: 'PROJ-2' }],
				'In Progress': [{ id: 'PROJ-3' }],
			});

			const result = await isPipelineAtCapacity(project, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('below-capacity');
			expect(result.inFlightCount).toBe(2);
			expect(result.limit).toBe(3);
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
				Backlog: [{ id: 'PROJ-1' }],
				'To Do': [{ id: 'PROJ-2' }],
				'In Progress': [{ id: 'PROJ-3' }],
				'In Review': [{ id: 'PROJ-4' }],
			});

			const result = await isPipelineAtCapacity(project, provider);

			expect(result.atCapacity).toBe(true);
			expect(result.reason).toBe('at-capacity');
			expect(result.inFlightCount).toBe(3);
			expect(result.limit).toBe(2);
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
				Backlog: [{ id: 'PROJ-1' }],
				'To Do': [{ id: 'PROJ-2' }],
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
				Backlog: [{ id: 'PROJ-1' }],
				// To Do is empty
			});

			const result = await isPipelineAtCapacity(project, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('below-capacity');
			expect(result.inFlightCount).toBe(0);
			expect(result.limit).toBe(5);
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
		});

		it('returns misconfigured when JIRA config is missing entirely', async () => {
			mockGetJiraConfig.mockReturnValue(undefined);
			const provider = makeProvider('jira');

			const result = await isPipelineAtCapacity(jiraProject, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('misconfigured');
		});
	});

	// =========================================================================
	// Unsupported provider type
	// =========================================================================

	describe('unsupported provider type', () => {
		it('returns misconfigured for an unknown provider type', async () => {
			const project = createMockProject();
			const provider = {
				type: 'unknown-provider' as unknown as 'trello',
				listWorkItems: vi.fn(),
			} as unknown as Parameters<typeof isPipelineAtCapacity>[1];

			const result = await isPipelineAtCapacity(project, provider);

			expect(result.atCapacity).toBe(false);
			expect(result.reason).toBe('misconfigured');
			expect(provider.listWorkItems).not.toHaveBeenCalled();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				'isPipelineAtCapacity: unsupported PM provider type',
				expect.objectContaining({ providerType: 'unknown-provider' }),
			);
		});
	});
});

// ---------------------------------------------------------------------------
// isBacklogEmpty tests (deprecated — kept for backward compat)
// ---------------------------------------------------------------------------

describe('isBacklogEmpty', () => {
	// =========================================================================
	// Trello
	// =========================================================================

	describe('Trello', () => {
		const trelloProject = createMockProject({
			trello: {
				boardId: 'board-1',
				lists: { backlog: 'backlog-list-id', todo: 'todo-list-id' },
				labels: {},
			},
		});

		it('returns true when the Trello backlog list is empty', async () => {
			mockGetTrelloConfig.mockReturnValue({ lists: { backlog: 'backlog-list-id' } });
			const provider = {
				type: 'trello' as const,
				listWorkItems: vi.fn().mockResolvedValue([]),
			} as unknown as Parameters<typeof isBacklogEmpty>[1];

			const result = await isBacklogEmpty(trelloProject, provider);

			expect(result).toBe(true);
			expect(provider.listWorkItems).toHaveBeenCalledWith('backlog-list-id');
		});

		it('returns false when the Trello backlog list has items', async () => {
			mockGetTrelloConfig.mockReturnValue({ lists: { backlog: 'backlog-list-id' } });
			const provider = {
				type: 'trello' as const,
				listWorkItems: vi.fn().mockResolvedValue([{ id: 'card-1' }, { id: 'card-2' }]),
			} as unknown as Parameters<typeof isBacklogEmpty>[1];

			const result = await isBacklogEmpty(trelloProject, provider);

			expect(result).toBe(false);
			expect(provider.listWorkItems).toHaveBeenCalledWith('backlog-list-id');
		});

		it('returns false when Trello config has no backlog list configured', async () => {
			mockGetTrelloConfig.mockReturnValue({ lists: {} }); // no backlog key
			const provider = {
				type: 'trello' as const,
				listWorkItems: vi.fn(),
			} as unknown as Parameters<typeof isBacklogEmpty>[1];

			const result = await isBacklogEmpty(trelloProject, provider);

			expect(result).toBe(false);
			expect(provider.listWorkItems).not.toHaveBeenCalled();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				'isBacklogEmpty: no backlog list configured for Trello project',
				expect.objectContaining({ projectId: trelloProject.id }),
			);
		});

		it('returns false when Trello config is missing entirely', async () => {
			mockGetTrelloConfig.mockReturnValue(undefined);
			const provider = {
				type: 'trello' as const,
				listWorkItems: vi.fn(),
			} as unknown as Parameters<typeof isBacklogEmpty>[1];

			const result = await isBacklogEmpty(trelloProject, provider);

			expect(result).toBe(false);
			expect(provider.listWorkItems).not.toHaveBeenCalled();
		});

		it('returns false when the Trello API throws an error (conservative fallback)', async () => {
			mockGetTrelloConfig.mockReturnValue({ lists: { backlog: 'backlog-list-id' } });
			const provider = {
				type: 'trello' as const,
				listWorkItems: vi.fn().mockRejectedValue(new Error('network error')),
			} as unknown as Parameters<typeof isBacklogEmpty>[1];

			const result = await isBacklogEmpty(trelloProject, provider);

			expect(result).toBe(false);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				'isBacklogEmpty: failed to check backlog, assuming non-empty',
				expect.objectContaining({ projectId: trelloProject.id, error: expect.any(String) }),
			);
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
				statuses: { backlog: 'Backlog', splitting: 'Briefing' },
			},
		});

		it('returns true when the JIRA backlog status has no items', async () => {
			mockGetJiraConfig.mockReturnValue({
				projectKey: 'PROJ',
				statuses: { backlog: 'Backlog' },
			});
			const provider = {
				type: 'jira' as const,
				listWorkItems: vi.fn().mockResolvedValue([]),
			} as unknown as Parameters<typeof isBacklogEmpty>[1];

			const result = await isBacklogEmpty(jiraProject, provider);

			expect(result).toBe(true);
			expect(provider.listWorkItems).toHaveBeenCalledWith('PROJ', { status: 'Backlog' });
		});

		it('returns false when the JIRA backlog status has items', async () => {
			mockGetJiraConfig.mockReturnValue({
				projectKey: 'PROJ',
				statuses: { backlog: 'Backlog' },
			});
			const provider = {
				type: 'jira' as const,
				listWorkItems: vi.fn().mockResolvedValue([{ id: 'PROJ-1' }]),
			} as unknown as Parameters<typeof isBacklogEmpty>[1];

			const result = await isBacklogEmpty(jiraProject, provider);

			expect(result).toBe(false);
			expect(provider.listWorkItems).toHaveBeenCalledWith('PROJ', { status: 'Backlog' });
		});

		it('returns false when JIRA config has no backlog status', async () => {
			mockGetJiraConfig.mockReturnValue({
				projectKey: 'PROJ',
				statuses: {}, // no backlog key
			});
			const provider = {
				type: 'jira' as const,
				listWorkItems: vi.fn(),
			} as unknown as Parameters<typeof isBacklogEmpty>[1];

			const result = await isBacklogEmpty(jiraProject, provider);

			expect(result).toBe(false);
			expect(provider.listWorkItems).not.toHaveBeenCalled();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				'isBacklogEmpty: no backlog status or projectKey configured for JIRA project',
				expect.objectContaining({ projectId: jiraProject.id }),
			);
		});

		it('returns false when JIRA config has no projectKey', async () => {
			mockGetJiraConfig.mockReturnValue({
				statuses: { backlog: 'Backlog' },
				// no projectKey
			});
			const provider = {
				type: 'jira' as const,
				listWorkItems: vi.fn(),
			} as unknown as Parameters<typeof isBacklogEmpty>[1];

			const result = await isBacklogEmpty(jiraProject, provider);

			expect(result).toBe(false);
			expect(provider.listWorkItems).not.toHaveBeenCalled();
		});

		it('returns false when JIRA config is missing entirely', async () => {
			mockGetJiraConfig.mockReturnValue(undefined);
			const provider = {
				type: 'jira' as const,
				listWorkItems: vi.fn(),
			} as unknown as Parameters<typeof isBacklogEmpty>[1];

			const result = await isBacklogEmpty(jiraProject, provider);

			expect(result).toBe(false);
			expect(provider.listWorkItems).not.toHaveBeenCalled();
		});

		it('returns false when the JIRA API throws an error (conservative fallback)', async () => {
			mockGetJiraConfig.mockReturnValue({
				projectKey: 'PROJ',
				statuses: { backlog: 'Backlog' },
			});
			const provider = {
				type: 'jira' as const,
				listWorkItems: vi.fn().mockRejectedValue(new Error('network error')),
			} as unknown as Parameters<typeof isBacklogEmpty>[1];

			const result = await isBacklogEmpty(jiraProject, provider);

			expect(result).toBe(false);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				'isBacklogEmpty: failed to check backlog, assuming non-empty',
				expect.objectContaining({ projectId: jiraProject.id, error: expect.any(String) }),
			);
		});
	});

	// =========================================================================
	// Unsupported provider type
	// =========================================================================

	describe('unsupported provider type', () => {
		it('returns false for an unknown provider type', async () => {
			const project = createMockProject();
			const provider = {
				type: 'unknown-provider' as unknown as 'trello',
				listWorkItems: vi.fn(),
			} as unknown as Parameters<typeof isBacklogEmpty>[1];

			const result = await isBacklogEmpty(project, provider);

			expect(result).toBe(false);
			expect(provider.listWorkItems).not.toHaveBeenCalled();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				'isBacklogEmpty: unsupported PM provider type',
				expect.objectContaining({ providerType: 'unknown-provider' }),
			);
		});
	});
});
