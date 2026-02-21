import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		warn: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		error: vi.fn(),
	},
}));

import { JiraIssueTransitionedTrigger } from '../../../src/triggers/jira/issue-transitioned.js';
import type { TriggerContext } from '../../../src/triggers/types.js';

const mockProject = {
	id: 'test-project',
	name: 'Test Project',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	jira: {
		projectKey: 'PROJ',
		statuses: {
			briefing: 'Briefing',
			planning: 'Planning',
			todo: 'To Do',
			done: 'Done',
		},
	},
} as TriggerContext['project'];

function buildCtx(
	overrides: {
		source?: TriggerContext['source'];
		webhookEvent?: string;
		issueKey?: string;
		statusChangeItems?: Array<{ field?: string; fromString?: string; toString?: string }>;
		noJiraConfig?: boolean;
	} = {},
): TriggerContext {
	const project = overrides.noJiraConfig ? { ...mockProject, jira: undefined } : mockProject;

	return {
		project: project as TriggerContext['project'],
		source: overrides.source ?? 'jira',
		payload: {
			webhookEvent: overrides.webhookEvent ?? 'jira:issue_updated',
			issue:
				overrides.issueKey !== undefined
					? { key: overrides.issueKey, fields: { summary: 'Test Issue' } }
					: { key: 'PROJ-42', fields: { summary: 'Test Issue' } },
			changelog: {
				items: overrides.statusChangeItems ?? [
					{ field: 'status', fromString: 'Backlog', toString: 'Briefing' },
				],
			},
		},
	};
}

describe('JiraIssueTransitionedTrigger', () => {
	let trigger: JiraIssueTransitionedTrigger;

	beforeEach(() => {
		vi.resetAllMocks();
		trigger = new JiraIssueTransitionedTrigger();
	});

	describe('matches', () => {
		it('matches jira:issue_updated event with status change', () => {
			expect(trigger.matches(buildCtx())).toBe(true);
		});

		it('does not match non-jira source', () => {
			expect(trigger.matches(buildCtx({ source: 'trello' }))).toBe(false);
		});

		it('does not match non-issue_updated webhook events', () => {
			expect(trigger.matches(buildCtx({ webhookEvent: 'jira:issue_created' }))).toBe(false);
		});

		it('does not match when no status change in changelog', () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'assignee', fromString: 'Alice', toString: 'Bob' }],
			});
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match when changelog items is empty', () => {
			const ctx = buildCtx({ statusChangeItems: [] });
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('matches jira:issue_updated with any suffix', () => {
			expect(trigger.matches(buildCtx({ webhookEvent: 'jira:issue_updated:something' }))).toBe(
				true,
			);
		});
	});

	describe('resolveAgentType', () => {
		it('returns implementation for "To Do" transition', () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'Planning', toString: 'To Do' }],
			});
			expect(trigger.resolveAgentType(ctx)).toBe('implementation');
		});

		it('returns briefing for "Briefing" transition', () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'Backlog', toString: 'Briefing' }],
			});
			expect(trigger.resolveAgentType(ctx)).toBe('briefing');
		});

		it('returns planning for "Planning" transition', () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'Briefing', toString: 'Planning' }],
			});
			expect(trigger.resolveAgentType(ctx)).toBe('planning');
		});

		it('returns null for unmapped status', () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'To Do', toString: 'Done' }],
			});
			expect(trigger.resolveAgentType(ctx)).toBeNull();
		});

		it('returns null when no status change in changelog', () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'assignee' }],
			});
			expect(trigger.resolveAgentType(ctx)).toBeNull();
		});

		it('returns null when JIRA config is missing', () => {
			const ctx = buildCtx({ noJiraConfig: true });
			expect(trigger.resolveAgentType(ctx)).toBeNull();
		});

		it('is case insensitive', () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'Backlog', toString: 'briefing' }],
			});
			expect(trigger.resolveAgentType(ctx)).toBe('briefing');
		});
	});

	describe('handle', () => {
		it('returns implementation agent for "To Do" transition', async () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'Planning', toString: 'To Do' }],
			});

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('implementation');
			expect(result?.workItemId).toBe('PROJ-42');
			expect(result?.cardId).toBe('PROJ-42');
			expect(result?.agentInput).toEqual({ cardId: 'PROJ-42' });
		});

		it('returns briefing agent for "Briefing" transition', async () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'Backlog', toString: 'Briefing' }],
			});

			const result = await trigger.handle(ctx);

			expect(result?.agentType).toBe('briefing');
		});

		it('returns planning agent for "Planning" transition', async () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'Briefing', toString: 'Planning' }],
			});

			const result = await trigger.handle(ctx);

			expect(result?.agentType).toBe('planning');
		});

		it('is case insensitive when matching status names', async () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'Backlog', toString: 'briefing' }],
			});

			const result = await trigger.handle(ctx);

			expect(result?.agentType).toBe('briefing');
		});

		it('returns null for unmapped status transitions', async () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'status', fromString: 'To Do', toString: 'Done' }],
			});

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('returns null when issue key is missing', async () => {
			const ctx = buildCtx({ issueKey: '' });
			(ctx.payload as Record<string, unknown>).issue = undefined;

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('returns null when no status change item in changelog', async () => {
			const ctx = buildCtx({
				statusChangeItems: [{ field: 'assignee' }],
			});

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('returns null when JIRA config is missing', async () => {
			const ctx = buildCtx({ noJiraConfig: true });

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('returns null when status change has an empty toString value', async () => {
			const ctx = buildCtx({
				// Use an empty string for toString so that !newStatus is true
				statusChangeItems: [{ field: 'status', fromString: 'Backlog', toString: '' }],
			});

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});
	});
});
