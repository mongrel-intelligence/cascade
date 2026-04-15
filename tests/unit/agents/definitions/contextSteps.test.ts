import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/pm/index.js', () => ({
	getPMProviderOrNull: vi.fn(),
	MAX_IMAGES_PER_WORK_ITEM: 10,
}));

vi.mock('../../../../src/gadgets/todo/storage.js', () => ({
	initTodoSession: vi.fn(),
	saveTodos: vi.fn(),
	getNextId: vi.fn((todos: unknown[]) => String(todos.length + 1)),
	formatTodoList: vi.fn(() => '📋 Todo List\n   Progress: 0/2 done, 0 in progress, 2 pending'),
}));

const mockTrelloDownload = vi.fn();
const mockJiraDownload = vi.fn();

vi.mock('../../../../src/trello/client.js', () => ({
	trelloClient: {
		downloadAttachment: mockTrelloDownload,
	},
}));

vi.mock('../../../../src/jira/client.js', () => ({
	jiraClient: {
		downloadAttachment: mockJiraDownload,
	},
}));

vi.mock('../../../../src/gadgets/pm/core/readWorkItem.js', () => ({
	readWorkItem: vi.fn(),
	readWorkItemWithMedia: vi.fn(),
}));

vi.mock('../../../../src/github/client.js', () => ({
	githubClient: {
		getPR: vi.fn(),
		getPRDiff: vi.fn(),
		getCheckSuiteStatus: vi.fn(),
	},
}));

import type { FetchContextParams } from '../../../../src/agents/definitions/contextSteps.js';
import {
	fetchPRContextStep,
	fetchWorkItemStep,
	prepopulateTodosStep,
} from '../../../../src/agents/definitions/contextSteps.js';
import { readWorkItemWithMedia } from '../../../../src/gadgets/pm/core/readWorkItem.js';
import { initTodoSession, saveTodos } from '../../../../src/gadgets/todo/storage.js';
import { githubClient } from '../../../../src/github/client.js';
import { getPMProviderOrNull } from '../../../../src/pm/index.js';
import type { AgentInput } from '../../../../src/types/index.js';

const mockGetPR = vi.mocked(githubClient.getPR);
const mockGetPRDiff = vi.mocked(githubClient.getPRDiff);
const mockGetCheckSuiteStatus = vi.mocked(githubClient.getCheckSuiteStatus);
const mockGetPMProviderOrNull = vi.mocked(getPMProviderOrNull);
const mockReadWorkItemWithMedia = vi.mocked(readWorkItemWithMedia);
const mockInitTodoSession = vi.mocked(initTodoSession);
const mockSaveTodos = vi.mocked(saveTodos);

function makeParams(input: Partial<AgentInput>): FetchContextParams {
	return {
		input: input as AgentInput,
		repoDir: '/tmp/repo',
		contextFiles: [],
		logWriter: vi.fn(),
	};
}

