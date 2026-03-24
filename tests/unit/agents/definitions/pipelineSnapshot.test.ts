import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/pm/index.js', () => ({
	getPMProviderOrNull: vi.fn(),
}));

vi.mock('../../../../src/gadgets/pm/core/readWorkItem.js', () => ({
	readWorkItem: vi.fn(),
}));

import { fetchPipelineSnapshotStep } from '../../../../src/agents/definitions/contextSteps.js';
import type { FetchContextParams } from '../../../../src/agents/definitions/contextSteps.js';
import { readWorkItem } from '../../../../src/gadgets/pm/core/readWorkItem.js';
import { getPMProviderOrNull } from '../../../../src/pm/index.js';
import type { AgentInput, ProjectConfig } from '../../../../src/types/index.js';

const mockGetPMProviderOrNull = vi.mocked(getPMProviderOrNull);
const mockReadWorkItem = vi.mocked(readWorkItem);

function makeProject(overrides: Partial<ProjectConfig['trello']> = {}): ProjectConfig {
	return {
		id: 'test-project',
		orgId: 'test-org',
		name: 'Test Project',
		repo: 'owner/repo',
		baseBranch: 'main',
		pm: { type: 'trello' },
		trello: {
			boardId: 'board-1',
			lists: {
				backlog: 'list-backlog',
				todo: 'list-todo',
				inProgress: 'list-inprogress',
				inReview: 'list-inreview',
				done: 'list-done',
				merged: 'list-merged',
				...overrides,
			},
			labels: {},
		},
	} as unknown as ProjectConfig;
}

function makeParams(
	overrides: Partial<FetchContextParams> = {},
	project?: ProjectConfig,
): FetchContextParams {
	return {
		input: {} as AgentInput,
		repoDir: '/tmp/repo',
		contextFiles: [],
		logWriter: vi.fn(),
		project,
		...overrides,
	};
}

const mockProvider = {
	listWorkItems: vi.fn(),
};

