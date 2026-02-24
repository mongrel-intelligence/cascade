import { describe, expect, it, vi } from 'vitest';

// Mocks required for PM integration registration (pm/index.js side-effect)
vi.mock('../../../src/config/provider.js', () => ({
	getIntegrationCredential: vi.fn(),
	loadProjectConfigByBoardId: vi.fn(),
	loadProjectConfigByJiraProjectKey: vi.fn(),
	findProjectById: vi.fn(),
}));
vi.mock('../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn(),
	trelloClient: { getCard: vi.fn() },
}));
vi.mock('../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn(),
	jiraClient: {},
}));
vi.mock('../../../src/router/acknowledgments.js', () => ({
	postTrelloAck: vi.fn(),
	deleteTrelloAck: vi.fn(),
	resolveTrelloBotMemberId: vi.fn(),
	postJiraAck: vi.fn(),
	deleteJiraAck: vi.fn(),
	resolveJiraBotAccountId: vi.fn(),
}));
vi.mock('../../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: vi.fn(),
}));

// Register PM integrations in the registry
import '../../../src/pm/index.js';

import { JiraReadyToProcessLabelTrigger } from '../../../src/triggers/jira/label-added.js';
import type { TriggerContext } from '../../../src/types/index.js';

const trigger = new JiraReadyToProcessLabelTrigger();

const baseJiraConfig = {
	projectKey: 'TEST',
	baseUrl: 'https://test.atlassian.net',
	statuses: {
		splitting: 'Splitting',
		planning: 'Planning',
		todo: 'To Do',
		inProgress: 'In Progress',
		inReview: 'In Review',
		done: 'Done',
	},
};

const baseProject = {
	id: 'test-project',
	orgId: 'test-org',
	name: 'Test Project',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	pm: { type: 'jira' as const },
	jira: baseJiraConfig,
} as TriggerContext['project'];

function buildCtx(overrides: {
	source?: TriggerContext['source'];
	webhookEvent?: string;
	issueKey?: string;
	statusName?: string;
	changelogItems?: Array<{ field?: string; fromString?: string; toString?: string }>;
	project?: TriggerContext['project'];
}): TriggerContext {
	return {
		project: overrides.project ?? baseProject,
		source: overrides.source ?? 'jira',
		payload: {
			webhookEvent: overrides.webhookEvent ?? 'jira:issue_updated',
			issue: {
				key: overrides.issueKey ?? 'TEST-42',
				fields: {
					project: { key: 'TEST' },
					status: { name: overrides.statusName ?? 'Splitting' },
					summary: 'Test issue',
				},
			},
			changelog: {
				items: overrides.changelogItems ?? [
					{
						field: 'labels',
						fromString: '',
						toString: 'cascade-ready',
					},
				],
			},
		},
	};
}

describe('JiraReadyToProcessLabelTrigger', () => {
	describe('matches()', () => {
		it('matches when cascade-ready label is added', () => {
			expect(trigger.matches(buildCtx({}))).toBe(true);
		});

		it('rejects non-jira source', () => {
			expect(trigger.matches(buildCtx({ source: 'trello' }))).toBe(false);
		});

		it('rejects non-issue_updated events', () => {
			expect(trigger.matches(buildCtx({ webhookEvent: 'jira:issue_created' }))).toBe(false);
		});

		it('rejects when no label change in changelog', () => {
			expect(
				trigger.matches(
					buildCtx({
						changelogItems: [{ field: 'summary', fromString: 'old', toString: 'new' }],
					}),
				),
			).toBe(false);
		});

		it('rejects when status change is also present (double-trigger prevention)', () => {
			expect(
				trigger.matches(
					buildCtx({
						changelogItems: [
							{ field: 'labels', fromString: '', toString: 'cascade-ready' },
							{ field: 'status', fromString: 'Backlog', toString: 'Splitting' },
						],
					}),
				),
			).toBe(false);
		});

		it('rejects when a different label is added', () => {
			expect(
				trigger.matches(
					buildCtx({
						changelogItems: [{ field: 'labels', fromString: '', toString: 'some-other-label' }],
					}),
				),
			).toBe(false);
		});

		it('matches when cascade-ready is among multiple added labels', () => {
			expect(
				trigger.matches(
					buildCtx({
						changelogItems: [
							{
								field: 'labels',
								fromString: 'existing-label',
								toString: 'existing-label cascade-ready another-label',
							},
						],
					}),
				),
			).toBe(true);
		});

		it('rejects when cascade-ready was already present (not newly added)', () => {
			expect(
				trigger.matches(
					buildCtx({
						changelogItems: [
							{
								field: 'labels',
								fromString: 'cascade-ready',
								toString: 'cascade-ready some-new-label',
							},
						],
					}),
				),
			).toBe(false);
		});

		it('matches with custom readyToProcess label from config', () => {
			const customProject = {
				...baseProject,
				jira: {
					...baseJiraConfig,
					labels: {
						processing: 'my-processing',
						processed: 'my-processed',
						error: 'my-error',
						readyToProcess: 'my-ready',
					},
				},
			} as TriggerContext['project'];

			expect(
				trigger.matches(
					buildCtx({
						project: customProject,
						changelogItems: [{ field: 'labels', fromString: '', toString: 'my-ready' }],
					}),
				),
			).toBe(true);
		});

		it('rejects when changelog is missing', () => {
			const ctx: TriggerContext = {
				project: baseProject,
				source: 'jira',
				payload: {
					webhookEvent: 'jira:issue_updated',
					issue: { key: 'TEST-1', fields: { status: { name: 'Splitting' } } },
				},
			};
			expect(trigger.matches(ctx)).toBe(false);
		});
	});

	describe('handle()', () => {
		it('returns splitting agent for issue in Briefing status', async () => {
			const result = await trigger.handle(buildCtx({ statusName: 'Splitting' }));
			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('splitting');
			expect(result?.workItemId).toBe('TEST-42');
			expect(result?.agentInput.cardId).toBe('TEST-42');
		});

		it('returns planning agent for issue in Planning status', async () => {
			const result = await trigger.handle(buildCtx({ statusName: 'Planning' }));
			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('planning');
		});

		it('returns implementation agent for issue in To Do status', async () => {
			const result = await trigger.handle(buildCtx({ statusName: 'To Do' }));
			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('implementation');
		});

		it('returns null for unmapped status', async () => {
			const result = await trigger.handle(buildCtx({ statusName: 'Done' }));
			expect(result).toBeNull();
		});

		it('returns null when issue key is missing', async () => {
			const ctx = buildCtx({});
			(ctx.payload as Record<string, unknown>).issue = undefined;
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when statuses not configured', async () => {
			const noStatusProject = {
				...baseProject,
				jira: {
					projectKey: 'TEST',
					baseUrl: 'https://test.atlassian.net',
					statuses: undefined as unknown as Record<string, string>,
				},
			} as TriggerContext['project'];

			const result = await trigger.handle(buildCtx({ project: noStatusProject }));
			expect(result).toBeNull();
		});

		it('performs case-insensitive status matching', async () => {
			const result = await trigger.handle(buildCtx({ statusName: 'splitting' }));
			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('splitting');
		});

		it('returns null when status field is missing from issue', async () => {
			const ctx = buildCtx({});
			const payload = ctx.payload as { issue: { fields: Record<string, unknown> } };
			payload.issue.fields.status = undefined;
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});
	});
});