describe('prepopulateTodosStep', () => {
	it('returns empty array when no workItemId', async () => {
		const result = await prepopulateTodosStep(makeParams({}));
		expect(result).toEqual([]);
	});

	it('returns empty array when no PM provider', async () => {
		mockGetPMProviderOrNull.mockReturnValue(null);
		const result = await prepopulateTodosStep(makeParams({ workItemId: 'card-1' }));
		expect(result).toEqual([]);
	});

	it('returns empty array when no Implementation Steps checklist', async () => {
		const provider = {
			getChecklists: vi
				.fn()
				.mockResolvedValue([
					{ id: 'cl-1', name: 'Acceptance Criteria', workItemId: 'card-1', items: [] },
				]),
		};
		mockGetPMProviderOrNull.mockReturnValue(provider as never);

		const result = await prepopulateTodosStep(makeParams({ workItemId: 'card-1' }));
		expect(result).toEqual([]);
	});

	it('pre-populates from incomplete items, skips completed items', async () => {
		const provider = {
			getChecklists: vi.fn().mockResolvedValue([
				{
					id: 'cl-1',
					name: '📋 Implementation Steps',
					workItemId: 'card-1',
					items: [
						{ id: 'i1', name: 'Step 1 (done)', complete: true },
						{ id: 'i2', name: 'Step 2', complete: false },
						{ id: 'i3', name: 'Step 3', complete: false },
					],
				},
			]),
		};
		mockGetPMProviderOrNull.mockReturnValue(provider as never);

		const result = await prepopulateTodosStep(makeParams({ workItemId: 'card-1' }));

		expect(result).toHaveLength(1);
		expect(result[0].toolName).toBe('TodoUpsert');
		expect(result[0].description).toBe('Pre-populated 2 todos from Implementation Steps');
		expect(mockInitTodoSession).toHaveBeenCalledWith('card-1'); // workItemId value
		expect(mockSaveTodos).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({ content: 'Step 2', status: 'pending' }),
				expect.objectContaining({ content: 'Step 3', status: 'pending' }),
			]),
		);
	});

	it('handles emoji prefix in checklist name', async () => {
		const provider = {
			getChecklists: vi.fn().mockResolvedValue([
				{
					id: 'cl-1',
					name: '📋 Implementation Steps',
					workItemId: 'card-1',
					items: [{ id: 'i1', name: 'Step 1', complete: false }],
				},
			]),
		};
		mockGetPMProviderOrNull.mockReturnValue(provider as never);

		const result = await prepopulateTodosStep(makeParams({ workItemId: 'card-1' }));
		expect(result).toHaveLength(1);
	});

	it('returns correct ContextInjection format', async () => {
		const provider = {
			getChecklists: vi.fn().mockResolvedValue([
				{
					id: 'cl-1',
					name: 'Implementation Steps',
					workItemId: 'card-1',
					items: [{ id: 'i1', name: 'Do something', complete: false }],
				},
			]),
		};
		mockGetPMProviderOrNull.mockReturnValue(provider as never);

		const result = await prepopulateTodosStep(makeParams({ workItemId: 'card-1' }));

		expect(result[0]).toEqual({
			toolName: 'TodoUpsert',
			params: { comment: 'Pre-populated todos from Implementation Steps checklist' },
			result: expect.stringContaining('Do NOT delete or recreate these'),
			description: 'Pre-populated 1 todos from Implementation Steps',
		});
	});

	it('returns empty array and logs warning on PM provider error', async () => {
		const provider = {
			getChecklists: vi.fn().mockRejectedValue(new Error('PM error')),
		};
		mockGetPMProviderOrNull.mockReturnValue(provider as never);

		const params = makeParams({ workItemId: 'card-1' });
		const result = await prepopulateTodosStep(params);
		expect(result).toEqual([]);
		expect(params.logWriter).toHaveBeenCalledWith('WARN', 'prepopulateTodosStep failed', {
			workItemId: 'card-1',
			error: 'PM error',
		});
	});

	it('returns empty array when all items are completed', async () => {
		const provider = {
			getChecklists: vi.fn().mockResolvedValue([
				{
					id: 'cl-1',
					name: 'Implementation Steps',
					workItemId: 'card-1',
					items: [
						{ id: 'i1', name: 'Step 1', complete: true },
						{ id: 'i2', name: 'Step 2', complete: true },
					],
				},
			]),
		};
		mockGetPMProviderOrNull.mockReturnValue(provider as never);

		const result = await prepopulateTodosStep(makeParams({ workItemId: 'card-1' }));
		expect(result).toEqual([]);
	});
});

