/**
 * Focused wrapper tests for the four work-item / comment mutation gadgets.
 *
 * The cores (`createWorkItem`, `updateWorkItem`, `moveWorkItem`, `postComment`)
 * have their own deep tests in `tests/unit/gadgets/pm/core/`. These tests pin
 * the wrapper behavior end-to-end — specifically that:
 *   - Wrappers translate the structured core result to a concise human-readable
 *     string for the agent tool-result channel (the in-process gadget surface).
 *   - Wrappers wrap thrown core errors via `formatGadgetError` rather than
 *     letting them escape.
 *   - The MoveWorkItem wrapper forwards `expectedSourceState` to the core
 *     (regression guard for the gap discovered in MNG-1423).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/gadgets/pm/core/createWorkItem.js', () => ({
	createWorkItem: vi.fn(),
}));
vi.mock('../../../../src/gadgets/pm/core/updateWorkItem.js', () => ({
	updateWorkItem: vi.fn(),
}));
vi.mock('../../../../src/gadgets/pm/core/moveWorkItem.js', () => ({
	moveWorkItem: vi.fn(),
}));
vi.mock('../../../../src/gadgets/pm/core/postComment.js', () => ({
	postComment: vi.fn(),
}));

import { CreateWorkItem } from '../../../../src/gadgets/pm/CreateWorkItem.js';
import { createWorkItem } from '../../../../src/gadgets/pm/core/createWorkItem.js';
import { moveWorkItem } from '../../../../src/gadgets/pm/core/moveWorkItem.js';
import { postComment } from '../../../../src/gadgets/pm/core/postComment.js';
import { updateWorkItem } from '../../../../src/gadgets/pm/core/updateWorkItem.js';
import { MoveWorkItem } from '../../../../src/gadgets/pm/MoveWorkItem.js';
import { PostComment } from '../../../../src/gadgets/pm/PostComment.js';
import { UpdateWorkItem } from '../../../../src/gadgets/pm/UpdateWorkItem.js';

const mockCreateWorkItem = vi.mocked(createWorkItem);
const mockUpdateWorkItem = vi.mocked(updateWorkItem);
const mockMoveWorkItem = vi.mocked(moveWorkItem);
const mockPostComment = vi.mocked(postComment);

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// CreateWorkItem wrapper
// ---------------------------------------------------------------------------
describe('CreateWorkItem gadget wrapper', () => {
	it('formats the structured result into a concise success string', async () => {
		mockCreateWorkItem.mockResolvedValue({
			status: 'created',
			id: 'item1',
			title: 'New Feature',
			url: 'https://trello.com/c/item1',
			updatedAt: '2026-03-15T12:00:00.000Z',
		});

		const gadget = new CreateWorkItem();
		const out = await gadget.execute({
			containerId: 'list1',
			title: 'New Feature',
			description: 'A new feature',
		});

		expect(mockCreateWorkItem).toHaveBeenCalledWith({
			containerId: 'list1',
			title: 'New Feature',
			description: 'A new feature',
		});
		expect(out).toBe(
			'Work item created successfully: "New Feature" [id: item1] - https://trello.com/c/item1',
		);
	});

	it('returns a formatted error string on thrown core failure', async () => {
		mockCreateWorkItem.mockRejectedValue(new Error('Boom'));

		const gadget = new CreateWorkItem();
		const out = await gadget.execute({
			containerId: 'list1',
			title: 'New Feature',
		});

		expect(out).toBe('Error creating work item: Boom');
	});
});

// ---------------------------------------------------------------------------
// UpdateWorkItem wrapper
// ---------------------------------------------------------------------------
describe('UpdateWorkItem gadget wrapper', () => {
	it('renders the noop message when the core returns a noop result', async () => {
		mockUpdateWorkItem.mockResolvedValue({
			status: 'noop',
			id: 'item1',
			title: '',
			url: 'https://trello.com/c/item1',
			updatedAt: '2026-03-15T12:00:00.000Z',
			changedFields: [],
			addedLabelIds: [],
			message: 'Nothing to update - provide title, description, or labels',
		});

		const gadget = new UpdateWorkItem();
		const out = await gadget.execute({ workItemId: 'item1' });

		expect(out).toBe('Nothing to update - provide title, description, or labels');
	});

	it('renders the updated fields list for the in-process channel', async () => {
		mockUpdateWorkItem.mockResolvedValue({
			status: 'updated',
			id: 'item1',
			title: 'New',
			url: 'https://trello.com/c/item1',
			updatedAt: '2026-03-15T12:00:00.000Z',
			changedFields: ['title', 'description'],
			addedLabelIds: ['l1', 'l2'],
		});

		const gadget = new UpdateWorkItem();
		const out = await gadget.execute({
			workItemId: 'item1',
			title: 'New',
			description: 'New desc',
			addLabelId: ['l1', 'l2'],
		});

		expect(out).toBe('Work item updated: title, description, 2 label(s)');
	});

	it('returns a formatted error string on thrown core failure', async () => {
		mockUpdateWorkItem.mockRejectedValue(new Error('Boom'));

		const gadget = new UpdateWorkItem();
		const out = await gadget.execute({ workItemId: 'item1', title: 'T' });

		expect(out).toBe('Error updating work item: Boom');
	});
});

// ---------------------------------------------------------------------------
// MoveWorkItem wrapper
// ---------------------------------------------------------------------------
describe('MoveWorkItem gadget wrapper', () => {
	it('forwards expectedSourceState to the core (regression guard for MNG-1423)', async () => {
		mockMoveWorkItem.mockResolvedValue({
			status: 'moved',
			id: 'card1',
			url: 'https://trello.com/c/card1',
			destination: 'list2',
			updatedAt: '2026-03-15T12:00:00.000Z',
		});

		const gadget = new MoveWorkItem();
		await gadget.execute({
			workItemId: 'card1',
			destination: 'list2',
			expectedSourceState: 'Backlog',
		});

		expect(mockMoveWorkItem).toHaveBeenCalledWith({
			workItemId: 'card1',
			destination: 'list2',
			expectedSourceState: 'Backlog',
		});
	});

	it('renders the success message for a moved outcome', async () => {
		mockMoveWorkItem.mockResolvedValue({
			status: 'moved',
			id: 'card1',
			url: 'https://trello.com/c/card1',
			destination: 'list2',
			updatedAt: '2026-03-15T12:00:00.000Z',
		});

		const gadget = new MoveWorkItem();
		const out = await gadget.execute({ workItemId: 'card1', destination: 'list2' });

		expect(out).toBe('Work item card1 moved to list2 successfully');
	});

	it('renders the noop message when the work item is already in destination', async () => {
		mockMoveWorkItem.mockResolvedValue({
			status: 'noop',
			id: 'MNG-1',
			url: 'https://linear.app/team/issue/MNG-1',
			destination: 'state-todo',
			updatedAt: '2026-03-15T12:00:00.000Z',
			previousStatus: 'Todo',
			message: "Work item already in destination state 'Todo' — no-op",
		});

		const gadget = new MoveWorkItem();
		const out = await gadget.execute({
			workItemId: 'MNG-1',
			destination: 'state-todo',
			expectedSourceState: 'Backlog',
		});

		expect(out).toBe("Work item already in destination state 'Todo' — no-op");
	});

	it('renders the aborted message when the guard rejects the move', async () => {
		mockMoveWorkItem.mockResolvedValue({
			status: 'aborted',
			id: 'MNG-1',
			url: 'https://linear.app/team/issue/MNG-1',
			destination: 'state-todo',
			updatedAt: '2026-03-15T12:00:00.000Z',
			previousStatus: 'In Progress',
			message:
				"Aborted: work item is in 'In Progress', expected 'Backlog' (likely already moved by a parallel agent — skipping to avoid duplicate downstream work)",
		});

		const gadget = new MoveWorkItem();
		const out = await gadget.execute({
			workItemId: 'MNG-1',
			destination: 'state-todo',
			expectedSourceState: 'Backlog',
		});

		expect(out).toContain('Aborted');
		expect(out).toContain('In Progress');
	});

	it('returns a formatted error string on thrown core failure', async () => {
		mockMoveWorkItem.mockRejectedValue(new Error('Boom'));

		const gadget = new MoveWorkItem();
		const out = await gadget.execute({ workItemId: 'card1', destination: 'list2' });

		expect(out).toBe('Error moving work item: Boom');
	});
});

// ---------------------------------------------------------------------------
// PostComment wrapper
// ---------------------------------------------------------------------------
describe('PostComment gadget wrapper', () => {
	it('returns a concise success message for the created path', async () => {
		mockPostComment.mockResolvedValue({
			status: 'created',
			id: 'comment-1',
			workItemId: 'item1',
			workItemUrl: 'https://trello.com/c/item1',
			updatedAt: '2026-03-15T12:00:00.000Z',
		});

		const gadget = new PostComment();
		const out = await gadget.execute({ workItemId: 'item1', text: 'Hello' });

		expect(mockPostComment).toHaveBeenCalledWith('item1', 'Hello');
		expect(out).toBe('Comment posted successfully');
	});

	it('returns a concise success message for the updated (progress-comment replacement) path', async () => {
		mockPostComment.mockResolvedValue({
			status: 'updated',
			id: 'comment-42',
			workItemId: 'item1',
			workItemUrl: 'https://trello.com/c/item1',
			updatedAt: '2026-03-15T12:00:00.000Z',
		});

		const gadget = new PostComment();
		const out = await gadget.execute({ workItemId: 'item1', text: 'Final summary' });

		expect(out).toBe('Comment posted successfully');
	});

	it('returns a formatted error string on thrown core failure', async () => {
		mockPostComment.mockRejectedValue(new Error('Boom'));

		const gadget = new PostComment();
		const out = await gadget.execute({ workItemId: 'item1', text: 'Hello' });

		expect(out).toBe('Error posting comment: Boom');
	});
});
