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
		processing: '11111111-1111-4111-8111-111111111111',
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

function mockIssueDescription(initialDescription: string | null) {
	let description = initialDescription;
	mockGetIssue.mockImplementation(async () => makeIssue({ description }));
	mockUpdateIssue.mockImplementation(async (_id, updates: { description?: string }) => {
		description = updates.description ?? description;
		return makeIssue({ description });
	});
	return {
		get description() {
			return description;
		},
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
			expect(result.statusId).toBe('state-backlog');
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

		it('populates inlineMedia when description contains markdown images', async () => {
			mockGetIssue.mockResolvedValue(
				makeIssue({
					description:
						'Here is a screenshot:\n\n![screenshot](https://uploads.linear.app/abc/def.png)',
				}),
			);

			const result = await provider.getWorkItem('issue-uuid');

			expect(result.inlineMedia).toHaveLength(1);
			expect(result.inlineMedia?.[0]).toMatchObject({
				url: 'https://uploads.linear.app/abc/def.png',
				mimeType: 'image/png',
				altText: 'screenshot',
				source: 'description',
			});
		});

		it('returns undefined inlineMedia when description has no images', async () => {
			mockGetIssue.mockResolvedValue(makeIssue({ description: 'Plain text, no images here.' }));

			const result = await provider.getWorkItem('issue-uuid');

			expect(result.inlineMedia).toBeUndefined();
		});

		it('returns undefined inlineMedia when description is null', async () => {
			mockGetIssue.mockResolvedValue(makeIssue({ description: null }));
			const result = await provider.getWorkItem('issue-uuid');
			expect(result.inlineMedia).toBeUndefined();
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

		it('populates inlineMedia when comment body contains markdown images', async () => {
			mockGetIssueComments.mockResolvedValue([
				{
					id: 'c3',
					body: 'See this image: ![diagram](https://uploads.linear.app/xyz/diagram.png)',
					createdAt: '2024-01-03T00:00:00Z',
					updatedAt: '2024-01-03T00:00:00Z',
					issueId: 'issue-uuid',
					user: {
						id: 'u1',
						name: 'Bob',
						email: 'bob@example.com',
						displayName: 'Bob',
						avatarUrl: null,
						active: true,
					},
				},
			]);

			const result = await provider.getWorkItemComments('issue-uuid');

			expect(result[0].inlineMedia).toHaveLength(1);
			expect(result[0].inlineMedia?.[0]).toMatchObject({
				url: 'https://uploads.linear.app/xyz/diagram.png',
				mimeType: 'image/png',
				altText: 'diagram',
				source: 'comment',
			});
		});

		it('returns undefined inlineMedia when comment body has no images', async () => {
			mockGetIssueComments.mockResolvedValue([
				{
					id: 'c4',
					body: 'Just text, no images.',
					createdAt: '2024-01-04T00:00:00Z',
					updatedAt: '2024-01-04T00:00:00Z',
					issueId: 'issue-uuid',
					user: null,
				},
			]);

			const result = await provider.getWorkItemComments('issue-uuid');

			expect(result[0].inlineMedia).toBeUndefined();
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
		it('creates an issue in the given team with backlog stateId', async () => {
			mockCreateIssue.mockResolvedValue(makeIssue({ identifier: 'TEAM-2', title: 'New Story' }));

			const result = await provider.createWorkItem({
				containerId: 'team-abc',
				title: 'New Story',
				description: 'A story',
			});

			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					teamId: 'team-abc',
					title: 'New Story',
					stateId: 'state-backlog',
				}),
			);
			expect(result.id).toBe('TEAM-2');
			expect(result.title).toBe('New Story');
		});

		it('falls back to config teamId when containerId is empty', async () => {
			mockCreateIssue.mockResolvedValue(makeIssue());

			await provider.createWorkItem({ containerId: '', title: 'Test' });

			expect(mockCreateIssue).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'team-abc' }));
		});

		it('does not call updateIssueState — stateId is set on create', async () => {
			mockCreateIssue.mockResolvedValue(makeIssue());

			await provider.createWorkItem({ containerId: 'team-abc', title: 'Test' });

			expect(mockUpdateIssueState).not.toHaveBeenCalled();
		});

		it('omits stateId when statuses.backlog is not configured', async () => {
			const noBacklogProvider = new LinearPMProvider({
				teamId: 'team-abc',
				statuses: {},
			});
			mockCreateIssue.mockResolvedValue(makeIssue());

			await noBacklogProvider.createWorkItem({ containerId: 'team-abc', title: 'Test' });

			const call = mockCreateIssue.mock.calls[0][0];
			expect(call).not.toHaveProperty('stateId');
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
			expect(result[0].status).toBe('Backlog');
			expect(result[0].statusId).toBe('state-backlog');
		});

		it('returns [] for unmapped CASCADE status keys without falling through to Linear stateId', async () => {
			const noBacklogProvider = new LinearPMProvider({
				teamId: 'team-abc',
				statuses: {},
			});

			const result = await noBacklogProvider.listWorkItems(undefined, { status: 'backlog' });

			expect(result).toEqual([]);
			expect(mockListIssues).not.toHaveBeenCalled();
		});

		it('allows UUID-shaped raw state IDs for explicit low-level callers', async () => {
			mockListIssues.mockResolvedValue([]);
			const rawStateId = '550e8400-e29b-41d4-a716-446655440000';

			await provider.listWorkItems(undefined, { status: rawStateId });

			expect(mockListIssues).toHaveBeenCalledWith(
				expect.objectContaining({ teamId: 'team-abc', stateId: rawStateId }),
			);
		});

		it('rejects non-UUID unmapped raw status values', async () => {
			const result = await provider.listWorkItems(undefined, { status: 'Ideas' });

			expect(result).toEqual([]);
			expect(mockListIssues).not.toHaveBeenCalled();
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

			expect(mockAddLabel).toHaveBeenCalledWith(
				'issue-uuid',
				'11111111-1111-4111-8111-111111111111',
			);
		});

		it('passes a UUID-shaped value through when not in config', async () => {
			mockAddLabel.mockResolvedValue(makeIssue());

			await provider.addLabel('issue-uuid', '550e8400-e29b-41d4-a716-446655440000');

			expect(mockAddLabel).toHaveBeenCalledWith(
				'issue-uuid',
				'550e8400-e29b-41d4-a716-446655440000',
			);
		});

		it('skips the API call and warns when the value is neither a mapped slot nor a UUID', async () => {
			// Linear API rejects non-UUID labelIds; rather than silently fail we
			// short-circuit and emit a diagnostic so the misconfiguration is visible.
			await provider.addLabel('issue-uuid', 'unmapped-slot');

			expect(mockAddLabel).not.toHaveBeenCalled();
		});
	});

	describe('removeLabel', () => {
		it('resolves label name to ID from config', async () => {
			mockRemoveLabel.mockResolvedValue(makeIssue());

			await provider.removeLabel('issue-uuid', 'processing');

			expect(mockRemoveLabel).toHaveBeenCalledWith(
				'issue-uuid',
				'11111111-1111-4111-8111-111111111111',
			);
		});
	});

	// =========================================================================
	// Inline checklist methods (spec 008)
	// =========================================================================
	describe('getChecklists (inline)', () => {
		it('parses inline checklists from issue description', async () => {
			mockGetIssue.mockResolvedValue(
				makeIssue({
					description: '### ✅ AC\n- [ ] First\n- [x] Second',
				}),
			);

			const result = await provider.getChecklists('issue-uuid');

			expect(result).toHaveLength(1);
			expect(result[0].name).toBe('✅ AC');
			expect(result[0].workItemId).toBe('issue-uuid');
			expect(result[0].items).toHaveLength(2);
			expect(result[0].items[0]).toMatchObject({ name: 'First', complete: false });
			expect(result[0].items[1]).toMatchObject({ name: 'Second', complete: true });
			expect(result[0].items[0].id).toMatch(/^cl-[0-9a-f]{8}$/);
		});

		it('returns empty array for description with no checklists', async () => {
			mockGetIssue.mockResolvedValue(makeIssue({ description: 'Just text.' }));
			const result = await provider.getChecklists('issue-uuid');
			expect(result).toEqual([]);
		});

		it('returns empty array for empty description', async () => {
			mockGetIssue.mockResolvedValue(makeIssue({ description: null }));
			const result = await provider.getChecklists('issue-uuid');
			expect(result).toEqual([]);
		});
	});

	describe('createChecklist (inline)', () => {
		it('appends new checklist section to description and returns Checklist', async () => {
			mockIssueDescription('Existing.');

			const result = await provider.createChecklist('issue-uuid', '✅ AC');

			expect(mockUpdateIssue).toHaveBeenCalledWith(
				'issue-uuid',
				expect.objectContaining({ description: 'Existing.\n\n### ✅ AC' }),
			);
			expect(result.workItemId).toBe('issue-uuid');
			expect(result.name).toBe('✅ AC');
			expect(result.id).toMatch(/^inline-issue-uuid-[0-9a-f]{8}$/);
			expect(result.items).toEqual([]);
		});

		it('waits for Linear read-after-write visibility before the next checklist append', async () => {
			let description = 'Existing.';
			let staleDescription: string | null = null;
			mockGetIssue.mockImplementation(async () => {
				if (staleDescription !== null) {
					const value = staleDescription;
					staleDescription = null;
					return makeIssue({ description: value });
				}
				return makeIssue({ description });
			});
			mockUpdateIssue.mockImplementation(async (_id, updates: { description?: string }) => {
				staleDescription = description;
				description = updates.description ?? description;
				return makeIssue({ description });
			});

			const checklist = await provider.createChecklist('issue-uuid', '✅ AC');
			await provider.addChecklistItem(checklist.id, 'First item');

			expect(description).toBe('Existing.\n\n### ✅ AC\n- [ ] First item');
		});

		it('preserves multiple concurrently-created checklist sections despite stale Linear reads', async () => {
			let description = 'Existing.';
			let staleDescription: string | null = null;
			mockGetIssue.mockImplementation(async () => {
				if (staleDescription !== null) {
					const value = staleDescription;
					staleDescription = null;
					return makeIssue({ description: value });
				}
				return makeIssue({ description });
			});
			mockUpdateIssue.mockImplementation(async (_id, updates: { description?: string }) => {
				await sleep(5);
				staleDescription = description;
				description = updates.description ?? description;
				return makeIssue({ description });
			});

			const results = await Promise.allSettled([
				provider
					.createChecklist('issue-uuid', '✅ Acceptance Criteria')
					.then((checklist) => provider.addChecklistItem(checklist.id, 'Ready to ship')),
				provider
					.createChecklist('issue-uuid', '🔗 Dependencies')
					.then((checklist) => provider.addChecklistItem(checklist.id, 'External API key')),
			]);

			expect(results).toEqual([
				{ status: 'fulfilled', value: undefined },
				{ status: 'fulfilled', value: undefined },
			]);
			expect(description).toContain('### ✅ Acceptance Criteria');
			expect(description).toContain('- [ ] Ready to ship');
			expect(description).toContain('### 🔗 Dependencies');
			expect(description).toContain('- [ ] External API key');
		});
	});

	describe('addChecklistItem (inline)', () => {
		it('appends a markdown checkbox to the description', async () => {
			// Pre-existing checklist section in description
			mockIssueDescription('### ✅ AC\n- [ ] Existing');

			// Build the checklistId for this checklist (without calling createChecklist)
			const checklist = await provider.createChecklist('issue-uuid', '✅ AC');
			await provider.addChecklistItem(checklist.id, 'New item');

			const lastCall = mockUpdateIssue.mock.calls[mockUpdateIssue.mock.calls.length - 1];
			expect(lastCall[1].description).toContain('- [ ] New item');
		});

		it('does NOT call createIssue (no sub-issue creation)', async () => {
			mockIssueDescription('### ✅ AC\n- [ ] Existing');

			const checklist = await provider.createChecklist('issue-uuid', '✅ AC');
			await provider.addChecklistItem(checklist.id, 'Item');

			expect(mockCreateIssue).not.toHaveBeenCalled();
		});

		it('throws when checklistId has wrong format', async () => {
			await expect(provider.addChecklistItem('invalid-id', 'X')).rejects.toThrow(
				'Invalid Linear checklist ID',
			);
		});

		it('supports checked=true', async () => {
			mockIssueDescription('### ✅ AC\n- [ ] First');

			const checklist = await provider.createChecklist('issue-uuid', '✅ AC');
			await provider.addChecklistItem(checklist.id, 'Done item', true);

			const lastCall = mockUpdateIssue.mock.calls[mockUpdateIssue.mock.calls.length - 1];
			expect(lastCall[1].description).toContain('- [x] Done item');
		});
	});

	describe('updateChecklistItem (inline)', () => {
		it('toggles a checkbox in the description', async () => {
			const desc = '### ✅ AC\n- [ ] Item A';
			mockIssueDescription(desc);

			const checklists = await provider.getChecklists('issue-uuid');
			const itemId = checklists[0].items[0].id;

			await provider.updateChecklistItem('issue-uuid', itemId, true);

			expect(mockUpdateIssue).toHaveBeenCalledWith(
				'issue-uuid',
				expect.objectContaining({ description: '### ✅ AC\n- [x] Item A' }),
			);
		});

		it('does NOT call updateIssueState (no transition)', async () => {
			const desc = '### ✅ AC\n- [ ] Item A';
			mockIssueDescription(desc);

			const checklists = await provider.getChecklists('issue-uuid');
			const itemId = checklists[0].items[0].id;
			await provider.updateChecklistItem('issue-uuid', itemId, true);

			expect(mockUpdateIssueState).not.toHaveBeenCalled();
		});

		it('serializes concurrent description rewrites so all checklist rows are retained', async () => {
			let description = '### ✅ AC\n- [ ] Item A\n- [ ] Item B\n- [ ] Item C';
			mockGetIssue.mockImplementation(async () => makeIssue({ description }));
			mockUpdateIssue.mockImplementation(async (_id, updates: { description?: string }) => {
				await sleep(5);
				description = updates.description ?? description;
				return makeIssue({ description });
			});

			const checklists = await provider.getChecklists('issue-uuid');
			await Promise.all(
				checklists[0].items.map((item) =>
					provider.updateChecklistItem('issue-uuid', item.id, true),
				),
			);

			expect(description).toBe('### ✅ AC\n- [x] Item A\n- [x] Item B\n- [x] Item C');
		});
	});

	describe('deleteChecklistItem (inline)', () => {
		it('removes the item line from the description', async () => {
			const desc = '### ✅ AC\n- [ ] Keep\n- [ ] Remove';
			mockIssueDescription(desc);

			const checklists = await provider.getChecklists('issue-uuid');
			const removeId = checklists[0].items[1].id;
			await provider.deleteChecklistItem('issue-uuid', removeId);

			expect(mockUpdateIssue).toHaveBeenCalledWith(
				'issue-uuid',
				expect.objectContaining({ description: '### ✅ AC\n- [ ] Keep' }),
			);
		});
	});

	describe('checklist update retry on conflict', () => {
		it('retries description update once on failure', async () => {
			const desc = '### ✅ AC\n- [ ] Item';
			let description = desc;
			mockGetIssue.mockImplementation(async () => makeIssue({ description }));
			mockUpdateIssue
				.mockRejectedValueOnce(new Error('stale'))
				.mockImplementation(async (_id, updates: { description?: string }) => {
					description = updates.description ?? description;
					return makeIssue({ description });
				});

			const checklists = await provider.getChecklists('issue-uuid');
			await provider.updateChecklistItem('issue-uuid', checklists[0].items[0].id, true);

			expect(mockUpdateIssue).toHaveBeenCalledTimes(2);
		});

		it('does not retry local checklist mutation errors', async () => {
			mockGetIssue.mockResolvedValue(makeIssue({ description: '### ✅ AC\n- [ ] Item' }));

			await expect(provider.updateChecklistItem('issue-uuid', 'cl-00000000', true)).rejects.toThrow(
				'Checklist item not found',
			);

			expect(mockGetIssue).toHaveBeenCalledTimes(1);
			expect(mockUpdateIssue).not.toHaveBeenCalled();
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

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
