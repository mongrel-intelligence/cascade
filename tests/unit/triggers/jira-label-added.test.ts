import { describe, expect, it, vi } from 'vitest';
import {
	mockAcknowledgmentsModule,
	mockConfigProvider,
	mockConfigResolverModule,
	mockJiraClientModule,
	mockReactionsModule,
	mockTrelloClientModule,
	mockTriggerCheckModule,
} from '../../helpers/sharedMocks.js';

vi.mock('../../../src/triggers/config-resolver.js', () => mockConfigResolverModule);
vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

// Mocks required for PM integration registration (integrations/bootstrap.js side-effect)
vi.mock('../../../src/config/provider.js', () => mockConfigProvider);
vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	getIntegrationProvider: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../../src/trello/client.js', () => mockTrelloClientModule);
vi.mock('../../../src/jira/client.js', () => mockJiraClientModule);
vi.mock('../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn((_token: unknown, fn: () => unknown) => fn()),
}));
vi.mock('../../../src/sentry/integration.js', () => ({
	getSentryIntegrationConfig: vi.fn().mockResolvedValue(null),
	hasAlertingIntegration: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../../src/router/acknowledgments.js', () => mockAcknowledgmentsModule);
vi.mock('../../../src/router/reactions.js', () => mockReactionsModule);

// Register PM integrations in the registry via the canonical bootstrap path
import '../../../src/integrations/bootstrap.js';

import { JiraReadyToProcessLabelTrigger } from '../../../src/triggers/jira/label-added.js';
import { checkTriggerEnabled } from '../../../src/triggers/shared/trigger-check.js';
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
		it('should return null when trigger is disabled for the resolved agent', async () => {
			vi.mocked(checkTriggerEnabled).mockResolvedValueOnce(false);

			const result = await trigger.handle(buildCtx({ statusName: 'Splitting' }));
			expect(result).toBeNull();
			expect(checkTriggerEnabled).toHaveBeenCalledWith(
				'test-project',
				'splitting',
				'pm:label-added',
				'jira-ready-to-process-label-added',
			);
		});

		it('returns splitting agent for issue in Briefing status', async () => {
			const result = await trigger.handle(buildCtx({ statusName: 'Splitting' }));
			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('splitting');
			expect(result?.workItemId).toBe('TEST-42');
			expect(result?.agentInput.workItemId).toBe('TEST-42');
			expect(result?.agentInput.triggerEvent).toBe('pm:label-added');
		});

		it('populates workItemUrl and workItemTitle from Jira issue data', async () => {
			const result = await trigger.handle(buildCtx({ statusName: 'Splitting' }));
			expect(result).not.toBeNull();
			expect(result?.workItemUrl).toBe('https://test.atlassian.net/browse/TEST-42');
			expect(result?.workItemTitle).toBe('Test issue');
			expect(result?.agentInput.workItemUrl).toBe('https://test.atlassian.net/browse/TEST-42');
			expect(result?.agentInput.workItemTitle).toBe('Test issue');
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