describe('fetchWorkItemStep', () => {
	beforeEach(() => {
		mockTrelloDownload.mockReset();
		mockJiraDownload.mockReset();
	});

	it('returns empty array when no workItemId', async () => {
		const result = await fetchWorkItemStep(makeParams({}));
		expect(result).toEqual([]);
	});

	it('returns empty array when readWorkItemWithMedia throws', async () => {
		mockReadWorkItemWithMedia.mockRejectedValue(new Error('fetch failed'));
		const result = await fetchWorkItemStep(makeParams({ workItemId: 'card-1' }));
		expect(result).toEqual([]);
	});

	it('returns ContextInjection without images when no media found', async () => {
		mockReadWorkItemWithMedia.mockResolvedValue({
			text: '# Card Title\n\nDescription',
			media: [],
		});
		mockGetPMProviderOrNull.mockReturnValue({ type: 'trello' } as never);

		const result = await fetchWorkItemStep(makeParams({ workItemId: 'card-1' }));

		expect(result).toHaveLength(1);
		expect(result[0].toolName).toBe('ReadWorkItem');
		expect(result[0].result).toBe('# Card Title\n\nDescription');
		expect(result[0].images).toBeUndefined();
	});

	it('downloads images and populates ContextInjection.images for trello provider', async () => {
		mockReadWorkItemWithMedia.mockResolvedValue({
			text: '# Card with image',
			media: [
				{
					url: 'https://trello.com/img.png',
					mimeType: 'image/png',
					altText: 'diagram',
					source: 'description',
				},
			],
		});
		mockGetPMProviderOrNull.mockReturnValue({ type: 'trello' } as never);
		mockTrelloDownload.mockResolvedValue({
			buffer: Buffer.from('fake-image-data'),
			mimeType: 'image/png',
		});

		const result = await fetchWorkItemStep(makeParams({ workItemId: 'card-1' }));

		expect(result).toHaveLength(1);
		expect(result[0].images).toHaveLength(1);
		expect(result[0].images?.[0]).toEqual({
			base64Data: Buffer.from('fake-image-data').toString('base64'),
			mimeType: 'image/png',
			altText: 'diagram',
		});
		expect(mockTrelloDownload).toHaveBeenCalledWith('https://trello.com/img.png');
	});

	it('uses jiraClient.downloadAttachment for jira provider', async () => {
		mockReadWorkItemWithMedia.mockResolvedValue({
			text: '# Jira issue',
			media: [
				{
					url: 'https://jira.example.com/img.jpeg',
					mimeType: 'image/jpeg',
					source: 'description',
				},
			],
		});
		mockGetPMProviderOrNull.mockReturnValue({ type: 'jira' } as never);
		mockJiraDownload.mockResolvedValue({
			buffer: Buffer.from('jira-image'),
			mimeType: 'image/jpeg',
		});

		const result = await fetchWorkItemStep(makeParams({ workItemId: 'jira-1' }));

		expect(result[0].images).toHaveLength(1);
		expect(mockJiraDownload).toHaveBeenCalledWith('https://jira.example.com/img.jpeg');
		expect(mockTrelloDownload).not.toHaveBeenCalled();
	});

	it('logs WARN and skips when download returns null, stripping query params from URL', async () => {
		mockReadWorkItemWithMedia.mockResolvedValue({
			text: '# Card',
			media: [
				{ url: 'https://trello.com/ok.png', mimeType: 'image/png', source: 'description' },
				{
					url: 'https://trello.com/fail.png?key=secret&token=abc',
					mimeType: 'image/png',
					source: 'description',
				},
			],
		});
		mockGetPMProviderOrNull.mockReturnValue({ type: 'trello' } as never);
		mockTrelloDownload
			.mockResolvedValueOnce({ buffer: Buffer.from('ok'), mimeType: 'image/png' })
			.mockResolvedValueOnce(null);

		const params = makeParams({ workItemId: 'card-1' });
		const result = await fetchWorkItemStep(params);

		// Only 1 successful image
		expect(result[0].images).toHaveLength(1);
		expect(result[0].images?.[0].base64Data).toBe(Buffer.from('ok').toString('base64'));

		// WARN for the null return, URL sanitized (no query params)
		expect(params.logWriter).toHaveBeenCalledWith(
			'WARN',
			'fetchWorkItemStep: image download returned null',
			{ url: 'https://trello.com/fail.png' },
		);
	});

	it('logs warning when download throws an exception, stripping query params from URL', async () => {
		mockReadWorkItemWithMedia.mockResolvedValue({
			text: '# Card',
			media: [
				{
					url: 'https://trello.com/err.png?key=secret&token=abc',
					mimeType: 'image/png',
					source: 'description',
				},
			],
		});
		mockGetPMProviderOrNull.mockReturnValue({ type: 'trello' } as never);
		mockTrelloDownload.mockRejectedValue(new Error('network failure'));

		const params = makeParams({ workItemId: 'card-1' });
		const result = await fetchWorkItemStep(params);

		expect(result[0].images).toBeUndefined();
		expect(params.logWriter).toHaveBeenCalledWith(
			'WARN',
			'fetchWorkItemStep: failed to download image',
			{ url: 'https://trello.com/err.png', error: 'network failure' },
		);
	});

	it('emits INFO logs before and after download with correct counts', async () => {
		mockReadWorkItemWithMedia.mockResolvedValue({
			text: '# Card',
			media: [
				{ url: 'https://trello.com/a.png', mimeType: 'image/png', source: 'description' },
				{ url: 'https://trello.com/b.png', mimeType: 'image/png', source: 'description' },
				{ url: 'https://trello.com/c.png', mimeType: 'image/png', source: 'description' },
			],
		});
		mockGetPMProviderOrNull.mockReturnValue({ type: 'trello' } as never);
		mockTrelloDownload
			.mockResolvedValueOnce({ buffer: Buffer.from('data'), mimeType: 'image/png' })
			.mockResolvedValueOnce(null) // returns null
			.mockRejectedValueOnce(new Error('timeout')); // throws

		const params = makeParams({ workItemId: 'card-1' });
		await fetchWorkItemStep(params);

		expect(params.logWriter).toHaveBeenCalledWith(
			'INFO',
			'fetchWorkItemStep: downloading work item images',
			{ workItemId: 'card-1', count: 3 },
		);
		expect(params.logWriter).toHaveBeenCalledWith(
			'INFO',
			'fetchWorkItemStep: image download complete',
			{ workItemId: 'card-1', attempted: 3, downloaded: 1, skipped: 2 },
		);
	});

	it('respects MAX_IMAGES_PER_WORK_ITEM limit', async () => {
		const manyMedia = Array.from({ length: 15 }, (_, i) => ({
			url: `https://trello.com/img${i}.png`,
			mimeType: 'image/png',
			source: 'description' as const,
		}));
		mockReadWorkItemWithMedia.mockResolvedValue({ text: '# Card', media: manyMedia });
		mockGetPMProviderOrNull.mockReturnValue({ type: 'trello' } as never);
		mockTrelloDownload.mockResolvedValue({ buffer: Buffer.from('data'), mimeType: 'image/png' });

		const result = await fetchWorkItemStep(makeParams({ workItemId: 'card-1' }));

		// MAX_IMAGES_PER_WORK_ITEM is mocked as 10
		expect(result[0].images).toHaveLength(10);
		expect(mockTrelloDownload).toHaveBeenCalledTimes(10);
	});
});

