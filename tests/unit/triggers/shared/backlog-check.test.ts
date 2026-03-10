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

import { isBacklogEmpty } from '../../../../src/triggers/shared/backlog-check.js';
import { createMockJiraProject, createMockProject } from '../../../helpers/factories.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeProvider(type: 'trello' | 'jira', items: unknown[] = []) {
	return {
		type,
		listWorkItems: vi.fn().mockResolvedValue(items),
	} as unknown as Parameters<typeof isBacklogEmpty>[1];
}

function makeErrorProvider(type: 'trello' | 'jira') {
	return {
		type,
		listWorkItems: vi.fn().mockRejectedValue(new Error('network error')),
	} as unknown as Parameters<typeof isBacklogEmpty>[1];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isBacklogEmpty', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

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
			const provider = makeProvider('trello', []);

			const result = await isBacklogEmpty(trelloProject, provider);

			expect(result).toBe(true);
			expect(provider.listWorkItems).toHaveBeenCalledWith('backlog-list-id');
		});

		it('returns false when the Trello backlog list has items', async () => {
			mockGetTrelloConfig.mockReturnValue({ lists: { backlog: 'backlog-list-id' } });
			const provider = makeProvider('trello', [{ id: 'card-1' }, { id: 'card-2' }]);

			const result = await isBacklogEmpty(trelloProject, provider);

			expect(result).toBe(false);
			expect(provider.listWorkItems).toHaveBeenCalledWith('backlog-list-id');
		});

		it('returns false when Trello config has no backlog list configured', async () => {
			mockGetTrelloConfig.mockReturnValue({ lists: {} }); // no backlog key
			const provider = makeProvider('trello');

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
			const provider = makeProvider('trello');

			const result = await isBacklogEmpty(trelloProject, provider);

			expect(result).toBe(false);
			expect(provider.listWorkItems).not.toHaveBeenCalled();
		});

		it('returns false when the Trello API throws an error (conservative fallback)', async () => {
			mockGetTrelloConfig.mockReturnValue({ lists: { backlog: 'backlog-list-id' } });
			const provider = makeErrorProvider('trello');

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
			const provider = makeProvider('jira', []);

			const result = await isBacklogEmpty(jiraProject, provider);

			expect(result).toBe(true);
			expect(provider.listWorkItems).toHaveBeenCalledWith('PROJ', { status: 'Backlog' });
		});

		it('returns false when the JIRA backlog status has items', async () => {
			mockGetJiraConfig.mockReturnValue({
				projectKey: 'PROJ',
				statuses: { backlog: 'Backlog' },
			});
			const provider = makeProvider('jira', [{ id: 'PROJ-1' }]);

			const result = await isBacklogEmpty(jiraProject, provider);

			expect(result).toBe(false);
			expect(provider.listWorkItems).toHaveBeenCalledWith('PROJ', { status: 'Backlog' });
		});

		it('returns false when JIRA config has no backlog status', async () => {
			mockGetJiraConfig.mockReturnValue({
				projectKey: 'PROJ',
				statuses: {}, // no backlog key
			});
			const provider = makeProvider('jira');

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
			const provider = makeProvider('jira');

			const result = await isBacklogEmpty(jiraProject, provider);

			expect(result).toBe(false);
			expect(provider.listWorkItems).not.toHaveBeenCalled();
		});

		it('returns false when JIRA config is missing entirely', async () => {
			mockGetJiraConfig.mockReturnValue(undefined);
			const provider = makeProvider('jira');

			const result = await isBacklogEmpty(jiraProject, provider);

			expect(result).toBe(false);
			expect(provider.listWorkItems).not.toHaveBeenCalled();
		});

		it('returns false when the JIRA API throws an error (conservative fallback)', async () => {
			mockGetJiraConfig.mockReturnValue({
				projectKey: 'PROJ',
				statuses: { backlog: 'Backlog' },
			});
			const provider = makeErrorProvider('jira');

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
