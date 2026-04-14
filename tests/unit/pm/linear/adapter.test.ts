import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetIssue = vi.fn();
const mockGetIssueComments = vi.fn();
const mockCreateComment = vi.fn();
const mockUpdateComment = vi.fn();
const mockCreateIssue = vi.fn();
const mockUpdateIssue = vi.fn();
const mockUpdateIssueState = vi.fn();
const mockListIssues = vi.fn();
const mockAddLabel = vi.fn();
const mockRemoveLabel = vi.fn();
const mockGetAttachments = vi.fn();
const mockCreateAttachment = vi.fn();
const mockGetMe = vi.fn();

vi.mock('../../../../src/linear/client.js', () => ({
	linearClient: {
		getIssue: (...args: unknown[]) => mockGetIssue(...args),
		getIssueComments: (...args: unknown[]) => mockGetIssueComments(...args),
		createComment: (...args: unknown[]) => mockCreateComment(...args),
		updateComment: (...args: unknown[]) => mockUpdateComment(...args),
		createIssue: (...args: unknown[]) => mockCreateIssue(...args),
		updateIssue: (...args: unknown[]) => mockUpdateIssue(...args),
		updateIssueState: (...args: unknown[]) => mockUpdateIssueState(...args),
		listIssues: (...args: unknown[]) => mockListIssues(...args),
		addLabel: (...args: unknown[]) => mockAddLabel(...args),
		removeLabel: (...args: unknown[]) => mockRemoveLabel(...args),
		getAttachments: (...args: unknown[]) => mockGetAttachments(...args),
		createAttachment: (...args: unknown[]) => mockCreateAttachment(...args),
		getMe: (...args: unknown[]) => mockGetMe(...args),
	},
}));

import { LinearPMProvider } from '../../../../src/pm/linear/adapter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultConfig = {
	teamId: 'team-abc',
	statuses: {
		backlog: 'state-backlog',
		inProgress: 'state-in-progress',
		inReview: 'state-in-review',
		done: 'state-done',
		merged: 'state-merged',
		cancelled: 'state-cancelled',
	},
	labels: {
		processing: 'label-processing-id',
	},
};