describe('fetchPRContextStep — compact diffs + SKIPPED FILES contract', () => {
	beforeEach(() => {
		mockGetPR.mockResolvedValue({
			number: 1092,
			title: 'Test PR',
			body: 'Description',
			state: 'open',
			htmlUrl: 'https://github.com/o/r/pull/1092',
			headRef: 'claude/cranky',
			headSha: 'abc123',
			baseRef: 'dev',
			merged: false,
			mergeable: true,
			user: { login: 'suda' },
		});
		mockGetCheckSuiteStatus.mockResolvedValue({
			totalCount: 0,
			checkRuns: [],
			allPassing: false,
		});
	});

	function makePRParams(): FetchContextParams {
		return makeParams({
			prNumber: 1092,
			repoFullName: 'o/r',
		});
	}

	it('injects compact diff context (not full file contents)', async () => {
		mockGetPRDiff.mockResolvedValue([
			{
				filename: 'src/a.ts',
				status: 'modified',
				additions: 5,
				deletions: 2,
				changes: 7,
				patch: '@@ -1,3 +1,5 @@\n context\n+added',
			},
			{
				filename: 'src/b.ts',
				status: 'added',
				additions: 10,
				deletions: 0,
				changes: 10,
				patch: '@@ -0,0 +1,10 @@\n+new',
			},
		]);

		const injections = await fetchPRContextStep(makePRParams());

		const diffInjection = injections.find((i) => i.description === 'Pre-fetched PR diff context');
		expect(diffInjection).toBeDefined();
		expect(diffInjection?.result as string).toContain('### src/a.ts (modified, +5 -2)');
		expect(diffInjection?.result as string).toContain('### src/b.ts (added, +10 -0)');
		// No per-file "Pre-fetched <path>" injections — that was the old shape.
		expect(injections.some((i) => (i.description as string).startsWith('Pre-fetched src/'))).toBe(
			false,
		);
	});

	it('injects a SKIPPED FILES section when any files are skipped', async () => {
		mockGetPRDiff.mockResolvedValue([
			{
				filename: 'src/a.ts',
				status: 'modified',
				additions: 1,
				deletions: 0,
				changes: 1,
				patch: '@@ -1 +1 @@\n+x',
			},
			{
				filename: 'legacy.ts',
				status: 'removed',
				additions: 0,
				deletions: 42,
				changes: 42,
				patch: undefined,
			},
		]);

		const injections = await fetchPRContextStep(makePRParams());

		const skipped = injections.find((i) => i.description === 'Skipped files');
		expect(skipped).toBeDefined();
		expect(skipped?.result as string).toContain('legacy.ts');
		expect(skipped?.result as string).toContain('deleted');
		expect(skipped?.result as string).toContain('gh pr diff 1092');
		expect(skipped?.result as string).toContain('Read');
	});

	it('does NOT inject a SKIPPED FILES section when nothing is skipped', async () => {
		mockGetPRDiff.mockResolvedValue([
			{
				filename: 'src/a.ts',
				status: 'modified',
				additions: 1,
				deletions: 0,
				changes: 1,
				patch: '@@ -1 +1 @@\n+x',
			},
		]);

		const injections = await fetchPRContextStep(makePRParams());

		const skipped = injections.find((i) => i.description === 'Skipped files');
		expect(skipped).toBeUndefined();
	});

	it('logs PR context prepared with included, skipped, and skipReasons map', async () => {
		mockGetPRDiff.mockResolvedValue([
			{
				filename: 'src/a.ts',
				status: 'modified',
				additions: 1,
				deletions: 0,
				changes: 1,
				patch: '@@ -1 +1 @@\n+x',
			},
			{
				filename: 'removed.ts',
				status: 'removed',
				additions: 0,
				deletions: 5,
				changes: 5,
				patch: undefined,
			},
			{
				filename: 'binary.png',
				status: 'added',
				additions: 0,
				deletions: 0,
				changes: 0,
				patch: undefined,
			},
		]);

		const params = makePRParams();
		await fetchPRContextStep(params);

		expect(params.logWriter).toHaveBeenCalledWith(
			'INFO',
			'PR context prepared',
			expect.objectContaining({
				included: 1,
				skipped: 2,
				skipReasons: expect.objectContaining({ deleted: 1, 'no-patch': 1 }),
			}),
		);
	});
});
