import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks before imports. The adapter reaches the client both via static
// imports (getContentNode, listAllProjectItems, getIssueComments,
// addCommentToIssue, moveProjectItemToStatus, updateComment) and via dynamic
// `await import()` (githubGraphQL, getViewer); vi.mock intercepts both.
const { mockClient } = vi.hoisted(() => ({
	mockClient: {
		getContentNode: vi.fn(),
		listAllProjectItems: vi.fn(),
		getIssueComments: vi.fn(),
		addCommentToIssue: vi.fn(),
		moveProjectItemToStatus: vi.fn(),
		updateComment: vi.fn(),
		resolveContentRepoLabelId: vi.fn(),
		addLabelsToContent: vi.fn(),
		removeLabelsFromContent: vi.fn(),
		resolveProjectItemId: vi.fn(),
		getRepositoryId: vi.fn(),
		createRepositoryIssue: vi.fn(),
		addContentToProject: vi.fn(),
		githubGraphQL: vi.fn(),
		getViewer: vi.fn(),
	},
}));

vi.mock('../../../../src/github-projects/client.js', () => mockClient);

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { hashChecklistItemId } from '../../../../src/pm/_shared/inline-checklist.js';
import type { GitHubProjectsConfig } from '../../../../src/pm/config.js';
import { GitHubProjectsPMProvider } from '../../../../src/pm/github-projects/adapter.js';
import { logger } from '../../../../src/utils/logging.js';

const config: GitHubProjectsConfig = {
	projectId: 'PVT_project',
	owner: 'octocat',
	ownerType: 'user',
	statuses: { todo: 'opt-todo', inProgress: 'opt-inprogress', done: 'opt-done' },
};

/** A content node as returned by `getContentNode` (Issue/PR resolved by content ID). */
function makeContentNode(overrides: {
	contentType?: 'issue' | 'pull_request';
	body?: string;
	statusName?: string;
	statusOptionId?: string;
}) {
	return {
		id: overrides.contentType === 'pull_request' ? 'PR_1' : 'I_1',
		number: 42,
		title: 'A work item',
		body: overrides.body ?? 'plain body',
		url: 'https://github.com/octocat/repo/issues/42',
		state: 'OPEN',
		type: overrides.contentType ?? 'issue',
		statusName: overrides.statusName ?? 'Todo',
		statusOptionId: overrides.statusOptionId ?? 'opt-todo',
	};
}

function makeProjectItem(overrides: {
	contentType?: 'issue' | 'pull_request';
	body?: string;
	statusName?: string;
	statusOptionId?: string;
	noContent?: boolean;
}) {
	return {
		id: 'PVTI_item',
		project: { id: 'PVT_project', number: 1 },
		content: overrides.noContent
			? undefined
			: {
					id: overrides.contentType === 'pull_request' ? 'PR_1' : 'I_1',
					number: 42,
					title: 'A work item',
					body: overrides.body ?? 'plain body',
					url: 'https://github.com/octocat/repo/issues/42',
					state: 'OPEN',
					type: overrides.contentType ?? 'issue',
				},
		fieldValues: {
			nodes: [
				{
					id: 'value-node-id',
					name: overrides.statusName ?? 'Todo',
					optionId: overrides.statusOptionId ?? 'opt-todo',
					field: { id: 'PVTSSF_status', name: 'Status' },
				},
			],
		},
	};
}

