import { describe, expect, it, vi } from 'vitest';

// Mock all trigger imports
vi.mock('../../../src/triggers/github/check-suite-failure.js', () => ({
	CheckSuiteFailureTrigger: vi.fn().mockImplementation(() => ({ name: 'check-suite-failure' })),
}));
vi.mock('../../../src/triggers/github/check-suite-success.js', () => ({
	CheckSuiteSuccessTrigger: vi.fn().mockImplementation(() => ({ name: 'check-suite-success' })),
}));
vi.mock('../../../src/triggers/github/pr-comment-mention.js', () => ({
	PRCommentMentionTrigger: vi.fn().mockImplementation(() => ({ name: 'pr-comment-mention' })),
}));
vi.mock('../../../src/triggers/github/pr-conflict-detected.js', () => ({
	PRConflictDetectedTrigger: vi.fn().mockImplementation(() => ({ name: 'pr-conflict-detected' })),
}));
vi.mock('../../../src/triggers/github/pr-merged.js', () => ({
	PRMergedTrigger: vi.fn().mockImplementation(() => ({ name: 'pr-merged' })),
}));
vi.mock('../../../src/triggers/github/pr-opened.js', () => ({
	PROpenedTrigger: vi.fn().mockImplementation(() => ({ name: 'pr-opened' })),
}));
vi.mock('../../../src/triggers/github/pr-ready-to-merge.js', () => ({
	PRReadyToMergeTrigger: vi.fn().mockImplementation(() => ({ name: 'pr-ready-to-merge' })),
}));
vi.mock('../../../src/triggers/github/pr-review-submitted.js', () => ({
	PRReviewSubmittedTrigger: vi.fn().mockImplementation(() => ({ name: 'pr-review-submitted' })),
}));
vi.mock('../../../src/triggers/github/review-requested.js', () => ({
	ReviewRequestedTrigger: vi.fn().mockImplementation(() => ({ name: 'review-requested' })),
}));
vi.mock('../../../src/triggers/jira/comment-mention.js', () => ({
	JiraCommentMentionTrigger: vi.fn().mockImplementation(() => ({ name: 'jira-comment-mention' })),
}));
vi.mock('../../../src/triggers/jira/status-changed.js', () => ({
	JiraStatusChangedTrigger: vi.fn().mockImplementation(() => ({ name: 'jira-status-changed' })),
}));
vi.mock('../../../src/triggers/jira/label-added.js', () => ({
	JiraReadyToProcessLabelTrigger: vi.fn().mockImplementation(() => ({ name: 'jira-label-added' })),
}));
vi.mock('../../../src/triggers/trello/status-changed.js', () => ({
	TrelloStatusChangedSplittingTrigger: { name: 'trello-status-changed-splitting' },
	TrelloStatusChangedPlanningTrigger: { name: 'trello-status-changed-planning' },
	TrelloStatusChangedTodoTrigger: { name: 'trello-status-changed-todo' },
	TrelloStatusChangedBacklogTrigger: { name: 'trello-status-changed-backlog' },
	TrelloStatusChangedMergedTrigger: { name: 'trello-status-changed-merged' },
	TrelloCustomStatusChangedTrigger: vi
		.fn()
		.mockImplementation(() => ({ name: 'trello-status-changed-custom' })),
}));
vi.mock('../../../src/triggers/trello/comment-mention.js', () => ({
	TrelloCommentMentionTrigger: vi
		.fn()
		.mockImplementation(() => ({ name: 'trello-comment-mention' })),
}));
vi.mock('../../../src/triggers/trello/label-added.js', () => ({
	ReadyToProcessLabelTrigger: vi
		.fn()
		.mockImplementation(() => ({ name: 'ready-to-process-label' })),
}));