describe('fetchPipelineSnapshotStep', () => {
	it('returns empty array when no PM provider', async () => {
		mockGetPMProviderOrNull.mockReturnValue(null);
		const result = await fetchPipelineSnapshotStep(makeParams({}, makeProject()));
		expect(result).toEqual([]);
	});

	it('returns empty array when no project config', async () => {
		mockGetPMProviderOrNull.mockReturnValue(mockProvider as never);
		const params = makeParams(); // no project
		const result = await fetchPipelineSnapshotStep(params);
		expect(result).toEqual([]);
	});

	it('returns empty array when no lists configured', async () => {
		mockGetPMProviderOrNull.mockReturnValue(mockProvider as never);
		const project = {
			id: 'test-project',
			orgId: 'test-org',
			name: 'Test Project',
			repo: 'owner/repo',
			baseBranch: 'main',
			pm: { type: 'trello' },
			trello: { boardId: 'board-1', lists: {}, labels: {} },
		} as unknown as ProjectConfig;
		const result = await fetchPipelineSnapshotStep(makeParams({}, project));
		expect(result).toEqual([]);
	});

	it('returns a single ContextInjection with toolName PipelineSnapshot', async () => {
		mockGetPMProviderOrNull.mockReturnValue(mockProvider as never);
		mockProvider.listWorkItems.mockResolvedValue([]);
		mockReadWorkItem.mockResolvedValue('# Card Details\n\nSome content');

		const result = await fetchPipelineSnapshotStep(makeParams({}, makeProject()));

		expect(result).toHaveLength(1);
		expect(result[0].toolName).toBe('PipelineSnapshot');
		expect(result[0].params).toEqual({
			comment: 'Pre-fetched full pipeline snapshot across all lists',
		});
	});

	it('includes all configured list sections in output', async () => {
		mockGetPMProviderOrNull.mockReturnValue(mockProvider as never);
		mockProvider.listWorkItems.mockResolvedValue([]);

		const result = await fetchPipelineSnapshotStep(makeParams({}, makeProject()));

		const output = result[0].result as string;
		expect(output).toContain('## BACKLOG');
		expect(output).toContain('## TODO');
		expect(output).toContain('## IN_PROGRESS');
		expect(output).toContain('## IN_REVIEW');
		expect(output).toContain('## DONE');
		expect(output).toContain('## MERGED');
	});

	it('marks empty lists as empty in output', async () => {
		mockGetPMProviderOrNull.mockReturnValue(mockProvider as never);
		mockProvider.listWorkItems.mockResolvedValue([]);

		const result = await fetchPipelineSnapshotStep(makeParams({}, makeProject()));

		const output = result[0].result as string;
		expect(output).toContain('_Empty — no items_');
	});

	it('fetches full details for BACKLOG, TODO, IN_PROGRESS, IN_REVIEW items', async () => {
		mockGetPMProviderOrNull.mockReturnValue(mockProvider as never);

		const card = { id: 'card-1', title: 'Test Card', url: 'http://trello.com/c/1', labels: [] };
		mockProvider.listWorkItems.mockImplementation(async (listId: string) => {
			if (listId === 'list-backlog') return [card];
			if (listId === 'list-todo') return [card];
			return [];
		});
		mockReadWorkItem.mockResolvedValue('# Test Card\n\nFull details here');

		const result = await fetchPipelineSnapshotStep(makeParams({}, makeProject()));

		expect(mockReadWorkItem).toHaveBeenCalledWith('card-1', true);
		const output = result[0].result as string;
		expect(output).toContain('Full details here');
	});

	it('uses title-and-url format for DONE and MERGED lists', async () => {
		mockGetPMProviderOrNull.mockReturnValue(mockProvider as never);

		const card = { id: 'card-done', title: 'Done Card', url: 'http://trello.com/c/2', labels: [] };
		mockProvider.listWorkItems.mockImplementation(async (listId: string) => {
			if (listId === 'list-done' || listId === 'list-merged') return [card];
			return [];
		});
		mockReadWorkItem.mockResolvedValue('# Done Card\n\nFull details');

		const result = await fetchPipelineSnapshotStep(makeParams({}, makeProject()));

		// readWorkItem should NOT be called for DONE/MERGED items
		expect(mockReadWorkItem).not.toHaveBeenCalledWith('card-done', true);

		const output = result[0].result as string;
		// Title + URL format
		expect(output).toContain('[card-done] Done Card');
		expect(output).toContain('http://trello.com/c/2');
	});

	it('omits URL parentheses for DONE/MERGED items when url is empty', async () => {
		mockGetPMProviderOrNull.mockReturnValue(mockProvider as never);

		const card = { id: 'card-done', title: 'Done Card', url: '', labels: [] };
		mockProvider.listWorkItems.mockImplementation(async (listId: string) => {
			if (listId === 'list-done') return [card];
			return [];
		});

		const result = await fetchPipelineSnapshotStep(makeParams({}, makeProject()));

		const output = result[0].result as string;
		expect(output).toContain('[card-done] Done Card');
		expect(output).not.toContain('()');
	});

	it('handles list fetch errors gracefully', async () => {
		mockGetPMProviderOrNull.mockReturnValue(mockProvider as never);
		mockProvider.listWorkItems.mockRejectedValue(new Error('Network error'));

		const params = makeParams({}, makeProject());
		const result = await fetchPipelineSnapshotStep(params);

		expect(result).toHaveLength(1);
		const output = result[0].result as string;
		expect(output).toContain('Failed to fetch');
		expect(params.logWriter).toHaveBeenCalledWith(
			'WARN',
			expect.stringContaining('Failed to fetch list'),
			expect.objectContaining({ error: 'Network error' }),
		);
	});

	it('handles card read errors gracefully', async () => {
		mockGetPMProviderOrNull.mockReturnValue(mockProvider as never);

		const card = { id: 'card-1', title: 'Test Card', url: 'http://trello.com/c/1', labels: [] };
		mockProvider.listWorkItems.mockImplementation(async (listId: string) => {
			if (listId === 'list-backlog') return [card];
			return [];
		});
		mockReadWorkItem.mockRejectedValue(new Error('Card read error'));

		const params = makeParams({}, makeProject());
		const result = await fetchPipelineSnapshotStep(params);

		// Should still return a result even if card read fails
		expect(result).toHaveLength(1);
	});

	it('description includes count of lists and full-detail items', async () => {
		mockGetPMProviderOrNull.mockReturnValue(mockProvider as never);

		const card = { id: 'card-1', title: 'Test Card', url: 'http://trello.com/c/1', labels: [] };
		mockProvider.listWorkItems.mockImplementation(async (listId: string) => {
			if (listId === 'list-backlog') return [card];
			return [];
		});
		mockReadWorkItem.mockResolvedValue('# Test Card');

		const result = await fetchPipelineSnapshotStep(makeParams({}, makeProject()));

		expect(result[0].description).toContain('6 lists');
		expect(result[0].description).toContain('1 items with full details');
	});

	it('works with JIRA project config', async () => {
		mockGetPMProviderOrNull.mockReturnValue(mockProvider as never);
		mockProvider.listWorkItems.mockResolvedValue([]);

		const jiraProject = {
			id: 'jira-project',
			orgId: 'test-org',
			name: 'JIRA Project',
			repo: 'owner/repo',
			baseBranch: 'main',
			pm: { type: 'jira' },
			jira: {
				projectKey: 'PROJ',
				baseUrl: 'https://example.atlassian.net',
				statuses: {
					backlog: 'Backlog',
					todo: 'To Do',
					inProgress: 'In Progress',
					inReview: 'In Review',
					done: 'Done',
					merged: 'Merged',
				},
			},
		} as unknown as ProjectConfig;

		const result = await fetchPipelineSnapshotStep(makeParams({}, jiraProject));

		expect(result).toHaveLength(1);
		expect(result[0].toolName).toBe('PipelineSnapshot');
		// All 6 lists should be fetched
		expect(mockProvider.listWorkItems).toHaveBeenCalledTimes(6);
	});

	it('handles partially configured lists (some missing)', async () => {
		mockGetPMProviderOrNull.mockReturnValue(mockProvider as never);
		mockProvider.listWorkItems.mockResolvedValue([]);

		const partialProject = {
			id: 'test-project',
			orgId: 'test-org',
			name: 'Test Project',
			repo: 'owner/repo',
			baseBranch: 'main',
			pm: { type: 'trello' },
			trello: {
				boardId: 'board-1',
				lists: {
					backlog: 'list-backlog',
					todo: 'list-todo',
					// inProgress, inReview, done, merged NOT configured
				},
				labels: {},
			},
		} as unknown as ProjectConfig;

		const result = await fetchPipelineSnapshotStep(makeParams({}, partialProject));

		expect(result).toHaveLength(1);
		// Only 2 lists configured
		expect(mockProvider.listWorkItems).toHaveBeenCalledTimes(2);
		expect(result[0].description).toContain('2 lists');
	});

	it('includes list IDs in section headers', async () => {
		mockGetPMProviderOrNull.mockReturnValue(mockProvider as never);
		mockProvider.listWorkItems.mockResolvedValue([]);

		const result = await fetchPipelineSnapshotStep(makeParams({}, makeProject()));

		const output = result[0].result as string;
		expect(output).toContain('list ID: list-backlog');
		expect(output).toContain('list ID: list-todo');
	});
});