function makeIssue(overrides: Record<string, unknown> = {}) {
	return {
		id: 'issue-uuid',
		identifier: 'TEAM-1',
		title: 'Test Issue',
		description: 'A description',
		priority: 0,
		priorityLabel: 'No priority',
		state: { id: 'state-backlog', name: 'Backlog', type: 'backlog', color: '#ccc' },
		team: { id: 'team-abc', name: 'Team ABC', key: 'TEAM', description: null },
		assignee: null,
		labels: [],
		url: 'https://linear.app/org/issue/TEAM-1',
		createdAt: '2024-01-01T00:00:00Z',
		updatedAt: '2024-01-01T00:00:00Z',
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LinearPMProvider', () => {
	let provider: LinearPMProvider;

	beforeEach(() => {
		provider = new LinearPMProvider(defaultConfig);
		vi.clearAllMocks();
	});

	it('has type "linear"', () => {
		expect(provider.type).toBe('linear');
	});

	// =========================================================================
	// getWorkItem
	// =========================================================================
	describe('getWorkItem', () => {
		it('maps a Linear issue to a WorkItem', async () => {
			mockGetIssue.mockResolvedValue(
				makeIssue({
					labels: [{ id: 'label-1', name: 'Bug', color: '#f00', description: null }],
				}),
			);

			const result = await provider.getWorkItem('issue-uuid');

			expect(mockGetIssue).toHaveBeenCalledWith('issue-uuid');
			expect(result.id).toBe('TEAM-1'); // uses identifier
			expect(result.title).toBe('Test Issue');
			expect(result.description).toBe('A description');
			expect(result.url).toBe('https://linear.app/org/issue/TEAM-1');
			expect(result.status).toBe('Backlog');
			expect(result.labels).toHaveLength(1);
			expect(result.labels[0]).toEqual({ id: 'label-1', name: 'Bug', color: '#f00' });
		});

		it('uses id when identifier is empty', async () => {
			mockGetIssue.mockResolvedValue(makeIssue({ identifier: '' }));
			const result = await provider.getWorkItem('issue-uuid');
			expect(result.id).toBe('issue-uuid');
		});

		it('returns empty string for null description', async () => {
			mockGetIssue.mockResolvedValue(makeIssue({ description: null }));
			const result = await provider.getWorkItem('issue-uuid');
			expect(result.description).toBe('');
		});
	});

	// =========================================================================
	// getWorkItemComments
	// =========================================================================
	describe('getWorkItemComments', () => {
		it('maps Linear comments to WorkItemComment[]', async () => {
			mockGetIssueComments.mockResolvedValue([
				{
					id: 'c1',
					body: 'Hello world',
					createdAt: '2024-01-02T00:00:00Z',
					updatedAt: '2024-01-02T00:00:00Z',
					issueId: 'issue-uuid',
					user: {
						id: 'u1',
						name: 'Alice',
						email: 'alice@example.com',
						displayName: 'Alice Smith',
						avatarUrl: null,
						active: true,
					},
				},
			]);

			const result = await provider.getWorkItemComments('issue-uuid');

			expect(result).toHaveLength(1);
			expect(result[0].id).toBe('c1');
			expect(result[0].text).toBe('Hello world');
			expect(result[0].author.id).toBe('u1');
			expect(result[0].author.name).toBe('Alice Smith');
			expect(result[0].author.username).toBe('alice@example.com');
		});

		it('handles comments with no user', async () => {
			mockGetIssueComments.mockResolvedValue([
				{
					id: 'c2',
					body: 'Bot comment',
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z',
					issueId: 'issue-uuid',
					user: null,
				},
			]);

			const result = await provider.getWorkItemComments('issue-uuid');

			expect(result[0].author.id).toBe('');
			expect(result[0].author.name).toBe('');
			expect(result[0].author.username).toBe('');
		});
	});

	// =========================================================================
	// updateWorkItem
	// =========================================================================
	describe('updateWorkItem', () => {
		it('calls updateIssue with title and description', async () => {
			mockUpdateIssue.mockResolvedValue(makeIssue());
			await provider.updateWorkItem('issue-uuid', { title: 'New title', description: 'New desc' });
			expect(mockUpdateIssue).toHaveBeenCalledWith('issue-uuid', {
				title: 'New title',
				description: 'New desc',
			});
		});
	});

	// =========================================================================
	// addComment
	// =========================================================================
	describe('addComment', () => {
		it('creates a comment and returns its id', async () => {
			mockCreateComment.mockResolvedValue({ id: 'comment-new', body: 'hi' });
			const result = await provider.addComment('issue-uuid', 'hi there');
			expect(mockCreateComment).toHaveBeenCalledWith('issue-uuid', 'hi there');
			expect(result).toBe('comment-new');
		});
	});

	// =========================================================================
	// updateComment
	// =========================================================================
	describe('updateComment', () => {
		it('updates comment by commentId (not issueId)', async () => {
			mockUpdateComment.mockResolvedValue({ id: 'c1', body: 'updated' });
			await provider.updateComment('issue-uuid', 'c1', 'updated body');
			expect(mockUpdateComment).toHaveBeenCalledWith('c1', 'updated body');
		});
	});

	// =========================================================================
	// createWorkItem
	// =========================================================================
	describe('createWorkItem', () => {
		it('creates an issue in the given team', async () => {
			mockCreateIssue.mockResolvedValue(makeIssue({ identifier: 'TEAM-2', title: 'New Story' }));
			mockUpdateIssueState.mockResolvedValue(makeIssue());

			const result = await provider.createWorkItem({
				containerId: 'team-abc',
				title: 'New Story',
				description: 'A story',
			});

			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({ teamId: 'team-abc', title: 'New Story' }),
			);
			expect(result.id).toBe('TEAM-2');
			expect(result.title).toBe('New Story');
		});

		it('falls back to config teamId when containerId is empty', async () => {
			mockCreateIssue.mockResolvedValue(makeIssue());
			mockUpdateIssueState.mockResolvedValue(makeIssue());

			await provider.createWorkItem({ containerId: '', title: 'Test' });

			expect(mockCreateIssue).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'team-abc' }));
		});

		it('transitions to backlog status after creation', async () => {
			mockCreateIssue.mockResolvedValue(makeIssue());
			mockUpdateIssueState.mockResolvedValue(makeIssue());

			await provider.createWorkItem({ containerId: 'team-abc', title: 'Test' });

			expect(mockUpdateIssueState).toHaveBeenCalledWith('issue-uuid', 'state-backlog');
		});
	});

	// =========================================================================
	// listWorkItems
	// =========================================================================
	describe('listWorkItems', () => {
		it('lists issues for a team', async () => {
			mockListIssues.mockResolvedValue([makeIssue(), makeIssue({ identifier: 'TEAM-2' })]);

			const result = await provider.listWorkItems('team-abc');

			expect(mockListIssues).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'team-abc' }));
			expect(result).toHaveLength(2);
		});
	});

	// =========================================================================
	// moveWorkItem
	// =========================================================================
	describe('moveWorkItem', () => {
		it('resolves status name to state ID from config', async () => {
			mockUpdateIssueState.mockResolvedValue(makeIssue());

			await provider.moveWorkItem('issue-uuid', 'done');

			expect(mockUpdateIssueState).toHaveBeenCalledWith('issue-uuid', 'state-done');
		});

		it('passes destination directly when not in config', async () => {
			mockUpdateIssueState.mockResolvedValue(makeIssue());

			await provider.moveWorkItem('issue-uuid', 'unknown-state-id');

			expect(mockUpdateIssueState).toHaveBeenCalledWith('issue-uuid', 'unknown-state-id');
		});
	});

	// =========================================================================
	// addLabel / removeLabel
	// =========================================================================
	describe('addLabel', () => {
		it('resolves label name to ID from config', async () => {
			mockAddLabel.mockResolvedValue(makeIssue());

			await provider.addLabel('issue-uuid', 'processing');

			expect(mockAddLabel).toHaveBeenCalledWith('issue-uuid', 'label-processing-id');
		});

		it('passes label ID directly when not in config', async () => {
			mockAddLabel.mockResolvedValue(makeIssue());

			await provider.addLabel('issue-uuid', 'raw-label-id');

			expect(mockAddLabel).toHaveBeenCalledWith('issue-uuid', 'raw-label-id');
		});
	});

	describe('removeLabel', () => {
		it('resolves label name to ID from config', async () => {
			mockRemoveLabel.mockResolvedValue(makeIssue());

			await provider.removeLabel('issue-uuid', 'processing');

			expect(mockRemoveLabel).toHaveBeenCalledWith('issue-uuid', 'label-processing-id');
		});
	});

	// =========================================================================
	// getChecklists
	// =========================================================================
	describe('getChecklists', () => {
		it('returns a placeholder checklist', async () => {
			const result = await provider.getChecklists('issue-uuid');
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe('subtasks-issue-uuid');
			expect(result[0].name).toBe('Sub-issues');
			expect(result[0].workItemId).toBe('issue-uuid');
			expect(result[0].items).toEqual([]);
		});
	});

	// =========================================================================
	// createChecklist
	// =========================================================================
	describe('createChecklist', () => {
		it('returns a synthetic checklist object', async () => {
			const result = await provider.createChecklist('issue-uuid', 'Acceptance Criteria');
			expect(result.workItemId).toBe('issue-uuid');
			expect(result.name).toBe('Acceptance Criteria');
			expect(result.id).toMatch(/^checklist-issue-uuid-\d+$/);
			expect(result.items).toEqual([]);
		});
	});

	// =========================================================================
	// addChecklistItem
	// =========================================================================
	describe('addChecklistItem', () => {
		it('creates a sub-issue when parent ID is extractable', async () => {
			mockCreateIssue.mockResolvedValue(makeIssue());

			await provider.addChecklistItem('subtasks-issue-uuid', 'Sub-task 1');

			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Sub-task 1', teamId: 'team-abc' }),
			);
		});

		it('throws when checklistId has no extractable parent', async () => {
			await expect(provider.addChecklistItem('invalid-id', 'Sub-task')).rejects.toThrow(
				'Cannot extract parent issue ID from checklist ID: invalid-id',
			);
		});
	});

	// =========================================================================
	// updateChecklistItem
	// =========================================================================
	describe('updateChecklistItem', () => {
		it('transitions sub-issue to done state when complete=true', async () => {
			mockUpdateIssueState.mockResolvedValue(makeIssue());

			await provider.updateChecklistItem('parent-uuid', 'sub-uuid', true);

			expect(mockUpdateIssueState).toHaveBeenCalledWith('sub-uuid', 'state-done');
		});

		it('transitions sub-issue to backlog state when complete=false', async () => {
			mockUpdateIssueState.mockResolvedValue(makeIssue());

			await provider.updateChecklistItem('parent-uuid', 'sub-uuid', false);

			expect(mockUpdateIssueState).toHaveBeenCalledWith('sub-uuid', 'state-backlog');
		});
	});

	// =========================================================================
	// deleteChecklistItem
	// =========================================================================
	describe('deleteChecklistItem', () => {
		it('transitions to cancelled state when configured', async () => {
			mockUpdateIssueState.mockResolvedValue(makeIssue());

			await provider.deleteChecklistItem('parent-uuid', 'sub-uuid');

			expect(mockUpdateIssueState).toHaveBeenCalledWith('sub-uuid', 'state-cancelled');
		});

		it('falls back to done state when no cancelled state configured', async () => {
			const providerNoCancelled = new LinearPMProvider({
				teamId: 'team-abc',
				statuses: { done: 'state-done' },
			});
			mockUpdateIssueState.mockResolvedValue(makeIssue());

			await providerNoCancelled.deleteChecklistItem('parent-uuid', 'sub-uuid');

			expect(mockUpdateIssueState).toHaveBeenCalledWith('sub-uuid', 'state-done');
		});
	});

	// =========================================================================
	// getAttachments
	// =========================================================================
	describe('getAttachments', () => {
		it('maps Linear attachments to Attachment[]', async () => {
			mockGetAttachments.mockResolvedValue([
				{
					id: 'att-1',
					title: 'Screenshot',
					url: 'https://storage.linear.app/att-1',
					subtitle: null,
					metadata: { mimeType: 'image/png', size: 12345 },
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z',
				},
			]);

			const result = await provider.getAttachments('issue-uuid');

			expect(result).toHaveLength(1);
			expect(result[0].id).toBe('att-1');
			expect(result[0].name).toBe('Screenshot');
			expect(result[0].url).toBe('https://storage.linear.app/att-1');
			expect(result[0].mimeType).toBe('image/png');
			expect(result[0].bytes).toBe(12345);
		});
	});

	// =========================================================================
	// addAttachment
	// =========================================================================
	describe('addAttachment', () => {
		it('creates an attachment link', async () => {
			mockCreateAttachment.mockResolvedValue({ id: 'att-new' });

			await provider.addAttachment('issue-uuid', 'https://example.com/file.pdf', 'Report');

			expect(mockCreateAttachment).toHaveBeenCalledWith('issue-uuid', {
				title: 'Report',
				url: 'https://example.com/file.pdf',
			});
		});
	});

	// =========================================================================
	// linkPR
	// =========================================================================
	describe('linkPR', () => {
		it('creates an attachment for the PR', async () => {
			mockCreateAttachment.mockResolvedValue({ id: 'att-pr' });

			await provider.linkPR(
				'issue-uuid',
				'https://github.com/org/repo/pull/42',
				'feat: add linear',
			);

			expect(mockCreateAttachment).toHaveBeenCalledWith('issue-uuid', {
				title: 'feat: add linear',
				url: 'https://github.com/org/repo/pull/42',
				subtitle: 'Pull Request',
				metadata: { type: 'github_pr' },
			});
		});
	});

	// =========================================================================
	// getWorkItemUrl
	// =========================================================================
	describe('getWorkItemUrl', () => {
		it('constructs a Linear issue URL', () => {
			expect(provider.getWorkItemUrl('TEAM-123')).toBe('https://linear.app/issue/TEAM-123');
		});
	});

	// =========================================================================
	// getAuthenticatedUser
	// =========================================================================
	describe('getAuthenticatedUser', () => {
		it('returns the authenticated user', async () => {
			mockGetMe.mockResolvedValue({
				id: 'user-bot',
				name: 'Bot User',
				email: 'bot@example.com',
				displayName: 'Cascade Bot',
				avatarUrl: null,
				active: true,
			});

			const user = await provider.getAuthenticatedUser();

			expect(user.id).toBe('user-bot');
			expect(user.name).toBe('Cascade Bot'); // prefers displayName
			expect(user.username).toBe('bot@example.com');
		});
	});

	// =========================================================================
	// getCustomFieldNumber / updateCustomFieldNumber
	// =========================================================================
	describe('getCustomFieldNumber', () => {
		it('returns 0 (not supported)', async () => {
			const result = await provider.getCustomFieldNumber('issue-uuid', 'custom-field');
			expect(result).toBe(0);
		});
	});

	describe('updateCustomFieldNumber', () => {
		it('is a no-op (not supported)', async () => {
			// Should not throw
			await expect(
				provider.updateCustomFieldNumber('issue-uuid', 'custom-field', 42),
			).resolves.toBeUndefined();
		});
	});
});