vi.mock('../../../src/triggers/gitlab/mr-approval.js', () => ({
	MRApprovalTrigger: vi.fn().mockImplementation(() => ({ name: 'mr-approval' })),
}));
vi.mock('../../../src/triggers/gitlab/mr-comment-mention.js', () => ({
	MRCommentMentionTrigger: vi.fn().mockImplementation(() => ({ name: 'mr-comment-mention' })),
}));
vi.mock('../../../src/triggers/gitlab/mr-conflict-detected.js', () => ({
	MRConflictDetectedTrigger: vi.fn().mockImplementation(() => ({ name: 'mr-conflict-detected' })),
}));
vi.mock('../../../src/triggers/gitlab/mr-merged.js', () => ({
	MRMergedTrigger: vi.fn().mockImplementation(() => ({ name: 'mr-merged' })),
}));
vi.mock('../../../src/triggers/gitlab/mr-opened.js', () => ({
	MROpenedTrigger: vi.fn().mockImplementation(() => ({ name: 'mr-opened' })),
}));
vi.mock('../../../src/triggers/gitlab/mr-ready-to-merge.js', () => ({
	MRReadyToMergeTrigger: vi.fn().mockImplementation(() => ({ name: 'mr-ready-to-merge' })),
}));
vi.mock('../../../src/triggers/gitlab/pipeline-failure.js', () => ({
	PipelineFailureTrigger: vi.fn().mockImplementation(() => ({ name: 'pipeline-failure' })),
}));
vi.mock('../../../src/triggers/gitlab/pipeline-success.js', () => ({
	PipelineSuccessTrigger: vi.fn().mockImplementation(() => ({ name: 'pipeline-success' })),
}));
vi.mock('../../../src/triggers/gitlab/mr-reviewer-added.js', () => ({
	MRReviewerAddedTrigger: vi.fn().mockImplementation(() => ({ name: 'mr-reviewer-added' })),
}));

vi.mock('../../../src/triggers/sentry/alerting-issue.js', () => ({
	SentryIssueAlertTrigger: vi.fn().mockImplementation(() => ({ name: 'sentry-issue-alert' })),
}));
vi.mock('../../../src/triggers/sentry/alerting-metric.js', () => ({
	SentryMetricAlertTrigger: vi.fn().mockImplementation(() => ({ name: 'sentry-metric-alert' })),
}));

vi.mock('../../../src/triggers/linear/comment-mention.js', () => ({
	LinearCommentMentionTrigger: vi
		.fn()
		.mockImplementation(() => ({ name: 'linear-comment-mention' })),
}));
vi.mock('../../../src/triggers/linear/status-changed.js', () => ({
	LinearStatusChangedTrigger: vi.fn().mockImplementation(() => ({ name: 'linear-status-changed' })),
}));
vi.mock('../../../src/triggers/linear/label-added.js', () => ({
	LinearReadyToProcessLabelTrigger: vi
		.fn()
		.mockImplementation(() => ({ name: 'linear-ready-to-process-label-added' })),
}));

