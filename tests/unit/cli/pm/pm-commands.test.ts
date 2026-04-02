/**
 * Unit tests for PM CLI commands.
 *
 * Tests the CLI → core function wiring for:
 * - read-work-item
 * - list-work-items
 * - move-work-item
 * - delete-checklist-item
 * - update-checklist-item
 * - create-work-item (basic param-passing)
 * - post-comment (basic param-passing)
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock credential-scoping dependencies (same as file-input-flags.test.ts)
// ---------------------------------------------------------------------------
vi.mock('../../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn((_token: string, fn: () => Promise<void>) => fn()),
}));
vi.mock('../../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn(
		(_creds: { apiKey: string; token: string }, fn: () => Promise<void>) => fn(),
	),
}));
vi.mock('../../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn(
		(_creds: { email: string; apiToken: string; baseUrl: string }, fn: () => Promise<void>) => fn(),
	),
}));
vi.mock('../../../../src/pm/index.js', () => ({
	createPMProvider: vi.fn(() => ({})),
	withPMProvider: vi.fn((_provider: unknown, fn: () => Promise<void>) => fn()),
}));

// ---------------------------------------------------------------------------
// Mock all PM gadget core functions
// ---------------------------------------------------------------------------
vi.mock('../../../../src/gadgets/pm/core/readWorkItem.js', () => ({
	readWorkItem: vi.fn().mockResolvedValue({ id: 'wi-1', title: 'Work Item' }),
}));
vi.mock('../../../../src/gadgets/pm/core/listWorkItems.js', () => ({
	listWorkItems: vi.fn().mockResolvedValue([{ id: 'wi-1' }]),
}));
vi.mock('../../../../src/gadgets/pm/core/moveWorkItem.js', () => ({
	moveWorkItem: vi.fn().mockResolvedValue({ id: 'wi-1', status: 'moved' }),
}));
vi.mock('../../../../src/gadgets/pm/core/deleteChecklistItem.js', () => ({
	deleteChecklistItem: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../../../../src/gadgets/pm/core/updateChecklistItem.js', () => ({
	updateChecklistItem: vi.fn().mockResolvedValue({ state: 'complete' }),
}));
vi.mock('../../../../src/gadgets/pm/core/createWorkItem.js', () => ({
	createWorkItem: vi.fn().mockResolvedValue({ id: 'wi-new' }),
}));
vi.mock('../../../../src/gadgets/pm/core/postComment.js', () => ({
	postComment: vi.fn().mockResolvedValue({ id: 'comment-1' }),
}));

import CreateWorkItem from '../../../../src/cli/pm/create-work-item.js';
import DeleteChecklistItem from '../../../../src/cli/pm/delete-checklist-item.js';
import ListWorkItems from '../../../../src/cli/pm/list-work-items.js';
import MoveWorkItem from '../../../../src/cli/pm/move-work-item.js';
import PostComment from '../../../../src/cli/pm/post-comment.js';
import ReadWorkItem from '../../../../src/cli/pm/read-work-item.js';
import UpdateChecklistItem from '../../../../src/cli/pm/update-checklist-item.js';
import { createWorkItem } from '../../../../src/gadgets/pm/core/createWorkItem.js';
import { deleteChecklistItem } from '../../../../src/gadgets/pm/core/deleteChecklistItem.js';
import { listWorkItems } from '../../../../src/gadgets/pm/core/listWorkItems.js';
import { moveWorkItem } from '../../../../src/gadgets/pm/core/moveWorkItem.js';
import { postComment } from '../../../../src/gadgets/pm/core/postComment.js';
import { readWorkItem } from '../../../../src/gadgets/pm/core/readWorkItem.js';
import { updateChecklistItem } from '../../../../src/gadgets/pm/core/updateChecklistItem.js';

/** Create a fresh minimal oclif config to satisfy this.parse() in each test */
function makeMockConfig() {
	return { runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }) };
}

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// read-work-item
// ---------------------------------------------------------------------------
describe('ReadWorkItem command', () => {
	it('passes workItemId and default includeComments to readWorkItem', async () => {
		// Default value of includeComments is true from the definition
		const cmd = new ReadWorkItem(['--workItemId', 'card-123'], makeMockConfig() as never);
		await cmd.run();

		expect(readWorkItem).toHaveBeenCalledWith('card-123', true);
	});

	it('passes includeComments=true when --includeComments is set', async () => {
		const cmd = new ReadWorkItem(
			['--workItemId', 'card-123', '--includeComments'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(readWorkItem).toHaveBeenCalledWith('card-123', true);
	});

	it('passes includeComments=false when --no-includeComments is set', async () => {
		const cmd = new ReadWorkItem(
			['--workItemId', 'card-123', '--no-includeComments'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(readWorkItem).toHaveBeenCalledWith('card-123', false);
	});

	it('outputs JSON success result', async () => {
		vi.mocked(readWorkItem).mockResolvedValue({ id: 'card-123', title: 'Test Card' } as never);
		const cmd = new ReadWorkItem(['--workItemId', 'card-123'], makeMockConfig() as never);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"success":true'));
		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(true);
		expect(output.data).toEqual({ id: 'card-123', title: 'Test Card' });
	});
});

// ---------------------------------------------------------------------------
// list-work-items
// ---------------------------------------------------------------------------
describe('ListWorkItems command', () => {
	it('passes containerId to listWorkItems', async () => {
		const cmd = new ListWorkItems(['--containerId', 'list-456'], makeMockConfig() as never);
		await cmd.run();

		expect(listWorkItems).toHaveBeenCalledWith('list-456');
	});

	it('outputs JSON success result', async () => {
		vi.mocked(listWorkItems).mockResolvedValue([{ id: 'wi-1' }, { id: 'wi-2' }] as never);
		const cmd = new ListWorkItems(['--containerId', 'list-456'], makeMockConfig() as never);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(true);
		expect(output.data).toEqual([{ id: 'wi-1' }, { id: 'wi-2' }]);
	});
});

// ---------------------------------------------------------------------------
// move-work-item
// ---------------------------------------------------------------------------
describe('MoveWorkItem command', () => {
	it('passes workItemId and destination to moveWorkItem', async () => {
		const cmd = new MoveWorkItem(
			['--workItemId', 'card-123', '--destination', 'list-done'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(moveWorkItem).toHaveBeenCalledWith({
			workItemId: 'card-123',
			destination: 'list-done',
		});
	});

	it('works with JIRA status destinations', async () => {
		const cmd = new MoveWorkItem(
			['--workItemId', 'PROJ-42', '--destination', 'In Progress'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(moveWorkItem).toHaveBeenCalledWith({
			workItemId: 'PROJ-42',
			destination: 'In Progress',
		});
	});

	it('outputs JSON success result', async () => {
		vi.mocked(moveWorkItem).mockResolvedValue({ id: 'card-123', moved: true } as never);
		const cmd = new MoveWorkItem(
			['--workItemId', 'card-123', '--destination', 'list-done'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// delete-checklist-item
// ---------------------------------------------------------------------------
describe('DeleteChecklistItem command', () => {
	it('passes workItemId and checkItemId to deleteChecklistItem', async () => {
		const cmd = new DeleteChecklistItem(
			['--workItemId', 'card-123', '--checkItemId', 'item-456'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(deleteChecklistItem).toHaveBeenCalledWith('card-123', 'item-456');
	});

	it('works with JIRA subtask key format', async () => {
		const cmd = new DeleteChecklistItem(
			['--workItemId', 'PROJ-42', '--checkItemId', 'PROJ-48'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(deleteChecklistItem).toHaveBeenCalledWith('PROJ-42', 'PROJ-48');
	});

	it('outputs JSON success result', async () => {
		vi.mocked(deleteChecklistItem).mockResolvedValue({ success: true } as never);
		const cmd = new DeleteChecklistItem(
			['--workItemId', 'card-123', '--checkItemId', 'item-456'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// update-checklist-item
// ---------------------------------------------------------------------------
describe('UpdateChecklistItem command', () => {
	it('passes workItemId, checkItemId, and state=true for "complete"', async () => {
		const cmd = new UpdateChecklistItem(
			['--workItemId', 'card-123', '--checkItemId', 'item-456', '--state', 'complete'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(updateChecklistItem).toHaveBeenCalledWith('card-123', 'item-456', true);
	});

	it('passes workItemId, checkItemId, and state=false for "incomplete"', async () => {
		const cmd = new UpdateChecklistItem(
			['--workItemId', 'card-123', '--checkItemId', 'item-456', '--state', 'incomplete'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(updateChecklistItem).toHaveBeenCalledWith('card-123', 'item-456', false);
	});

	it('outputs JSON success result', async () => {
		vi.mocked(updateChecklistItem).mockResolvedValue({ state: 'complete' } as never);
		const cmd = new UpdateChecklistItem(
			['--workItemId', 'card-123', '--checkItemId', 'item-456', '--state', 'complete'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(true);
		expect(output.data).toEqual({ state: 'complete' });
	});
});

// ---------------------------------------------------------------------------
// create-work-item (basic param-passing test)
// ---------------------------------------------------------------------------
describe('CreateWorkItem command (basic params)', () => {
	it('passes containerId and title to createWorkItem', async () => {
		const cmd = new CreateWorkItem(
			['--containerId', 'list-1', '--title', 'New Card'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(createWorkItem).toHaveBeenCalledWith(
			expect.objectContaining({
				containerId: 'list-1',
				title: 'New Card',
			}),
		);
	});

	it('outputs JSON success result', async () => {
		vi.mocked(createWorkItem).mockResolvedValue({ id: 'new-wi' } as never);
		const cmd = new CreateWorkItem(
			['--containerId', 'list-1', '--title', 'New Card'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(true);
		expect(output.data).toEqual({ id: 'new-wi' });
	});
});

// ---------------------------------------------------------------------------
// post-comment (basic param-passing test)
// ---------------------------------------------------------------------------
describe('PostComment command (basic params)', () => {
	it('passes workItemId and text to postComment', async () => {
		const cmd = new PostComment(
			['--workItemId', 'card-1', '--text', 'Hello world'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(postComment).toHaveBeenCalledWith('card-1', 'Hello world');
	});

	it('outputs JSON success result', async () => {
		vi.mocked(postComment).mockResolvedValue({ id: 'comment-new' } as never);
		const cmd = new PostComment(
			['--workItemId', 'card-1', '--text', 'Hello world'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(true);
		expect(output.data).toEqual({ id: 'comment-new' });
	});
});
