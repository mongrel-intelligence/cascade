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
 * - report-friction (basic param-passing)
 * - post-comment (basic param-passing)
 */

import { rmSync, writeFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UPDATE_CHANNEL_FILE } from '../../../../src/config/updateChannel.js';

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
vi.mock('../../../../src/gadgets/pm/core/reportFriction.js', () => ({
	reportFriction: vi
		.fn()
		.mockResolvedValue({ status: 'filed', workItemUrl: 'https://pm/friction' }),
}));
vi.mock('../../../../src/gadgets/pm/core/postComment.js', () => ({
	postComment: vi.fn().mockResolvedValue({ id: 'comment-1' }),
}));
vi.mock('../../../../src/gadgets/pm/core/updateWorkItem.js', () => ({
	updateWorkItem: vi.fn().mockResolvedValue({ id: 'wi-1', status: 'updated' }),
}));
vi.mock('../../../../src/gadgets/pm/core/addChecklist.js', () => ({
	addChecklist: vi.fn().mockResolvedValue({ id: 'wi-1', status: 'created' }),
}));
// Suppress the PM-write sidecar side effect — the structured-output assertions
// only care about the CLI's JSON envelope.
vi.mock('../../../../src/gadgets/session/core/sidecar.js', () => ({
	writePMWriteSidecar: vi.fn(() => true),
}));

import AddChecklist from '../../../../src/cli/pm/add-checklist.js';
import CreateWorkItem from '../../../../src/cli/pm/create-work-item.js';
import DeleteChecklistItem from '../../../../src/cli/pm/delete-checklist-item.js';
import ListWorkItems from '../../../../src/cli/pm/list-work-items.js';
import MoveWorkItem from '../../../../src/cli/pm/move-work-item.js';
import PostComment from '../../../../src/cli/pm/post-comment.js';
import ReadWorkItem from '../../../../src/cli/pm/read-work-item.js';
import ReportFriction from '../../../../src/cli/pm/report-friction.js';
import UpdateChecklistItem from '../../../../src/cli/pm/update-checklist-item.js';
import UpdateWorkItem from '../../../../src/cli/pm/update-work-item.js';
import { addChecklist } from '../../../../src/gadgets/pm/core/addChecklist.js';
import { createWorkItem } from '../../../../src/gadgets/pm/core/createWorkItem.js';
import { deleteChecklistItem } from '../../../../src/gadgets/pm/core/deleteChecklistItem.js';
import { listWorkItems } from '../../../../src/gadgets/pm/core/listWorkItems.js';
import { moveWorkItem } from '../../../../src/gadgets/pm/core/moveWorkItem.js';
import { postComment } from '../../../../src/gadgets/pm/core/postComment.js';
import { readWorkItem } from '../../../../src/gadgets/pm/core/readWorkItem.js';
import { reportFriction } from '../../../../src/gadgets/pm/core/reportFriction.js';
import { updateChecklistItem } from '../../../../src/gadgets/pm/core/updateChecklistItem.js';
import { updateWorkItem } from '../../../../src/gadgets/pm/core/updateWorkItem.js';

/** Create a fresh minimal oclif config to satisfy this.parse() in each test */
function makeMockConfig() {
	return { runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }) };
}

async function runExpectingExit(cmd: { run: () => Promise<unknown> }): Promise<void> {
	try {
		await cmd.run();
	} catch {
		// emitCliError exits with code 1; oclif throws in the test environment.
	}
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

	it('normalizes one accidental outer quote layer around workItemId', async () => {
		const doubleQuoted = new ReadWorkItem(
			['--workItemId', '"card-123"'],
			makeMockConfig() as never,
		);
		await doubleQuoted.run();

		const singleQuoted = new ReadWorkItem(
			['--workItemId', "'card-456'"],
			makeMockConfig() as never,
		);
		await singleQuoted.run();

		expect(readWorkItem).toHaveBeenNthCalledWith(1, 'card-123', true);
		expect(readWorkItem).toHaveBeenNthCalledWith(2, 'card-456', true);
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

	it('outputs a runtime failure envelope when readWorkItem rejects', async () => {
		vi.mocked(readWorkItem).mockRejectedValue(new Error('Request failed with status code 400'));
		const cmd = new ReadWorkItem(['--workItemId', 'card-123'], makeMockConfig() as never);
		const logSpy = vi.spyOn(cmd, 'log');
		const exitSpy = vi.spyOn(cmd, 'exit');

		await runExpectingExit(cmd);

		expect(exitSpy).toHaveBeenCalledWith(1);
		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output).toEqual({
			success: false,
			error: {
				type: 'runtime',
				message: 'Request failed with status code 400',
			},
		});
	});
});

