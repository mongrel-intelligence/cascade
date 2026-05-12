/**
 * Tests for `SentryIssueLifecycleTrigger` — the handler for the
 * `Sentry-Hook-Resource: issue` surface. Mirrors the shape of
 * `SentryIssueAlertTrigger` (event_alert) but matches on `resource: 'issue'`
 * and the `'created'` lifecycle action.
 *
 * Captured shape from prod webhook id `fbdc6d87-b962-444c-8a2a-a9452a74ff71`
 * (2026-05-09 13:18:51 UTC).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockLogger, mockTriggerCheckModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/utils/logging.js', () => ({ logger: mockLogger }));
vi.mock('../../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

vi.mock('../../../../src/sentry/integration.js', () => ({
	getSentryIntegrationConfig: vi.fn(),
}));

vi.mock('../../../../src/pm/config.js', () => ({
	getAlertsContainerId: vi.fn(),
}));

import { getAlertsContainerId } from '../../../../src/pm/config.js';
import { getSentryIntegrationConfig } from '../../../../src/sentry/integration.js';
import { SentryIssueLifecycleTrigger } from '../../../../src/triggers/sentry/alerting-issue-lifecycle.js';
import { checkTriggerEnabledWithParams } from '../../../../src/triggers/shared/trigger-check.js';
import type { TriggerContext } from '../../../../src/types/index.js';
import { createMockProject } from '../../../helpers/factories.js';

const mockProject = createMockProject({
	trello: {
		boardId: 'board123',
		lists: {
			splitting: 'split-list',
			planning: 'plan-list',
			todo: 'todo-list',
			alerts: 'alerts-list',
		},
		labels: {},
	},
});

const sentryConfig = { organizationSlug: 'mongrel' };

function makeIssueLifecycleCtx(
	overrides: {
		resource?: string;
		action?: string;
		issueOverrides?: Partial<{
			id: string;
			title: string;
			web_url: string;
			permalink: string;
			level: string;
			shortId: string;
			culprit: string;
		}>;
	} = {},
): TriggerContext {
	const issue = {
		id: '118723355',
		title:
			'Error: wedged work-item lock: projectId=ucho workItemId=MNG-598 agentType=backlog-manager',
		web_url: 'https://mongrel.sentry.io/issues/118723355/',
		permalink: 'https://mongrel.sentry.io/issues/118723355/',
		shortId: 'CASCADE-2T',
		level: 'error',
		culprit: 'POST /github/webhook',
		metadata: {
			type: 'Error',
			filename: '/app/dist/router/webhook-dispatch-locks.js',
			function: 'checkDispatchLocks',
		},
		firstSeen: '2026-05-09T13:18:37.078000+00:00',
		...(overrides.issueOverrides ?? {}),
	};
	return {
		project: mockProject,
		source: 'sentry',
		payload: {
			resource: overrides.resource ?? 'issue',
			payload: {
				action: overrides.action ?? 'created',
				actor: { id: 'sentry', name: 'Sentry', type: 'application' },
				data: { issue },
			},
			cascadeProjectId: 'test',
		},
	} as TriggerContext;
}

describe('SentryIssueLifecycleTrigger', () => {
	let trigger: SentryIssueLifecycleTrigger;

	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({ enabled: true, parameters: {} });
		vi.mocked(getSentryIntegrationConfig).mockResolvedValue(sentryConfig);
		vi.mocked(getAlertsContainerId).mockReturnValue('alerts-list');
		trigger = new SentryIssueLifecycleTrigger();
	});

	// -------------------------------------------------------------------------
	// matches()
	// -------------------------------------------------------------------------

	describe('matches()', () => {
		it('returns true for sentry source with resource=issue + action=created', () => {
			expect(trigger.matches(makeIssueLifecycleCtx())).toBe(true);
		});

		it('returns false for non-sentry source', () => {
			const ctx = { ...makeIssueLifecycleCtx(), source: 'github' } as TriggerContext;
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('returns false when resource is event_alert (the SentryIssueAlertTrigger surface)', () => {
			expect(trigger.matches(makeIssueLifecycleCtx({ resource: 'event_alert' }))).toBe(false);
		});

		it('returns false when resource is metric_alert', () => {
			expect(trigger.matches(makeIssueLifecycleCtx({ resource: 'metric_alert' }))).toBe(false);
		});

		it('returns false for resolved action (lifecycle event we do not yet handle)', () => {
			expect(trigger.matches(makeIssueLifecycleCtx({ action: 'resolved' }))).toBe(false);
		});

		it('returns false for archived action', () => {
			expect(trigger.matches(makeIssueLifecycleCtx({ action: 'archived' }))).toBe(false);
		});

		it('returns false for assigned action', () => {
			expect(trigger.matches(makeIssueLifecycleCtx({ action: 'assigned' }))).toBe(false);
		});
	});

	// -------------------------------------------------------------------------
	// handle()
	// -------------------------------------------------------------------------

	describe('handle()', () => {
		it('returns null when trigger is disabled', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({
				enabled: false,
				parameters: {},
			});
			const result = await trigger.handle(makeIssueLifecycleCtx());
			expect(result).toBeNull();
		});

		it('returns null when issue ID is missing', async () => {
			const result = await trigger.handle(
				makeIssueLifecycleCtx({ issueOverrides: { id: '' as unknown as string } }),
			);
			expect(result).toBeNull();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('cannot determine issue ID'),
				expect.any(Object),
			);
		});

		it('returns null when Sentry integration config is missing', async () => {
			vi.mocked(getSentryIntegrationConfig).mockResolvedValue(null);
			const result = await trigger.handle(makeIssueLifecycleCtx());
			expect(result).toBeNull();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('no Sentry integration config'),
				expect.any(Object),
			);
		});

		it('returns null when alerts slot is not configured (pre-flight skip)', async () => {
			vi.mocked(getAlertsContainerId).mockReturnValue(undefined);
			const result = await trigger.handle(makeIssueLifecycleCtx());
			expect(result).toBeNull();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('alerts slot not configured'),
				expect.any(Object),
			);
		});

		it('returns a TriggerResult with alertIssueId from data.issue.id', async () => {
			const result = await trigger.handle(makeIssueLifecycleCtx());
			expect(result).toMatchObject({
				agentType: 'alerting',
				agentInput: {
					triggerEvent: 'alerting:issue-lifecycle',
					alertIssueId: '118723355',
					alertOrgId: 'mongrel',
					alertIssueUrl: 'https://mongrel.sentry.io/issues/118723355/',
				},
			});
		});

		it('uses data.issue.title as alertTitle', async () => {
			const result = await trigger.handle(makeIssueLifecycleCtx());
			expect(result?.agentInput?.alertTitle).toContain('wedged work-item lock');
		});

		it('falls back to default alertTitle when title is empty', async () => {
			const result = await trigger.handle(makeIssueLifecycleCtx({ issueOverrides: { title: '' } }));
			expect(result?.agentInput?.alertTitle).toBe('Sentry Issue');
		});

		it('falls back to default alertTitle when title is stringified undefined', async () => {
			const result = await trigger.handle(
				makeIssueLifecycleCtx({ issueOverrides: { title: 'undefined' } }),
			);
			expect(result?.agentInput?.alertTitle).toBe('Sentry Issue');
		});

		it('falls back to permalink for alertIssueUrl when web_url is missing', async () => {
			const result = await trigger.handle(
				makeIssueLifecycleCtx({
					issueOverrides: {
						web_url: undefined as unknown as string,
						permalink: 'https://mongrel.sentry.io/perma/118723355/',
					},
				}),
			);
			expect(result?.agentInput?.alertIssueUrl).toBe('https://mongrel.sentry.io/perma/118723355/');
		});

		it('does NOT set workItemId — materialisation is deferred to processSentryWebhook', async () => {
			const result = await trigger.handle(makeIssueLifecycleCtx());
			expect(result?.workItemId).toBeUndefined();
			expect(result?.agentInput?.workItemId).toBeUndefined();
		});

		it('uses a sentry-issue-namespaced lockKey distinct from event_alert', async () => {
			const result = await trigger.handle(makeIssueLifecycleCtx());
			// Distinct from `sentry:<id>` (event_alert) so the same issue can
			// arrive via both surfaces concurrently without lock contention.
			expect(result?.lockKey).toBe('sentry-issue:118723355');
		});

		it('uses a sentry-issue-namespaced coalesceKey', async () => {
			const result = await trigger.handle(makeIssueLifecycleCtx());
			expect(result?.coalesceKey).toBe(`${mockProject.id}:sentry-issue:118723355`);
		});
	});
});