describe('GitHubProjectsPMProvider', () => {
	let provider: GitHubProjectsPMProvider;

	beforeEach(() => {
		vi.clearAllMocks();
		provider = new GitHubProjectsPMProvider(config);
	});

	it('has type "github-projects"', () => {
		expect(provider.type).toBe('github-projects');
	});

	describe('getWorkItem', () => {
		it('resolves the content node by content ID and uses the Status option ID as statusId', async () => {
			mockClient.getContentNode.mockResolvedValue(
				makeContentNode({ statusName: 'Todo', statusOptionId: 'opt-todo' }),
			);

			const item = await provider.getWorkItem('I_1');

			// Regression: the content node ID must be queried against the configured
			// project (not treated as a ProjectV2Item node ID).
			expect(mockClient.getContentNode).toHaveBeenCalledWith('I_1', 'PVT_project');
			expect(item.id).toBe('I_1');
			expect(item.title).toBe('A work item');
			expect(item.status).toBe('Todo');
			expect(item.statusId).toBe('opt-todo');
		});

		it('extracts inline markdown images into inlineMedia', async () => {
			mockClient.getContentNode.mockResolvedValue(
				makeContentNode({
					body: 'Here is a screenshot ![shot](https://user-images.githubusercontent.com/a.png)',
				}),
			);

			const item = await provider.getWorkItem('I_1');

			expect(item.inlineMedia).toBeDefined();
			expect(item.inlineMedia).toHaveLength(1);
			expect(item.inlineMedia?.[0].url).toBe('https://user-images.githubusercontent.com/a.png');
		});

		it('leaves inlineMedia undefined when the body has no images', async () => {
			mockClient.getContentNode.mockResolvedValue(makeContentNode({ body: 'no images here' }));
			const item = await provider.getWorkItem('I_1');
			expect(item.inlineMedia).toBeUndefined();
		});

		it('propagates the client error when the content node is not an Issue/PR', async () => {
			mockClient.getContentNode.mockRejectedValue(
				new Error('did not resolve to an Issue or PullRequest'),
			);
			await expect(provider.getWorkItem('I_1')).rejects.toThrow(/did not resolve/);
		});
	});

	describe('updateWorkItem', () => {
		it('uses the updateIssue mutation for Issue-backed items', async () => {
			mockClient.getContentNode.mockResolvedValue(makeContentNode({ contentType: 'issue' }));

			await provider.updateWorkItem('I_1', { title: 'New title' });

			expect(mockClient.githubGraphQL).toHaveBeenCalledTimes(1);
			const [mutation, vars] = mockClient.githubGraphQL.mock.calls[0];
			expect(mutation).toContain('updateIssue');
			expect(mutation).not.toContain('updatePullRequest');
			expect(vars).toEqual({ id: 'I_1', title: 'New title' });
		});

		it('uses the updatePullRequest mutation for PR-backed items (regression: isPR must resolve)', async () => {
			mockClient.getContentNode.mockResolvedValue(makeContentNode({ contentType: 'pull_request' }));

			await provider.updateWorkItem('PR_1', { description: 'New body' });

			expect(mockClient.githubGraphQL).toHaveBeenCalledTimes(1);
			const [mutation, vars] = mockClient.githubGraphQL.mock.calls[0];
			expect(mutation).toContain('updatePullRequest');
			expect(vars).toEqual({ id: 'PR_1', body: 'New body' });
		});

		it('updates both title and body when both are provided', async () => {
			mockClient.getContentNode.mockResolvedValue(makeContentNode({ contentType: 'issue' }));
			await provider.updateWorkItem('I_1', { title: 'T', description: 'B' });
			expect(mockClient.githubGraphQL).toHaveBeenCalledTimes(2);
		});
	});

	describe('addComment', () => {
		it('comments directly on the content (Issue/PR) node ID without a project-item lookup', async () => {
			mockClient.addCommentToIssue.mockResolvedValue('comment-node-1');

			const commentId = await provider.addComment('I_1', 'hello');

			expect(mockClient.addCommentToIssue).toHaveBeenCalledWith('I_1', 'hello');
			expect(mockClient.getContentNode).not.toHaveBeenCalled();
			expect(commentId).toBe('comment-node-1');
		});
	});

	describe('moveWorkItem', () => {
		it('maps a CASCADE status key to its configured option ID (PVTI_ ID used directly)', async () => {
			await provider.moveWorkItem('PVTI_item', 'done' as never);
			expect(mockClient.resolveProjectItemId).not.toHaveBeenCalled();
			expect(mockClient.moveProjectItemToStatus).toHaveBeenCalledWith(
				'PVT_project',
				'PVTI_item',
				'opt-done',
			);
		});

		it('passes an unmapped destination through unchanged', async () => {
			await provider.moveWorkItem('PVTI_item', 'opt-raw' as never);
			expect(mockClient.moveProjectItemToStatus).toHaveBeenCalledWith(
				'PVT_project',
				'PVTI_item',
				'opt-raw',
			);
		});

		it('resolves the ProjectV2Item ID when given a content (Issue) node ID', async () => {
			mockClient.resolveProjectItemId.mockResolvedValue('PVTI_resolved');

			await provider.moveWorkItem('I_1', 'done' as never);

			expect(mockClient.resolveProjectItemId).toHaveBeenCalledWith('I_1', 'PVT_project');
			expect(mockClient.moveProjectItemToStatus).toHaveBeenCalledWith(
				'PVT_project',
				'PVTI_resolved',
				'opt-done',
			);
		});

		it('throws when the content node is not part of the configured project', async () => {
			mockClient.resolveProjectItemId.mockResolvedValue(null);
			await expect(provider.moveWorkItem('I_1', 'done' as never)).rejects.toThrow(
				/item not found for content I_1/,
			);
			expect(mockClient.moveProjectItemToStatus).not.toHaveBeenCalled();
		});
	});

	describe('listWorkItems', () => {
		it('lists only items whose Status option ID matches the CASCADE key, keyed by content node ID', async () => {
			mockClient.listAllProjectItems.mockResolvedValue([
				makeProjectItem({ statusName: 'Todo', statusOptionId: 'opt-todo' }),
				makeProjectItem({ statusName: 'Done', statusOptionId: 'opt-done' }),
			]);

			const items = await provider.listWorkItems(undefined, { status: 'todo' });

			expect(mockClient.listAllProjectItems).toHaveBeenCalledWith('PVT_project');
			expect(items).toHaveLength(1);
			// Identity is the *content* node ID (matches the capacity-gate exclusion filter).
			expect(items[0].id).toBe('I_1');
			expect(items[0].statusId).toBe('opt-todo');
			expect(items[0].status).toBe('Todo');
		});

		it('lists every item when no status filter is given', async () => {
			mockClient.listAllProjectItems.mockResolvedValue([
				makeProjectItem({ statusOptionId: 'opt-todo' }),
				makeProjectItem({ statusOptionId: 'opt-done' }),
			]);
			const items = await provider.listWorkItems(undefined);
			expect(items).toHaveLength(2);
		});

		it('returns [] for a known CASCADE status key with no configured mapping (no API call)', async () => {
			// 'backlog' is a known CASCADE key but absent from config.statuses.
			await expect(provider.listWorkItems(undefined, { status: 'backlog' })).resolves.toEqual([]);
			expect(mockClient.listAllProjectItems).not.toHaveBeenCalled();
		});

		it('drops draft items with no linked content', async () => {
			mockClient.listAllProjectItems.mockResolvedValue([
				makeProjectItem({ statusOptionId: 'opt-todo' }),
				makeProjectItem({ noContent: true }),
			]);
			const items = await provider.listWorkItems(undefined, { status: 'todo' });
			expect(items).toHaveLength(1);
			expect(items[0].id).toBe('I_1');
		});

		it('coalesces a concurrent capacity-gate burst into a single board pagination', async () => {
			mockClient.listAllProjectItems.mockResolvedValue([
				makeProjectItem({ statusName: 'Todo', statusOptionId: 'opt-todo' }),
				makeProjectItem({ statusName: 'In Progress', statusOptionId: 'opt-inprogress' }),
			]);

			// Mirror `isActivePipelineOverCapacity`: three concurrent status queries.
			const [todo, inProgress, inReview] = await Promise.all([
				provider.listWorkItems(undefined, { status: 'todo' }),
				provider.listWorkItems(undefined, { status: 'inProgress' }),
				provider.listWorkItems(undefined, { status: 'inReview' }),
			]);

			// A single pagination served both mapped concurrent calls (down from 3).
			expect(mockClient.listAllProjectItems).toHaveBeenCalledTimes(1);
			expect(todo).toHaveLength(1);
			expect(inProgress).toHaveLength(1);
			// 'inReview' is unmapped in config.statuses → resolves to null → [] with no fetch.
			expect(inReview).toHaveLength(0);
		});

		it('re-fetches on a later non-concurrent call (in-flight coalescing, not a stale cache)', async () => {
			mockClient.listAllProjectItems.mockResolvedValue([
				makeProjectItem({ statusOptionId: 'opt-todo' }),
			]);
			await provider.listWorkItems(undefined, { status: 'todo' });
			await provider.listWorkItems(undefined, { status: 'todo' });
			expect(mockClient.listAllProjectItems).toHaveBeenCalledTimes(2);
		});
	});

	describe('getWorkItemComments', () => {
		it('maps comments and extracts inline media from bodies', async () => {
			mockClient.getIssueComments.mockResolvedValue([
				{
					id: 'IC_1',
					body: 'Looks good ![shot](https://user-images.githubusercontent.com/a.png)',
					createdAt: '2026-07-01T00:00:00Z',
					updatedAt: '2026-07-02T00:00:00Z',
					author: { login: 'octocat', id: 'U_1', name: 'The Octocat' },
				},
				{
					id: 'IC_2',
					body: 'no images',
					createdAt: '2026-07-03T00:00:00Z',
					author: { login: 'hubot' },
				},
			]);

			const comments = await provider.getWorkItemComments('I_1');

			expect(mockClient.getIssueComments).toHaveBeenCalledWith('I_1');
			expect(comments).toHaveLength(2);

			expect(comments[0].id).toBe('IC_1');
			expect(comments[0].text).toContain('Looks good');
			expect(comments[0].author).toEqual({ id: 'U_1', name: 'The Octocat', username: 'octocat' });
			expect(comments[0].inlineMedia).toHaveLength(1);
			expect(comments[0].createdAt).toBe('2026-07-01T00:00:00Z');
			expect(comments[0].updatedAt).toBe('2026-07-02T00:00:00Z');

			// Bot/actor author without a User id/name falls back to login.
			expect(comments[1].author).toEqual({ id: '', name: 'hubot', username: 'hubot' });
			expect(comments[1].inlineMedia).toBeUndefined();
		});

		it('returns [] when the content node has no comments', async () => {
			mockClient.getIssueComments.mockResolvedValue([]);
			await expect(provider.getWorkItemComments('I_1')).resolves.toEqual([]);
		});
	});

	describe('labels', () => {
		it('addLabel resolves a name to a repo label ID and adds it to the content node', async () => {
			mockClient.resolveContentRepoLabelId.mockResolvedValue('LA_processing');

			await provider.addLabel('I_1', 'processing' as never);

			expect(mockClient.resolveContentRepoLabelId).toHaveBeenCalledWith('I_1', 'processing');
			expect(mockClient.addLabelsToContent).toHaveBeenCalledWith('I_1', ['LA_processing']);
		});

		it('removeLabel resolves the name and removes it', async () => {
			mockClient.resolveContentRepoLabelId.mockResolvedValue('LA_processing');

			await provider.removeLabel('I_1', 'processing' as never);

			expect(mockClient.removeLabelsFromContent).toHaveBeenCalledWith('I_1', ['LA_processing']);
		});

		it('uses a GitHub label node ID (LA_…) directly without a name lookup', async () => {
			await provider.addLabel('I_1', 'LA_preresolved' as never);

			expect(mockClient.resolveContentRepoLabelId).not.toHaveBeenCalled();
			expect(mockClient.addLabelsToContent).toHaveBeenCalledWith('I_1', ['LA_preresolved']);
		});

		it('skips (no mutation) when the label does not exist in the content repo', async () => {
			mockClient.resolveContentRepoLabelId.mockResolvedValue(null);

			await provider.addLabel('I_1', 'nonexistent' as never);

			expect(mockClient.addLabelsToContent).not.toHaveBeenCalled();
		});
	});

	describe('createWorkItem', () => {
		it('creates an Issue in the project repo and adds it to the project', async () => {
			const withRepo = new GitHubProjectsPMProvider(config, 'octocat/repo');
			mockClient.getRepositoryId.mockResolvedValue('R_repo');
			mockClient.createRepositoryIssue.mockResolvedValue({
				id: 'I_new',
				number: 7,
				url: 'https://github.com/octocat/repo/issues/7',
			});
			mockClient.addContentToProject.mockResolvedValue('PVTI_new');

			const item = await withRepo.createWorkItem({
				containerId: 'PVT_project',
				title: 'Alert: boom',
				description: 'details',
			});

			expect(mockClient.getRepositoryId).toHaveBeenCalledWith('octocat', 'repo');
			expect(mockClient.createRepositoryIssue).toHaveBeenCalledWith(
				'R_repo',
				'Alert: boom',
				'details',
			);
			expect(mockClient.addContentToProject).toHaveBeenCalledWith('PVT_project', 'I_new');
			// Identity is the *content* (Issue) node ID, consistent with the rest of the path.
			expect(item.id).toBe('I_new');
			expect(item.url).toBe('https://github.com/octocat/repo/issues/7');
		});

		it('applies requested labels to the created Issue', async () => {
			const withRepo = new GitHubProjectsPMProvider(config, 'octocat/repo');
			mockClient.getRepositoryId.mockResolvedValue('R_repo');
			mockClient.createRepositoryIssue.mockResolvedValue({
				id: 'I_new',
				number: 7,
				url: 'https://github.com/octocat/repo/issues/7',
			});
			mockClient.addContentToProject.mockResolvedValue('PVTI_new');
			mockClient.resolveContentRepoLabelId.mockResolvedValue('LA_bug');

			await withRepo.createWorkItem({
				containerId: 'PVT_project',
				title: 't',
				labels: ['bug'],
			});

			expect(mockClient.resolveContentRepoLabelId).toHaveBeenCalledWith('I_new', 'bug');
			expect(mockClient.addLabelsToContent).toHaveBeenCalledWith('I_new', ['LA_bug']);
		});

		it('falls back to the configured project when containerId is empty', async () => {
			const withRepo = new GitHubProjectsPMProvider(config, 'octocat/repo');
			mockClient.getRepositoryId.mockResolvedValue('R_repo');
			mockClient.createRepositoryIssue.mockResolvedValue({ id: 'I_new', number: 7, url: 'u' });
			mockClient.addContentToProject.mockResolvedValue('PVTI_new');

			await withRepo.createWorkItem({ containerId: '', title: 't' });

			expect(mockClient.addContentToProject).toHaveBeenCalledWith('PVT_project', 'I_new');
		});

		it('throws an actionable error when the project has no SCM repo configured', async () => {
			// `provider` (from beforeEach) is constructed without a repo.
			await expect(
				provider.createWorkItem({ containerId: 'PVT_project', title: 't' }),
			).rejects.toThrow(/requires the project to have an SCM repository/i);
			expect(mockClient.createRepositoryIssue).not.toHaveBeenCalled();
		});
	});

	describe('checklists (inline markdown in the content body)', () => {
		/** Extract the `body` written by the single githubGraphQL updateIssue/PR call. */
		function lastWrittenBody(): string {
			const calls = mockClient.githubGraphQL.mock.calls;
			expect(calls.length).toBeGreaterThan(0);
			return calls[calls.length - 1][1].body as string;
		}

		it('getChecklists parses inline `### {name}` + checkbox rows from the body', async () => {
			mockClient.getContentNode.mockResolvedValue(
				makeContentNode({
					body: 'Intro prose\n\n### Implementation Steps\n- [x] first\n- [ ] second',
				}),
			);

			const checklists = await provider.getChecklists('I_1');

			expect(checklists).toHaveLength(1);
			expect(checklists[0].name).toBe('Implementation Steps');
			expect(checklists[0].workItemId).toBe('I_1');
			expect(checklists[0].items).toEqual([
				{ id: expect.any(String), name: 'first', complete: true },
				{ id: expect.any(String), name: 'second', complete: false },
			]);
		});

		it('createChecklist appends an empty section to the Issue body via updateIssue', async () => {
			mockClient.getContentNode.mockResolvedValue(makeContentNode({ body: 'Existing body' }));

			const checklist = await provider.createChecklist('I_1', 'Acceptance Criteria');

			expect(checklist.name).toBe('Acceptance Criteria');
			expect(checklist.workItemId).toBe('I_1');
			const [mutation] = mockClient.githubGraphQL.mock.calls[0];
			expect(mutation).toContain('updateIssue');
			expect(lastWrittenBody()).toContain('### Acceptance Criteria');
		});

		it('createChecklistWithItems writes the section and all rows in one body mutation', async () => {
			mockClient.getContentNode.mockResolvedValue(makeContentNode({ body: '' }));

			const checklist = await provider.createChecklistWithItems('I_1', 'Steps', [
				{ name: 'do A', checked: true },
				{ name: 'do B' },
			]);

			expect(checklist.items).toEqual([
				{ id: expect.any(String), name: 'do A', complete: true },
				{ id: expect.any(String), name: 'do B', complete: false },
			]);
			expect(mockClient.githubGraphQL).toHaveBeenCalledTimes(1);
			const body = lastWrittenBody();
			expect(body).toContain('### Steps');
			expect(body).toContain('- [x] do A');
			expect(body).toContain('- [ ] do B');
		});

		it('createChecklistWithItems uses the updatePullRequest mutation for PR-backed items', async () => {
			mockClient.getContentNode.mockResolvedValue(
				makeContentNode({ contentType: 'pull_request', body: '' }),
			);

			await provider.createChecklistWithItems('PR_1', 'Steps', [{ name: 'x' }]);

			const [mutation] = mockClient.githubGraphQL.mock.calls[0];
			expect(mutation).toContain('updatePullRequest');
			expect(mutation).not.toContain('updateIssue');
		});

		it('addChecklistItem resolves the section by its hashed ID and upserts a row', async () => {
			mockClient.getContentNode.mockResolvedValue(makeContentNode({ body: '' }));
			const { id: checklistId } = await provider.createChecklist('I_1', 'Steps');
			// createChecklist wrote the empty section; the next read must reflect it.
			mockClient.getContentNode.mockResolvedValue(makeContentNode({ body: '### Steps' }));

			await provider.addChecklistItem(checklistId, 'newly added', false);

			expect(lastWrittenBody()).toContain('- [ ] newly added');
		});

		it('addChecklistItem throws on an unparseable checklist ID', async () => {
			await expect(provider.addChecklistItem('not-an-inline-id', 'x')).rejects.toThrow(
				/Invalid GitHub Projects checklist ID/,
			);
		});

		it('updateChecklistItem toggles a row to checked', async () => {
			mockClient.getContentNode.mockResolvedValue(
				makeContentNode({ body: '### Steps\n- [ ] toggle me' }),
			);
			const itemId = hashChecklistItemId('Steps', 'toggle me');

			await provider.updateChecklistItem('I_1', itemId, true);

			expect(lastWrittenBody()).toContain('- [x] toggle me');
		});

		it('deleteChecklistItem removes a row from the section', async () => {
			mockClient.getContentNode.mockResolvedValue(
				makeContentNode({ body: '### Steps\n- [ ] keep\n- [ ] remove me' }),
			);
			const itemId = hashChecklistItemId('Steps', 'remove me');

			await provider.deleteChecklistItem('I_1', itemId);

			const body = lastWrittenBody();
			expect(body).toContain('- [ ] keep');
			expect(body).not.toContain('remove me');
		});

		it('does not write when the mutation is a no-op (idempotent re-toggle)', async () => {
			mockClient.getContentNode.mockResolvedValue(
				makeContentNode({ body: '### Steps\n- [x] already done' }),
			);
			const itemId = hashChecklistItemId('Steps', 'already done');

			await provider.updateChecklistItem('I_1', itemId, true);

			expect(mockClient.githubGraphQL).not.toHaveBeenCalled();
		});
	});

	describe('getAuthenticatedUser', () => {
		it('maps the viewer to { id, name, username }', async () => {
			mockClient.getViewer.mockResolvedValue({ id: 'U_1', login: 'octocat', name: 'The Octocat' });

			const user = await provider.getAuthenticatedUser();

			expect(user).toEqual({ id: 'U_1', name: 'The Octocat', username: 'octocat' });
		});

		it('falls back to login when the viewer has no display name', async () => {
			mockClient.getViewer.mockResolvedValue({ id: 'U_1', login: 'octocat' });
			const user = await provider.getAuthenticatedUser();
			expect(user.name).toBe('octocat');
		});
	});

	describe('getWorkItemUrl', () => {
		it('returns a resolving user-scoped Projects URL (correct users/ segment, no PVT_ node id)', () => {
			// The content node ID can't be turned into an item-specific URL
			// synchronously; the fallback must at least resolve and be well-shaped.
			expect(provider.getWorkItemUrl('I_content')).toBe(
				'https://github.com/users/octocat/projects',
			);
		});

		it('uses the orgs/ segment for organization-owned projects', () => {
			const orgProvider = new GitHubProjectsPMProvider({ ...config, ownerType: 'organization' });
			expect(orgProvider.getWorkItemUrl('I_content')).toBe(
				'https://github.com/orgs/octocat/projects',
			);
		});
	});

	describe('updateComment', () => {
		it('delegates directly to the client updateComment call', async () => {
			await provider.updateComment('I_1', 'IC_1', 'edited text');

			expect(mockClient.updateComment).toHaveBeenCalledWith('IC_1', 'edited text');
		});
	});

	describe('addChecklistItem — checklist section not found', () => {
		it('throws when the parsed checklist ID no longer matches a section in the body', async () => {
			const { buildChecklistId } = await import('../../../../src/pm/_shared/inline-checklist.js');
			const checklistId = buildChecklistId('I_1', 'Missing Section');
			mockClient.getContentNode.mockResolvedValue(
				makeContentNode({ body: '### Some Other Section\n- [ ] unrelated' }),
			);

			await expect(provider.addChecklistItem(checklistId, 'new item')).rejects.toThrow(
				`Checklist not found in description: ${checklistId}`,
			);
		});
	});

	describe('getAttachments', () => {
		it('returns an empty list (inline pastes are handled by extractMarkdownImages, not attachments)', async () => {
			await expect(provider.getAttachments('I_1')).resolves.toEqual([]);
		});
	});

	describe('addAttachment', () => {
		it('logs a not-implemented warning and does not throw', async () => {
			await expect(
				provider.addAttachment('I_1', 'https://example.com/a.png', 'a.png'),
			).resolves.toBeUndefined();
			expect(logger.warn).toHaveBeenCalledWith('[GitHubProjects] addAttachment not implemented');
		});
	});

	describe('addAttachmentFile', () => {
		it('logs a not-implemented warning and does not throw', async () => {
			await expect(
				provider.addAttachmentFile('I_1', Buffer.from('data'), 'a.png', 'image/png'),
			).resolves.toBeUndefined();
			expect(logger.warn).toHaveBeenCalledWith(
				'[GitHubProjects] addAttachmentFile not implemented',
			);
		});
	});

	describe('getCustomFieldNumber', () => {
		it('returns 0 (custom fields are not implemented)', async () => {
			await expect(provider.getCustomFieldNumber('I_1', 'field-1')).resolves.toBe(0);
		});
	});

	describe('updateCustomFieldNumber', () => {
		it('logs a not-implemented warning with the field ID and does not throw', async () => {
			await expect(provider.updateCustomFieldNumber('I_1', 'field-1', 42)).resolves.toBeUndefined();
			expect(logger.warn).toHaveBeenCalledWith(
				'[GitHubProjects] updateCustomFieldNumber not implemented',
				{ fieldId: 'field-1' },
			);
		});
	});

	describe('linkPR', () => {
		it('is a no-op that logs at debug level', async () => {
			await expect(
				provider.linkPR('I_1', 'https://github.com/octocat/repo/pull/1', 'A PR'),
			).resolves.toBeUndefined();
			expect(logger.debug).toHaveBeenCalledWith(
				'[GitHubProjects] linkPR is a no-op; PRs are linked by being in the project',
			);
		});
	});
});