// ---------------------------------------------------------------------------
// list-work-items
// ---------------------------------------------------------------------------
describe('ListWorkItems command', () => {
	it('passes containerId to listWorkItems', async () => {
		const cmd = new ListWorkItems(['--containerId', 'list-456'], makeMockConfig() as never);
		await cmd.run();

		expect(listWorkItems).toHaveBeenCalledWith({ containerId: 'list-456', status: undefined });
	});

	it('passes status to listWorkItems', async () => {
		const cmd = new ListWorkItems(['--status', 'backlog'], makeMockConfig() as never);
		await cmd.run();

		expect(listWorkItems).toHaveBeenCalledWith({ containerId: undefined, status: 'backlog' });
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
// report-friction (basic param-passing test)
// ---------------------------------------------------------------------------
describe('ReportFriction command (basic params)', () => {
	it('passes summary, details, category, severity, and whileDoing to reportFriction', async () => {
		const cmd = new ReportFriction(
			[
				'--summary',
				'Friction summary',
				'--details',
				'Details',
				'--category',
				'tooling',
				'--severity',
				'medium',
				'--whileDoing',
				'Running tests',
			],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(reportFriction).toHaveBeenCalledWith({
			summary: 'Friction summary',
			details: 'Details',
			category: 'tooling',
			severity: 'medium',
			whileDoing: 'Running tests',
		});
	});

	it('outputs JSON success result', async () => {
		vi.mocked(reportFriction).mockResolvedValue({
			status: 'filed',
			workItemUrl: 'https://pm/friction',
		} as never);
		const cmd = new ReportFriction(
			[
				'--summary',
				'Friction summary',
				'--details',
				'Details',
				'--category',
				'tooling',
				'--severity',
				'medium',
			],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(true);
		expect(output.data).toEqual({ status: 'filed', workItemUrl: 'https://pm/friction' });
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

	it('outputs a runtime failure envelope when postComment rejects', async () => {
		vi.mocked(postComment).mockRejectedValue(new Error('Request failed with status code 400'));
		const cmd = new PostComment(
			['--workItemId', 'card-1', '--text', 'Hello world'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		const exitSpy = vi.spyOn(cmd, 'exit');

		await runExpectingExit(cmd);

		expect(exitSpy).toHaveBeenCalledWith(1);
		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output).toEqual({
			success: false,
			error: {
				type: 'runtime',
				message: 'Request failed with status code 400',
			},
		});
	});
});

// ---------------------------------------------------------------------------
// MNG-1428: Structured-output contract regression coverage
//
// Each targeted PM mutation CLI must serialise the structured core result into
// the `{ success: true, data: ... }` envelope without rewriting it into a prose
// sentinel. These tests parse stdout and pin `success.data.id`,
// `success.data.url`, `success.data.status`, and `success.data.updatedAt`
// (where applicable) so a future renderer drift that drops a field surfaces
// loudly in CI instead of silently regressing the agent-facing contract.
//
// Read-only commands (read-work-item, list-work-items) are excluded — they
// have no mutation outcome and so no required `status` / `updatedAt` fields.
// ---------------------------------------------------------------------------
describe('PM CLI structured-output contract (MNG-1428)', () => {
	function readJsonOutput(logSpy: ReturnType<typeof vi.spyOn>) {
		const lines = logSpy.mock.calls.map((c) => c[0] as string);
		const jsonLine = lines.find((l) => typeof l === 'string' && l.startsWith('{')) ?? '';
		return JSON.parse(jsonLine) as {
			success: boolean;
			data?: Record<string, unknown>;
			error?: { type: string; message: string };
		};
	}

	it('CreateWorkItem stdout exposes id, url, status="created", and updatedAt', async () => {
		vi.mocked(createWorkItem).mockResolvedValue({
			status: 'created',
			id: 'wi-new',
			title: 'New Card',
			url: 'https://pm.example/card/wi-new',
			updatedAt: '2026-06-01T12:00:00.000Z',
			workflowStatus: 'Backlog',
			workflowStatusId: 'list-backlog',
		} as never);
		const cmd = new CreateWorkItem(
			['--containerId', 'list-1', '--title', 'New Card'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(true);
		expect(output.data).toMatchObject({
			status: 'created',
			id: 'wi-new',
			url: 'https://pm.example/card/wi-new',
			updatedAt: '2026-06-01T12:00:00.000Z',
		});
		// Provider-specific workflow state lives on its own keys — pinning the
		// `status` vs `workflowStatus` naming so the mutation outcome is never
		// confused with the workflow column name.
		expect(output.data?.workflowStatus).toBe('Backlog');
		expect(output.data?.workflowStatusId).toBe('list-backlog');
	});

	it('PostComment stdout exposes id, workItemUrl, status, and updatedAt', async () => {
		vi.mocked(postComment).mockResolvedValue({
			status: 'created',
			id: 'comment-42',
			workItemId: 'card-1',
			workItemUrl: 'https://pm.example/card/card-1',
			updatedAt: '2026-06-01T12:34:56.000Z',
		} as never);
		const cmd = new PostComment(
			['--workItemId', 'card-1', '--text', 'Status update'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(true);
		expect(output.data).toMatchObject({
			status: 'created',
			id: 'comment-42',
			workItemId: 'card-1',
			workItemUrl: 'https://pm.example/card/card-1',
			updatedAt: '2026-06-01T12:34:56.000Z',
		});
	});

	it('PostComment exposes status="updated" when the progress comment was replaced', async () => {
		vi.mocked(postComment).mockResolvedValue({
			status: 'updated',
			id: 'comment-7',
			workItemId: 'card-1',
			workItemUrl: 'https://pm.example/card/card-1',
			updatedAt: '2026-06-01T12:34:56.000Z',
		} as never);
		const cmd = new PostComment(
			['--workItemId', 'card-1', '--text', 'Final summary'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = readJsonOutput(logSpy);
		expect(output.data?.status).toBe('updated');
		expect(output.data?.id).toBe('comment-7');
	});

	it('UpdateWorkItem stdout exposes id, url, status, updatedAt, and the changed-field arrays', async () => {
		vi.mocked(updateWorkItem).mockResolvedValue({
			status: 'updated',
			id: 'card-9',
			title: 'Renamed',
			url: 'https://pm.example/card/card-9',
			updatedAt: '2026-06-01T13:00:00.000Z',
			changedFields: ['title', 'description'],
			addedLabelIds: ['label-1'],
		} as never);
		const cmd = new UpdateWorkItem(
			[
				'--workItemId',
				'card-9',
				'--title',
				'Renamed',
				'--description',
				'New body',
				'--addLabelId',
				'label-1',
			],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(true);
		expect(output.data).toMatchObject({
			status: 'updated',
			id: 'card-9',
			url: 'https://pm.example/card/card-9',
			updatedAt: '2026-06-01T13:00:00.000Z',
			changedFields: ['title', 'description'],
			addedLabelIds: ['label-1'],
		});
	});

	it('UpdateWorkItem exposes status="noop" when no updates were supplied', async () => {
		vi.mocked(updateWorkItem).mockResolvedValue({
			status: 'noop',
			id: 'card-9',
			title: '',
			url: 'https://pm.example/card/card-9',
			updatedAt: '2026-06-01T13:00:00.000Z',
			changedFields: [],
			addedLabelIds: [],
			message: 'Nothing to update - provide title, description, or labels',
		} as never);
		const cmd = new UpdateWorkItem(['--workItemId', 'card-9'], makeMockConfig() as never);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = readJsonOutput(logSpy);
		expect(output.data?.status).toBe('noop');
		expect(output.data?.changedFields).toEqual([]);
		expect(output.data?.addedLabelIds).toEqual([]);
	});

	it('MoveWorkItem stdout exposes id, url, status="moved", and updatedAt', async () => {
		vi.mocked(moveWorkItem).mockResolvedValue({
			status: 'moved',
			id: 'card-2',
			url: 'https://pm.example/card/card-2',
			destination: 'list-done',
			updatedAt: '2026-06-01T14:00:00.000Z',
		} as never);
		const cmd = new MoveWorkItem(
			['--workItemId', 'card-2', '--destination', 'list-done'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(true);
		expect(output.data).toMatchObject({
			status: 'moved',
			id: 'card-2',
			url: 'https://pm.example/card/card-2',
			destination: 'list-done',
			updatedAt: '2026-06-01T14:00:00.000Z',
		});
	});

	it('MoveWorkItem exposes status="noop" with previousStatus when already in destination', async () => {
		vi.mocked(moveWorkItem).mockResolvedValue({
			status: 'noop',
			id: 'card-2',
			url: 'https://pm.example/card/card-2',
			destination: 'list-done',
			updatedAt: '2026-06-01T14:00:00.000Z',
			previousStatus: 'Done',
			previousStatusId: 'list-done',
			message: "Work item already in destination state 'Done' — no-op",
		} as never);
		const cmd = new MoveWorkItem(
			['--workItemId', 'card-2', '--destination', 'list-done', '--expectedSourceState', 'Backlog'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = readJsonOutput(logSpy);
		expect(output.data?.status).toBe('noop');
		expect(output.data?.previousStatus).toBe('Done');
		expect(output.data?.previousStatusId).toBe('list-done');
	});

	it('MoveWorkItem exposes status="aborted" when the guard rejected the move', async () => {
		vi.mocked(moveWorkItem).mockResolvedValue({
			status: 'aborted',
			id: 'card-2',
			url: 'https://pm.example/card/card-2',
			destination: 'list-done',
			updatedAt: '2026-06-01T14:00:00.000Z',
			previousStatus: 'In Progress',
			message: "Aborted: expected 'Backlog', found 'In Progress'",
		} as never);
		const cmd = new MoveWorkItem(
			['--workItemId', 'card-2', '--destination', 'list-done', '--expectedSourceState', 'Backlog'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = readJsonOutput(logSpy);
		expect(output.data?.status).toBe('aborted');
		expect(output.data?.previousStatus).toBe('In Progress');
	});

	it('AddChecklist stdout exposes checklistId, workItemUrl, itemIds, itemCount, status, and updatedAt', async () => {
		vi.mocked(addChecklist).mockResolvedValue({
			status: 'created',
			checklistId: 'cl-1',
			checklistName: 'Acceptance Criteria',
			workItemId: 'card-1',
			workItemUrl: 'https://pm.example/card/card-1',
			updatedAt: '2026-06-01T15:00:00.000Z',
			itemCount: 2,
			itemIds: ['item-1', 'item-2'],
		} as never);
		// AddChecklist's --item param is declared as `array of object`, so the
		// CLI factory expects a single JSON-encoded array payload.
		const cmd = new AddChecklist(
			[
				'--workItemId',
				'card-1',
				'--checklistName',
				'Acceptance Criteria',
				'--item',
				JSON.stringify([{ name: 'First step' }, { name: 'Second step' }]),
			],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(true);
		expect(output.data).toMatchObject({
			status: 'created',
			checklistId: 'cl-1',
			checklistName: 'Acceptance Criteria',
			workItemId: 'card-1',
			workItemUrl: 'https://pm.example/card/card-1',
			updatedAt: '2026-06-01T15:00:00.000Z',
			itemCount: 2,
			itemIds: ['item-1', 'item-2'],
		});
	});

	it('UpdateChecklistItem stdout exposes workItemUrl, checkItemId, status="updated", complete, and updatedAt', async () => {
		vi.mocked(updateChecklistItem).mockResolvedValue({
			status: 'updated',
			workItemId: 'card-1',
			workItemUrl: 'https://pm.example/card/card-1',
			checkItemId: 'item-456',
			complete: true,
			updatedAt: '2026-06-01T16:00:00.000Z',
		} as never);
		const cmd = new UpdateChecklistItem(
			['--workItemId', 'card-1', '--checkItemId', 'item-456', '--state', 'complete'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(true);
		expect(output.data).toMatchObject({
			status: 'updated',
			workItemId: 'card-1',
			workItemUrl: 'https://pm.example/card/card-1',
			checkItemId: 'item-456',
			complete: true,
			updatedAt: '2026-06-01T16:00:00.000Z',
		});
	});

	it('PMDeleteChecklistItem stdout exposes workItemUrl, checkItemId, status="deleted", and updatedAt', async () => {
		vi.mocked(deleteChecklistItem).mockResolvedValue({
			status: 'deleted',
			workItemId: 'card-1',
			workItemUrl: 'https://pm.example/card/card-1',
			checkItemId: 'item-456',
			updatedAt: '2026-06-01T16:30:00.000Z',
		} as never);
		const cmd = new DeleteChecklistItem(
			['--workItemId', 'card-1', '--checkItemId', 'item-456'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(true);
		expect(output.data).toMatchObject({
			status: 'deleted',
			workItemId: 'card-1',
			workItemUrl: 'https://pm.example/card/card-1',
			checkItemId: 'item-456',
			updatedAt: '2026-06-01T16:30:00.000Z',
		});
	});

	it('updatedAt values are ISO 8601 strings (regression guard against renderer drift)', async () => {
		// Pins the timestamp surface contract: cores prefer provider-supplied
		// timestamps and fall back to `currentTimestamp()` for synthetic outcomes.
		// Either way the CLI envelope must carry a parseable ISO 8601 string,
		// not a Date instance or a free-form prose value.
		vi.mocked(createWorkItem).mockResolvedValue({
			status: 'created',
			id: 'wi-new',
			title: 'X',
			url: 'https://pm.example/card/wi-new',
			updatedAt: '2026-06-01T17:00:00.000Z',
		} as never);
		const cmd = new CreateWorkItem(
			['--containerId', 'list-1', '--title', 'X'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		const output = readJsonOutput(logSpy);
		expect(typeof output.data?.updatedAt).toBe('string');
		expect(Number.isNaN(Date.parse(output.data?.updatedAt as string))).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// MNG-1428: Runtime failure envelopes
//
// Each PM mutation must surface fatal core errors as the spec-014 runtime
// envelope (`{ success: false, error: { type: 'runtime', message: ... } }`)
// — never as a successful prose sentinel like
// `"Error creating work item: ..."`. These tests pin the CLI translation per
// command so a regression that reverts to prose surfaces immediately.
// ---------------------------------------------------------------------------
describe('PM CLI runtime failure envelopes (MNG-1428)', () => {
	function readJsonOutput(logSpy: ReturnType<typeof vi.spyOn>) {
		const lines = logSpy.mock.calls.map((c) => c[0] as string);
		const jsonLine = lines.find((l) => typeof l === 'string' && l.startsWith('{')) ?? '';
		return JSON.parse(jsonLine) as {
			success: boolean;
			data?: unknown;
			error?: { type: string; message: string };
		};
	}

	it('CreateWorkItem surfaces a runtime envelope when createWorkItem throws', async () => {
		vi.mocked(createWorkItem).mockRejectedValueOnce(new Error('Provider 403'));
		const cmd = new CreateWorkItem(
			['--containerId', 'list-1', '--title', 'New Card'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		const exitSpy = vi.spyOn(cmd, 'exit');

		await runExpectingExit(cmd);

		expect(exitSpy).toHaveBeenCalledWith(1);
		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(false);
		expect(output.error).toEqual({ type: 'runtime', message: 'Provider 403' });
		expect(output.data).toBeUndefined();
	});

	it('UpdateWorkItem surfaces a runtime envelope when updateWorkItem throws', async () => {
		vi.mocked(updateWorkItem).mockRejectedValueOnce(new Error('Provider 422'));
		const cmd = new UpdateWorkItem(
			['--workItemId', 'card-9', '--title', 'New'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		const exitSpy = vi.spyOn(cmd, 'exit');

		await runExpectingExit(cmd);

		expect(exitSpy).toHaveBeenCalledWith(1);
		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(false);
		expect(output.error).toEqual({ type: 'runtime', message: 'Provider 422' });
	});

	it('MoveWorkItem surfaces a runtime envelope when moveWorkItem throws', async () => {
		vi.mocked(moveWorkItem).mockRejectedValueOnce(new Error('Provider 500'));
		const cmd = new MoveWorkItem(
			['--workItemId', 'card-2', '--destination', 'list-done'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		const exitSpy = vi.spyOn(cmd, 'exit');

		await runExpectingExit(cmd);

		expect(exitSpy).toHaveBeenCalledWith(1);
		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(false);
		expect(output.error).toEqual({ type: 'runtime', message: 'Provider 500' });
	});

	it('AddChecklist surfaces a runtime envelope when addChecklist throws', async () => {
		vi.mocked(addChecklist).mockRejectedValueOnce(new Error('Provider 429'));
		const cmd = new AddChecklist(
			[
				'--workItemId',
				'card-1',
				'--checklistName',
				'CL',
				'--item',
				JSON.stringify([{ name: 'step' }]),
			],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		const exitSpy = vi.spyOn(cmd, 'exit');

		await runExpectingExit(cmd);

		expect(exitSpy).toHaveBeenCalledWith(1);
		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(false);
		expect(output.error).toEqual({ type: 'runtime', message: 'Provider 429' });
	});

	it('UpdateChecklistItem surfaces a runtime envelope when updateChecklistItem throws', async () => {
		vi.mocked(updateChecklistItem).mockRejectedValueOnce(new Error('Provider 503'));
		const cmd = new UpdateChecklistItem(
			['--workItemId', 'card-1', '--checkItemId', 'item-456', '--state', 'complete'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		const exitSpy = vi.spyOn(cmd, 'exit');

		await runExpectingExit(cmd);

		expect(exitSpy).toHaveBeenCalledWith(1);
		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(false);
		expect(output.error).toEqual({ type: 'runtime', message: 'Provider 503' });
	});

	it('PMDeleteChecklistItem surfaces a runtime envelope when deleteChecklistItem throws', async () => {
		vi.mocked(deleteChecklistItem).mockRejectedValueOnce(new Error('Provider 404'));
		const cmd = new DeleteChecklistItem(
			['--workItemId', 'card-1', '--checkItemId', 'item-456'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		const exitSpy = vi.spyOn(cmd, 'exit');

		await runExpectingExit(cmd);

		expect(exitSpy).toHaveBeenCalledWith(1);
		const output = readJsonOutput(logSpy);
		expect(output.success).toBe(false);
		expect(output.error).toEqual({ type: 'runtime', message: 'Provider 404' });
	});
});

// ---------------------------------------------------------------------------
// post-comment update-channel gate (MNG-1687)
//
// `cascade-tools pm post-comment` must honor the per-agent update channel even
// when invoked via bash — the native-tool prompt-suppression layer only silences
// implementation.eta, so this CLI gate is the engine-wide defense for every
// PM-posting agent. It resolves the channel from CASCADE_UPDATE_CHANNEL, then
// falls back to the /tmp channel file (claude-code drops custom env vars from
// bash subprocesses), then defaults to `both` (post). When PM posting is
// disabled it returns a structured `{ skipped: true, reason }` instead of posting.
// ---------------------------------------------------------------------------
describe('PostComment command — update channel gate', () => {
	let originalChannelEnv: string | undefined;

	beforeEach(() => {
		originalChannelEnv = process.env.CASCADE_UPDATE_CHANNEL;
		Reflect.deleteProperty(process.env, 'CASCADE_UPDATE_CHANNEL');
		try {
			rmSync(UPDATE_CHANNEL_FILE, { force: true });
		} catch {
			/* no-op */
		}
		// Re-establish a resolved implementation (a prior test may have set a reject).
		vi.mocked(postComment).mockResolvedValue({ id: 'comment-1' } as never);
	});

	afterEach(() => {
		try {
			rmSync(UPDATE_CHANNEL_FILE, { force: true });
		} catch {
			/* no-op */
		}
		if (originalChannelEnv !== undefined) {
			process.env.CASCADE_UPDATE_CHANNEL = originalChannelEnv;
		} else {
			Reflect.deleteProperty(process.env, 'CASCADE_UPDATE_CHANNEL');
		}
	});

	it("posts when the channel is 'both' (env var)", async () => {
		process.env.CASCADE_UPDATE_CHANNEL = 'both';
		const cmd = new PostComment(
			['--workItemId', 'card-1', '--text', 'Hi'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		expect(postComment).toHaveBeenCalledWith('card-1', 'Hi');
		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(true);
		expect(output.data).toEqual({ id: 'comment-1' });
	});

	it('posts when no channel is configured (env absent, no file → defaults to both)', async () => {
		const cmd = new PostComment(
			['--workItemId', 'card-1', '--text', 'Hi'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(postComment).toHaveBeenCalledWith('card-1', 'Hi');
	});

	it("skips (does not post) when the channel is 'scm-only' (env var)", async () => {
		process.env.CASCADE_UPDATE_CHANNEL = 'scm-only';
		const cmd = new PostComment(
			['--workItemId', 'card-1', '--text', 'Hi'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		expect(postComment).not.toHaveBeenCalled();
		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(true);
		expect(output.data).toEqual({
			skipped: true,
			reason: 'PM posting disabled by update channel (scm-only)',
		});
	});

	it("skips when the channel is 'none' (env var)", async () => {
		process.env.CASCADE_UPDATE_CHANNEL = 'none';
		const cmd = new PostComment(
			['--workItemId', 'card-1', '--text', 'Hi'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		expect(postComment).not.toHaveBeenCalled();
		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.data).toEqual({
			skipped: true,
			reason: 'PM posting disabled by update channel (none)',
		});
	});

	it('falls back to the channel file when the env var is stripped (scm-only)', async () => {
		// Simulates the claude-code subprocess dropping CASCADE_UPDATE_CHANNEL:
		// the env var is absent, but the orchestrator wrote the /tmp channel file.
		writeFileSync(UPDATE_CHANNEL_FILE, 'scm-only', 'utf-8');
		const cmd = new PostComment(
			['--workItemId', 'card-1', '--text', 'Hi'],
			makeMockConfig() as never,
		);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		expect(postComment).not.toHaveBeenCalled();
		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.data).toEqual({
			skipped: true,
			reason: 'PM posting disabled by update channel (scm-only)',
		});
	});

	it('env var wins over the channel file when both are present', async () => {
		process.env.CASCADE_UPDATE_CHANNEL = 'both';
		writeFileSync(UPDATE_CHANNEL_FILE, 'scm-only', 'utf-8');
		const cmd = new PostComment(
			['--workItemId', 'card-1', '--text', 'Hi'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(postComment).toHaveBeenCalledWith('card-1', 'Hi');
	});

	it('defaults to both (posts) when the channel file holds invalid content', async () => {
		writeFileSync(UPDATE_CHANNEL_FILE, 'garbage-not-a-channel', 'utf-8');
		const cmd = new PostComment(
			['--workItemId', 'card-1', '--text', 'Hi'],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(postComment).toHaveBeenCalledWith('card-1', 'Hi');
	});
});
