import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/pm/index.js', async () => {
	const actual = await vi.importActual<typeof import('../../../../src/pm/index.js')>(
		'../../../../src/pm/index.js',
	);
	return {
		...actual,
		getPMProviderOrNull: vi.fn(),
		getPMProvider: vi.fn(),
		filterImageMedia: vi.fn((refs) => refs.filter((ref) => ref.mimeType.startsWith('image/'))),
	};
});

import type { FetchContextParams } from '../../../../src/agents/definitions/contextSteps.js';
import { fetchPipelineSnapshotStep } from '../../../../src/agents/definitions/contextSteps.js';
import { getPMProvider, getPMProviderOrNull } from '../../../../src/pm/index.js';
import type { AgentInput, ProjectConfig } from '../../../../src/types/index.js';
import { createMockPMProvider } from '../../../helpers/mockPMProvider.js';

const mockGetPMProviderOrNull = vi.mocked(getPMProviderOrNull);
const mockGetPMProvider = vi.mocked(getPMProvider);
const mockProvider = createMockPMProvider();

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

function parseSummary(result: Awaited<ReturnType<typeof fetchPipelineSnapshotStep>>) {
	return JSON.parse(result[0].result as string);
}

describe('fetchPipelineSnapshotStep', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetPMProviderOrNull.mockReturnValue(mockProvider);
		mockGetPMProvider.mockReturnValue(mockProvider);
		mockProvider.listWorkItems.mockResolvedValue([]);
		mockProvider.getWorkItem.mockImplementation(async (id: string) => ({
			id,
			title: `Detailed ${id}`,
			url: `https://pm.test/${id}`,
			description: '',
			labels: [],
		}));
		mockProvider.getChecklists.mockResolvedValue([]);
		mockProvider.getAttachments.mockResolvedValue([]);
		mockProvider.getWorkItemComments.mockResolvedValue([]);
	});

	it('returns empty array when no PM provider', async () => {
		mockGetPMProviderOrNull.mockReturnValue(null);
		const result = await fetchPipelineSnapshotStep(makeParams({}, makeProject()));
		expect(result).toEqual([]);
	});

	it('returns empty array when no project config', async () => {
		const result = await fetchPipelineSnapshotStep(makeParams());
		expect(result).toEqual([]);
	});

	it('returns empty array when no lists configured', async () => {
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

	it('emits exactly one PipelineSnapshotSummary JSON injection', async () => {
		const result = await fetchPipelineSnapshotStep(makeParams({}, makeProject()));

		expect(result).toHaveLength(1);
		expect(result[0].toolName).toBe('PipelineSnapshotSummary');
		expect(result[0].toolName).not.toBe('PipelineSnapshot');
		expect(() => JSON.parse(result[0].result as string)).not.toThrow();
		expect(result[0].params).toEqual({
			comment: 'Pre-fetched structured pipeline snapshot across all statuses',
		});
	});

	it('uses unified provider.listWorkItems(undefined, { status }) for Linear projects', async () => {
		const linearProject = {
			id: 'test-project',
			orgId: 'test-org',
			name: 'Test Project',
			repo: 'owner/repo',
			baseBranch: 'main',
			pm: { type: 'linear' },
			linear: {
				teamId: 'team-1',
				statuses: {
					backlog: 'st-backlog',
					todo: 'st-todo',
					inProgress: 'st-inprog',
					inReview: 'st-inrev',
					done: 'st-done',
					merged: 'st-merged',
				},
				labels: {},
			},
		} as unknown as ProjectConfig;

		await fetchPipelineSnapshotStep(makeParams({}, linearProject));

		for (const status of ['backlog', 'todo', 'inProgress', 'inReview', 'done', 'merged']) {
			expect(mockProvider.listWorkItems).toHaveBeenCalledWith(undefined, { status });
		}
	});

	it('summarizes status counts, active count, and provider ordering', async () => {
		mockProvider.listWorkItems.mockImplementation(async (_containerId, filter) => {
			if (filter?.status === 'backlog') {
				return [
					{ id: 'MNG-1', title: 'First', url: 'https://pm.test/1', description: '', labels: [] },
					{ id: 'MNG-2', title: 'Second', url: 'https://pm.test/2', description: '', labels: [] },
				];
			}
			if (filter?.status === 'todo') {
				return [
					{ id: 'MNG-3', title: 'Todo', url: 'https://pm.test/3', description: '', labels: [] },
				];
			}
			if (filter?.status === 'inReview') {
				return [
					{
						id: 'MNG-4',
						title: 'Review',
						url: 'https://pm.test/4',
						description: '',
						labels: [],
					},
				];
			}
			return [];
		});

		const result = await fetchPipelineSnapshotStep(makeParams({}, makeProject()));
		const summary = parseSummary(result);

		expect(summary.schemaVersion).toBe(1);
		expect(summary.provider).toBe('trello');
		expect(summary.activeStatusKeys).toEqual(['todo', 'inProgress', 'inReview']);
		expect(summary.activePipelineCount).toBe(2);
		expect(summary.statuses.backlog).toMatchObject({
			statusKey: 'backlog',
			statusName: 'BACKLOG',
			count: 2,
			itemIds: ['MNG-1', 'MNG-2'],
		});
		expect(summary.statuses.todo.count).toBe(1);
		expect(summary.statuses.inReview.count).toBe(1);
	});

	it('populates structured item details from provider calls without formatted markdown parsing', async () => {
		mockProvider.listWorkItems.mockImplementation(async (_containerId, filter) => {
			if (filter?.status !== 'backlog') return [];
			return [
				{
					id: 'MNG-10',
					title: 'List title',
					url: 'https://pm.test/list',
					description: 'List description',
					labels: [{ id: 'l-list', name: 'List Label' }],
				},
			];
		});
		mockProvider.getWorkItem.mockResolvedValue({
			id: 'MNG-10',
			title: 'Detailed title',
			url: 'https://pm.test/detail',
			status: 'Backlog',
			statusId: 'state-backlog',
			description: 'Detailed description depends on MNG-123',
			labels: [{ id: 'l1', name: 'Feature', color: 'blue' }],
			inlineMedia: [
				{ url: 'https://pm.test/image.png', mimeType: 'image/png', source: 'description' },
			],
		});
		mockProvider.getChecklists.mockResolvedValue([
			{
				id: 'cl1',
				name: 'Acceptance',
				workItemId: 'MNG-10',
				items: [{ id: 'ci1', name: 'Requires API contract', complete: false }],
			},
		]);
		mockProvider.getAttachments.mockResolvedValue([
			{
				id: 'a1',
				name: 'spec.md',
				url: 'https://docs.test/spec',
				mimeType: 'text/markdown',
				bytes: 100,
				date: '2026-05-12T00:00:00.000Z',
			},
		]);
		mockProvider.getWorkItemComments.mockResolvedValue([
			{
				id: 'c1',
				author: { id: 'u1', name: 'Alice', username: 'alice' },
				date: '2026-05-12T00:00:00.000Z',
				text: 'Waiting for https://linear.app/issue/MNG-123',
			},
		]);

		const result = await fetchPipelineSnapshotStep(makeParams({}, makeProject()));
		const summary = parseSummary(result);
		const item = summary.itemsById['MNG-10'];

		expect(item).toMatchObject({
			id: 'MNG-10',
			title: 'Detailed title',
			url: 'https://pm.test/detail',
			statusKey: 'backlog',
			statusName: 'BACKLOG',
			providerStatus: 'Backlog',
			providerStatusId: 'state-backlog',
			description: 'Detailed description depends on MNG-123',
			labels: [{ id: 'l1', name: 'Feature', color: 'blue' }],
			checklists: [
				{
					id: 'cl1',
					name: 'Acceptance',
					items: [{ id: 'ci1', name: 'Requires API contract', complete: false }],
				},
			],
			comments: [
				{
					id: 'c1',
					authorName: 'Alice',
					text: 'Waiting for https://linear.app/issue/MNG-123',
				},
			],
			attachments: [{ id: 'a1', name: 'spec.md', url: 'https://docs.test/spec' }],
			mediaReferences: [
				{ url: 'https://pm.test/image.png', mimeType: 'image/png', source: 'description' },
			],
		});
		expect(JSON.stringify(item)).not.toContain('# Detailed title');
	});

	it('keeps DONE and MERGED compact without full detail fetches', async () => {
		mockProvider.listWorkItems.mockImplementation(async (_containerId, filter) => {
			if (filter?.status === 'done' || filter?.status === 'merged') {
				return [
					{
						id: `MNG-${filter.status}`,
						title: `${filter.status} title`,
						url: `https://pm.test/${filter.status}`,
						description: `${filter.status} list description`,
						labels: [{ id: 'l1', name: 'done-label' }],
					},
				];
			}
			return [];
		});

		const result = await fetchPipelineSnapshotStep(makeParams({}, makeProject()));
		const summary = parseSummary(result);

		expect(mockProvider.getWorkItem).not.toHaveBeenCalled();
		expect(summary.itemsById['MNG-done']).toMatchObject({
			id: 'MNG-done',
			title: 'done title',
			statusKey: 'done',
			statusName: 'DONE',
			checklists: [],
			comments: [],
		});
		expect(summary.itemsById['MNG-merged']).toMatchObject({
			id: 'MNG-merged',
			title: 'merged title',
			statusKey: 'merged',
			statusName: 'MERGED',
		});
	});

	it('represents provider list errors and item read errors in JSON', async () => {
		mockProvider.listWorkItems.mockImplementation(async (_containerId, filter) => {
			if (filter?.status === 'todo') throw new Error('List network error');
			if (filter?.status === 'backlog') {
				return [
					{ id: 'MNG-20', title: 'Broken', url: 'https://pm.test/20', description: '', labels: [] },
				];
			}
			return [];
		});
		mockProvider.getWorkItem.mockRejectedValue(new Error('Item read error'));

		const params = makeParams({}, makeProject());
		const result = await fetchPipelineSnapshotStep(params);
		const summary = parseSummary(result);

		expect(summary.statuses.todo.error).toBe('List network error');
		expect(summary.itemsById['MNG-20'].error).toBe('Item read error');
		expect(summary.errors).toEqual(
			expect.arrayContaining([
				{ statusKey: 'todo', message: 'List network error' },
				{ statusKey: 'backlog', itemId: 'MNG-20', message: 'Item read error' },
			]),
		);
		expect(params.logWriter).toHaveBeenCalledWith(
			'WARN',
			expect.stringContaining('Failed to fetch list'),
			expect.objectContaining({ error: 'List network error' }),
		);
	});

	it('extracts dependency signals from descriptions, comments, checklists, issue IDs, URLs, and keywords', async () => {
		mockProvider.listWorkItems.mockImplementation(async (_containerId, filter) => {
			if (filter?.status !== 'backlog') return [];
			return [
				{
					id: 'MNG-30',
					title: 'Blocked',
					url: 'https://pm.test/30',
					description: '',
					labels: [],
				},
			];
		});
		mockProvider.getWorkItem.mockResolvedValue({
			id: 'MNG-30',
			title: 'Blocked',
			url: 'https://pm.test/30',
			description: 'Blocked by MNG-123 after https://linear.app/issue/MNG-456',
			labels: [],
		});
		mockProvider.getChecklists.mockResolvedValue([
			{
				id: 'cl1',
				name: 'Tasks',
				workItemId: 'MNG-30',
				items: [{ id: 'ci1', name: 'Requires migration', complete: false }],
			},
		]);
		mockProvider.getWorkItemComments.mockResolvedValue([
			{
				id: 'c1',
				author: { id: 'u1', name: 'Bob', username: 'bob' },
				date: '2026-05-12T00:00:00.000Z',
				text: 'Waiting for auth rollout',
			},
			{
				id: 'c2',
				author: { id: 'u2', name: 'Eve', username: 'eve' },
				date: '2026-05-12T01:00:00.000Z',
				text: 'Depends on MNG-789',
			},
		]);

		const result = await fetchPipelineSnapshotStep(makeParams({}, makeProject()));
		const summary = parseSummary(result);
		const signals = summary.itemsById['MNG-30'].dependencySignals;

		expect(signals).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					sourceType: 'description',
					matches: expect.arrayContaining([
						'Blocked by',
						'MNG-123',
						'after',
						'https://linear.app/issue/MNG-456',
					]),
				}),
				expect.objectContaining({
					sourceType: 'checklist',
					sourceId: 'ci1',
					matches: expect.arrayContaining(['Requires']),
				}),
				expect.objectContaining({
					sourceType: 'comment',
					sourceId: 'c1',
					matches: expect.arrayContaining(['Waiting for']),
				}),
				expect.objectContaining({
					sourceType: 'comment',
					sourceId: 'c2',
					matches: expect.arrayContaining(['Depends on', 'MNG-789']),
				}),
			]),
		);
	});

	it('handles partially configured lists', async () => {
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
				},
				labels: {},
			},
		} as unknown as ProjectConfig;

		const result = await fetchPipelineSnapshotStep(makeParams({}, partialProject));
		const summary = parseSummary(result);

		expect(mockProvider.listWorkItems).toHaveBeenCalledTimes(2);
		expect(Object.keys(summary.statuses)).toEqual(['backlog', 'todo']);
		expect(result[0].description).toContain('2 statuses');
	});

	it('works with JIRA project config', async () => {
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
		expect(result[0].toolName).toBe('PipelineSnapshotSummary');
		expect(mockProvider.listWorkItems).toHaveBeenCalledTimes(6);
	});
});
