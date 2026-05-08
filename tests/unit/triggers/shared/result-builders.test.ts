import { describe, expect, it, vi } from 'vitest';
import { TRIGGER_EVENTS } from '../../../../src/triggers/shared/events.js';
import {
	buildDeferredRecheckResult,
	buildGitHubPRDispatchResult,
	buildNoAgentResult,
	buildPMDispatchResult,
	buildSkipResult,
} from '../../../../src/triggers/shared/result-builders.js';

describe('trigger result builders', () => {
	it('builds PM dispatch results and mirrors workItemId into agentInput', () => {
		const result = buildPMDispatchResult({
			agentType: 'implementation',
			triggerEvent: TRIGGER_EVENTS.PM.STATUS_CHANGED,
			workItemId: 'card-123',
			workItemUrl: 'https://trello.com/c/abc',
			workItemTitle: 'Implement feature',
			agentInput: {
				workItemId: 'stale-id',
				modelOverride: 'gpt-test',
			},
		});

		expect(result).toEqual({
			agentType: 'implementation',
			agentInput: {
				workItemId: 'card-123',
				modelOverride: 'gpt-test',
				triggerEvent: 'pm:status-changed',
			},
			workItemId: 'card-123',
			workItemUrl: 'https://trello.com/c/abc',
			workItemTitle: 'Implement feature',
			onBlocked: undefined,
			coalesceKey: undefined,
		});
	});

	it('builds GitHub PR dispatch results and mirrors a linked work item into agentInput', () => {
		const onBlocked = vi.fn();

		const result = buildGitHubPRDispatchResult({
			agentType: 'review',
			triggerEvent: TRIGGER_EVENTS.SCM.PR_OPENED,
			prNumber: 42,
			prUrl: 'https://github.com/acme/repo/pull/42',
			prTitle: 'feat: add thing',
			workItemId: 'card-456',
			agentInput: {
				prNumber: 42,
				repoFullName: 'acme/repo',
			},
			onBlocked,
		});

		expect(result).toEqual({
			agentType: 'review',
			agentInput: {
				prNumber: 42,
				repoFullName: 'acme/repo',
				triggerEvent: 'scm:pr-opened',
				workItemId: 'card-456',
			},
			prNumber: 42,
			prUrl: 'https://github.com/acme/repo/pull/42',
			prTitle: 'feat: add thing',
			workItemId: 'card-456',
			workItemUrl: undefined,
			workItemTitle: undefined,
			onBlocked,
			coalesceKey: undefined,
		});
	});

	it('builds GitHub PR dispatch results without a workItemId when none is linked', () => {
		const result = buildGitHubPRDispatchResult({
			agentType: 'review',
			triggerEvent: TRIGGER_EVENTS.SCM.CHECK_SUITE_SUCCESS,
			prNumber: 42,
			agentInput: {
				prNumber: 42,
			},
		});

		expect(result.agentInput).toEqual({
			prNumber: 42,
			triggerEvent: 'scm:check-suite-success',
		});
		expect(result.workItemId).toBeUndefined();
	});

	it('builds structured skip results with the existing skip payload shape', () => {
		expect(buildSkipResult('check-suite-success', 'not all checks complete')).toEqual({
			agentType: null,
			agentInput: {},
			skipReason: {
				handler: 'check-suite-success',
				message: 'not all checks complete',
			},
		});
	});

	it('builds no-agent operation results', () => {
		expect(
			buildNoAgentResult({ lockKey: 'sentry:issue-1', coalesceKey: 'p1:sentry:issue-1' }),
		).toEqual({
			agentType: null,
			agentInput: {},
			lockKey: 'sentry:issue-1',
			coalesceKey: 'p1:sentry:issue-1',
		});
	});

	it('builds deferred re-check results with scheduler metadata', () => {
		expect(
			buildDeferredRecheckResult({
				delayMs: 45_000,
				coalesceKey: 'p1:pr-conflict-recheck:42',
			}),
		).toEqual({
			agentType: null,
			agentInput: {},
			deferredRecheck: {
				delayMs: 45_000,
				coalesceKey: 'p1:pr-conflict-recheck:42',
			},
		});
	});
});
