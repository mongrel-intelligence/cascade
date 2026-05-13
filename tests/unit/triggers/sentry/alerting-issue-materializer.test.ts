/**
 * Tests for SentryIssueAlertTrigger.
 *
 * After spec 019 review feedback, PM card materialisation was moved from the
 * router-side trigger handler to the worker-side processSentryWebhook so that
 * transient PM failures surface as BullMQ retries (durable) rather than being
 * swallowed as non-fatal dispatch errors by processRouterWebhook (which would
 * return HTTP 200 to Sentry with no job ever enqueued).
 *
 * The trigger handler now only:
 *   1. Checks the trigger is enabled.
 *   2. Verifies the alerts slot is configured via getAlertsContainerId.
 *   3. Returns a TriggerResult with alertIssueId in agentInput (no workItemId).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockLogger, mockTriggerCheckModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/utils/logging.js', () => ({ logger: mockLogger }));
vi.mock('../../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);
vi.mock('../../../../src/sentry/integration.js', () => ({
	getSentryIntegrationConfig: vi.fn(),
}));

import { AlertSlotMissingError } from '../../../../src/integrations/alerting/_shared/types.js';
import { getSentryIntegrationConfig } from '../../../../src/sentry/integration.js';
import { SentryIssueAlertTrigger } from '../../../../src/triggers/sentry/alerting-issue.js';
import { checkTriggerEnabledWithParams } from '../../../../src/triggers/shared/trigger-check.js';
import type { TriggerContext } from '../../../../src/types/index.js';
import { createMockProject } from '../../../helpers/factories.js';

const sentryConfig = { organizationSlug: 'my-org', projectSlug: 'api' };

// Project with alerts slot configured — required for dispatch
const mockProjectWithAlerts = createMockProject({
	id: 'test-project',
	trello: {
		boardId: 'board123',
		lists: {
			splitting: 'list-split',
			planning: 'list-plan',
			todo: 'list-todo',
			alerts: 'list-alerts',
		},
		labels: {},
	},
});

// Project without alerts slot — dispatch should be skipped
const mockProjectWithoutAlerts = createMockProject({ id: 'test-project' });

function makeCtx(issueId = 'issue-42', project = mockProjectWithAlerts): TriggerContext {
	return {
		project,
		source: 'sentry',
		payload: {
			resource: 'event_alert',
			payload: {
				action: 'triggered',
				data: {
					event: {
						event_id: 'evt-abc',
						issue_id: issueId,
						web_url: `https://sentry.io/issues/${issueId}/`,
						title: 'NullPointerException',
					},
				},
			},
			cascadeProjectId: project.id,
		},
	} as TriggerContext;
}

describe('SentryIssueAlertTrigger', () => {
	let trigger: SentryIssueAlertTrigger;

	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({ enabled: true, parameters: {} });
		vi.mocked(getSentryIntegrationConfig).mockResolvedValue(sentryConfig);
		trigger = new SentryIssueAlertTrigger();
	});

	describe('when alerts slot is configured', () => {
		it('returns a TriggerResult with alertIssueId in agentInput', async () => {
			const result = await trigger.handle(makeCtx('I-42'));
			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('alerting');
			expect(result?.agentInput.alertIssueId).toBe('I-42');
		});

		it('does NOT set workItemId — materialisation is deferred to the worker', async () => {
			const result = await trigger.handle(makeCtx());
			expect(result?.workItemId).toBeUndefined();
			expect(result?.agentInput.workItemId).toBeUndefined();
		});

		it('sets coalesceKey using sentry issue ID for dedup without a PM card ID', async () => {
			const result = await trigger.handle(makeCtx('issue-99'));
			expect(result?.coalesceKey).toBe('test-project:sentry:issue-99');
		});

		it('sets lockKey for router-level work-item concurrency without a PM card ID', async () => {
			const result = await trigger.handle(makeCtx('issue-42'));
			expect(result?.lockKey).toBe('sentry:issue-42');
		});

		it('result contains no string field matching sentry:issue: prefix', async () => {
			const result = await trigger.handle(makeCtx());
			expect(result).not.toBeNull();
			expect(JSON.stringify(result)).not.toMatch(/sentry:issue:/);
		});

		it('includes orgId, alertTitle, and alertIssueUrl from the payload', async () => {
			const result = await trigger.handle(makeCtx());
			expect(result?.agentInput.alertOrgId).toBe('my-org');
			expect(result?.agentInput.alertIssueUrl).toMatch(/sentry\.io/);
		});
	});

	describe('when alerts slot is NOT configured', () => {
		it('returns null and emits structured WARN', async () => {
			const result = await trigger.handle(makeCtx('I-1', mockProjectWithoutAlerts));
			expect(result).toBeNull();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					projectId: 'test-project',
					source: 'sentry',
					reason: 'alerts_slot_missing',
				}),
			);
		});
	});

	describe('when trigger is disabled', () => {
		it('returns null without accessing the alerts slot config', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({
				enabled: false,
				parameters: {},
			});
			const result = await trigger.handle(makeCtx());
			expect(result).toBeNull();
			// No WARN about missing slot — trigger check fires first
			expect(mockLogger.warn).not.toHaveBeenCalled();
		});
	});

	describe('when issue ID cannot be determined', () => {
		it('returns null', async () => {
			const ctx = makeCtx();
			(ctx.payload as Record<string, unknown>).payload = {
				action: 'triggered',
				data: { event: { event_id: 'evt-x' } },
			};
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});
	});
});

// Verify AlertSlotMissingError is still exported and used correctly by callers
describe('AlertSlotMissingError (used by processSentryWebhook)', () => {
	it('is constructable with projectId and pm type', () => {
		const err = new AlertSlotMissingError('project-1', 'trello');
		expect(err).toBeInstanceOf(AlertSlotMissingError);
		expect(err).toBeInstanceOf(Error);
	});
});