// After plans 006/2, 006/3, and 006/4, every PM provider's triggers are
// contributed via the manifest registry. Mock listPMProviders() to return
// stub manifests whose triggerHandlers preserve the exact names the rest
// of this test file asserts on.
vi.mock('../../../src/integrations/pm/registry.js', () => ({
	listPMProviders: () => [
		{
			id: 'trello',
			triggerHandlers: [
				{ name: 'trello-comment-mention' },
				{ name: 'trello-status-changed-splitting' },
				{ name: 'trello-status-changed-planning' },
				{ name: 'trello-status-changed-todo' },
				{ name: 'trello-status-changed-backlog' },
				{ name: 'trello-status-changed-merged' },
				{ name: 'trello-status-changed-custom' },
				{ name: 'ready-to-process-label' },
			],
		},
		{
			id: 'jira',
			triggerHandlers: [
				{ name: 'jira-comment-mention' },
				{ name: 'jira-status-changed' },
				{ name: 'jira-label-added' },
			],
		},
		{
			id: 'linear',
			triggerHandlers: [
				{ name: 'linear-comment-mention' },
				{ name: 'linear-status-changed' },
				{ name: 'linear-ready-to-process-label-added' },
			],
		},
	],
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { registerBuiltInTriggers } from '../../../src/triggers/builtins.js';
import type { TriggerRegistry } from '../../../src/triggers/registry.js';

function createMockRegistry(): { register: ReturnType<typeof vi.fn>; handlers: object[] } {
	const handlers: object[] = [];
	return {
		register: vi.fn((handler) => handlers.push(handler)),
		handlers,
	};
}

describe('registerBuiltInTriggers', () => {
	it('registers all expected trigger handlers', () => {
		const registry = createMockRegistry();

		registerBuiltInTriggers(registry as unknown as TriggerRegistry);

		// Should have registered all 35 built-in triggers (26 base + 9 GitLab triggers).
		// Base 26: 20 GitHub/Trello/JIRA + 3 Sentry alerting + 3 Linear triggers,
		// including TrelloCustomStatusChangedTrigger for custom mapped lists.
		expect(registry.register).toHaveBeenCalledTimes(35);
	});

	it('registers TrelloCommentMentionTrigger first', () => {
		const registry = createMockRegistry();

		registerBuiltInTriggers(registry as unknown as TriggerRegistry);

		const firstCall = registry.register.mock.calls[0][0];
		expect(firstCall.name).toBe('trello-comment-mention');
	});

	it('registers all five status-changed triggers (Trello)', () => {
		const registry = createMockRegistry();

		registerBuiltInTriggers(registry as unknown as TriggerRegistry);

		const registeredNames = registry.handlers.map((h: object) => (h as { name: string }).name);
		expect(registeredNames).toContain('trello-status-changed-splitting');
		expect(registeredNames).toContain('trello-status-changed-planning');
		expect(registeredNames).toContain('trello-status-changed-todo');
		expect(registeredNames).toContain('trello-status-changed-backlog');
		expect(registeredNames).toContain('trello-status-changed-merged');
	});

	it('registers TrelloCustomStatusChangedTrigger after built-in status triggers and before ready-label trigger', () => {
		const registry = createMockRegistry();

		registerBuiltInTriggers(registry as unknown as TriggerRegistry);

		const names = registry.handlers.map((h: object) => (h as { name: string }).name);
		const customIdx = names.indexOf('trello-status-changed-custom');
		const mergedIdx = names.indexOf('trello-status-changed-merged');
		const readyLabelIdx = names.indexOf('ready-to-process-label');

		expect(customIdx).toBeGreaterThanOrEqual(0);
		expect(mergedIdx).toBeLessThan(customIdx);
		expect(customIdx).toBeLessThan(readyLabelIdx);
	});

	it('registers GitHub triggers', () => {
		const registry = createMockRegistry();

		registerBuiltInTriggers(registry as unknown as TriggerRegistry);

		const registeredNames = registry.handlers.map((h: object) => (h as { name: string }).name);
		expect(registeredNames).toContain('check-suite-failure');
		expect(registeredNames).toContain('check-suite-success');
		expect(registeredNames).toContain('pr-comment-mention');
		expect(registeredNames).toContain('pr-conflict-detected');
		expect(registeredNames).toContain('pr-merged');
		expect(registeredNames).toContain('pr-opened');
		expect(registeredNames).toContain('pr-ready-to-merge');
		expect(registeredNames).toContain('pr-review-submitted');
		expect(registeredNames).toContain('review-requested');
	});

	it('registers JIRA triggers', () => {
		const registry = createMockRegistry();

		registerBuiltInTriggers(registry as unknown as TriggerRegistry);

		const registeredNames = registry.handlers.map((h: object) => (h as { name: string }).name);
		expect(registeredNames).toContain('jira-comment-mention');
		expect(registeredNames).toContain('jira-status-changed');
		expect(registeredNames).toContain('jira-label-added');
	});

	it('registers Linear triggers', () => {
		const registry = createMockRegistry();

		registerBuiltInTriggers(registry as unknown as TriggerRegistry);

		const registeredNames = registry.handlers.map((h: object) => (h as { name: string }).name);
		expect(registeredNames).toContain('linear-comment-mention');
		expect(registeredNames).toContain('linear-status-changed');
		expect(registeredNames).toContain('linear-ready-to-process-label-added');
	});

	it('registers Sentry alerting triggers', () => {
		const registry = createMockRegistry();

		registerBuiltInTriggers(registry as unknown as TriggerRegistry);

		const registeredNames = registry.handlers.map((h: object) => (h as { name: string }).name);
		expect(registeredNames).toContain('sentry-issue-alert');
		expect(registeredNames).toContain('sentry-metric-alert');
	});

	it('registers TrelloCommentMentionTrigger before status-changed triggers', () => {
		const registry = createMockRegistry();

		registerBuiltInTriggers(registry as unknown as TriggerRegistry);

		const names = registry.handlers.map((h: object) => (h as { name: string }).name);
		const commentMentionIdx = names.indexOf('trello-comment-mention');
		const statusChangedIdx = names.indexOf('trello-status-changed-splitting');
		expect(commentMentionIdx).toBeLessThan(statusChangedIdx);
	});

	it('registers JiraCommentMentionTrigger before JiraStatusChangedTrigger', () => {
		const registry = createMockRegistry();

		registerBuiltInTriggers(registry as unknown as TriggerRegistry);

		const names = registry.handlers.map((h: object) => (h as { name: string }).name);
		const jiraCommentIdx = names.indexOf('jira-comment-mention');
		const jiraStatusIdx = names.indexOf('jira-status-changed');
		expect(jiraCommentIdx).toBeLessThan(jiraStatusIdx);
	});

	it('registers PRCommentMentionTrigger before other GitHub triggers', () => {
		const registry = createMockRegistry();

		registerBuiltInTriggers(registry as unknown as TriggerRegistry);

		const names = registry.handlers.map((h: object) => (h as { name: string }).name);
		const prCommentIdx = names.indexOf('pr-comment-mention');
		const prReviewIdx = names.indexOf('pr-review-submitted');
		expect(prCommentIdx).toBeLessThan(prReviewIdx);
	});
});
