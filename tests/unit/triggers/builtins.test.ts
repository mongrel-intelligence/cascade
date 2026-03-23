import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../../src/triggers/sentry/alerting-issue.js', () => ({
	SentryIssueAlertTrigger: vi.fn().mockImplementation(() => ({ name: 'sentry-issue-alert' })),
}));
vi.mock('../../../src/triggers/sentry/alerting-metric.js', () => ({
	SentryMetricAlertTrigger: vi.fn().mockImplementation(() => ({ name: 'sentry-metric-alert' })),
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

		// Should have registered all 20 built-in triggers (18 + 2 Sentry alerting triggers)
		expect(registry.register).toHaveBeenCalledTimes(20);
	});

	it('registers TrelloCommentMentionTrigger first', () => {
		const registry = createMockRegistry();

		registerBuiltInTriggers(registry as unknown as TriggerRegistry);

		const firstCall = registry.register.mock.calls[0][0];
		expect(firstCall.name).toBe('trello-comment-mention');
	});

	it('registers all four status-changed triggers (Trello)', () => {
		const registry = createMockRegistry();

		registerBuiltInTriggers(registry as unknown as TriggerRegistry);

		const registeredNames = registry.handlers.map((h: object) => (h as { name: string }).name);
		expect(registeredNames).toContain('trello-status-changed-splitting');
		expect(registeredNames).toContain('trello-status-changed-planning');
		expect(registeredNames).toContain('trello-status-changed-todo');
		expect(registeredNames).toContain('trello-status-changed-backlog');
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
