import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockLogger, mockTriggerCheckModule } from '../../helpers/sharedMocks.js';

vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));
vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

vi.mock('../../../src/sentry/integration.js', () => ({
	getSentryIntegrationConfig: vi.fn(),
}));

import { getSentryIntegrationConfig } from '../../../src/sentry/integration.js';
import { SentryIssueAlertTrigger } from '../../../src/triggers/sentry/alerting-issue.js';
import { SentryMetricAlertTrigger } from '../../../src/triggers/sentry/alerting-metric.js';
import { checkTriggerEnabledWithParams } from '../../../src/triggers/shared/trigger-check.js';
import type { TriggerContext } from '../../../src/types/index.js';
import { createMockProject } from '../../helpers/factories.js';

const mockProject = createMockProject();

const sentryConfig = { organizationSlug: 'my-org' };

function makeSentryIssueAlertCtx(
	overrides: {
		resource?: string;
		eventOverrides?: Record<string, unknown>;
		issueAlertTitle?: string;
		triggeredRule?: string;
	} = {},
): TriggerContext {
	return {
		project: mockProject,
		source: 'sentry',
		payload: {
			resource: overrides.resource ?? 'event_alert',
			payload: {
				action: 'triggered',
				data: {
					event: {
						event_id: 'evt-abc123',
						issue_id: 'issue-42',
						web_url: 'https://sentry.io/issues/issue-42/',
						title: 'NullPointerException at PaymentService.charge',
						...overrides.eventOverrides,
					},
					...(overrides.issueAlertTitle !== undefined
						? { issue_alert: { title: overrides.issueAlertTitle } }
						: {}),
					...(overrides.triggeredRule !== undefined
						? { triggered_rule: overrides.triggeredRule }
						: {}),
				},
			},
			cascadeProjectId: 'test',
		},
	} as TriggerContext;
}

function makeSentryMetricAlertCtx(
	overrides: {
		resource?: string;
		action?: string;
		descriptionTitle?: string;
		aggregate?: string;
		webUrl?: string;
	} = {},
): TriggerContext {
	return {
		project: mockProject,
		source: 'sentry',
		payload: {
			resource: overrides.resource ?? 'metric_alert',
			payload: {
				action: overrides.action ?? 'critical',
				data: {
					...(overrides.descriptionTitle !== undefined
						? { description_title: overrides.descriptionTitle }
						: {}),
					...(overrides.webUrl !== undefined ? { web_url: overrides.webUrl } : {}),
					...(overrides.aggregate !== undefined
						? { metric_alert: { alert_rule: { aggregate: overrides.aggregate } } }
						: {}),
				},
			},
			cascadeProjectId: 'test',
		},
	} as TriggerContext;
}

// ============================================================================
// SentryIssueAlertTrigger
// ============================================================================

describe('SentryIssueAlertTrigger', () => {
	let trigger: SentryIssueAlertTrigger;

	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({ enabled: true, parameters: {} });
		vi.mocked(getSentryIntegrationConfig).mockResolvedValue(sentryConfig);
		trigger = new SentryIssueAlertTrigger();
	});

	// -------------------------------------------------------------------------
	// matches()
	// -------------------------------------------------------------------------

	describe('matches()', () => {
		it('returns true for sentry source with event_alert resource', () => {
			expect(trigger.matches(makeSentryIssueAlertCtx())).toBe(true);
		});

		it('returns false for non-sentry source', () => {
			const ctx = { ...makeSentryIssueAlertCtx(), source: 'github' } as TriggerContext;
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('returns false when resource is not event_alert', () => {
			expect(trigger.matches(makeSentryIssueAlertCtx({ resource: 'metric_alert' }))).toBe(false);
		});

		it('returns false when resource is issue lifecycle event', () => {
			expect(trigger.matches(makeSentryIssueAlertCtx({ resource: 'issue' }))).toBe(false);
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
			const result = await trigger.handle(makeSentryIssueAlertCtx());
			expect(result).toBeNull();
		});

		it('returns null when issue ID cannot be determined', async () => {
			const ctx = makeSentryIssueAlertCtx({
				eventOverrides: { issue_id: undefined, issue_url: undefined },
			});
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('cannot determine issue ID'),
				expect.any(Object),
			);
		});

		it('returns null when Sentry integration config is missing', async () => {
			vi.mocked(getSentryIntegrationConfig).mockResolvedValue(null);
			const result = await trigger.handle(makeSentryIssueAlertCtx());
			expect(result).toBeNull();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('no Sentry integration config'),
				expect.any(Object),
			);
		});

		it('returns a TriggerResult with alertIssueId from event.issue_id', async () => {
			const result = await trigger.handle(makeSentryIssueAlertCtx());
			expect(result).toMatchObject({
				agentType: 'alerting',
				agentInput: {
					triggerEvent: 'alerting:issue-alert',
					alertIssueId: 'issue-42',
					alertOrgId: 'my-org',
					alertIssueUrl: 'https://sentry.io/issues/issue-42/',
				},
			});
		});

		it('extracts issue ID from issue_url when issue_id is absent', async () => {
			// URL without trailing slash so .split('/').pop() returns the ID, not ''
			const ctx = makeSentryIssueAlertCtx({
				eventOverrides: {
					issue_id: undefined,
					issue_url: 'https://sentry.io/api/0/issues/9999',
				},
			});
			const result = await trigger.handle(ctx);
			expect(result?.agentInput?.alertIssueId).toBe('9999');
		});

		it('uses issue_alert.title as alertTitle', async () => {
			const ctx = makeSentryIssueAlertCtx({ issueAlertTitle: 'My Alert Rule' });
			const result = await trigger.handle(ctx);
			expect(result?.agentInput?.alertTitle).toBe('My Alert Rule');
		});

		it('falls back to triggered_rule when issue_alert.title is absent', async () => {
			const ctx = makeSentryIssueAlertCtx({ triggeredRule: 'Error Rate > 5%' });
			const result = await trigger.handle(ctx);
			expect(result?.agentInput?.alertTitle).toBe('Error Rate > 5%');
		});

		it('falls back to event.title when no rule title is present', async () => {
			const result = await trigger.handle(makeSentryIssueAlertCtx());
			expect(result?.agentInput?.alertTitle).toBe('NullPointerException at PaymentService.charge');
		});

		it('uses default alertTitle when all title sources are absent', async () => {
			const ctx = makeSentryIssueAlertCtx({
				eventOverrides: { issue_id: 'issue-42', web_url: 'https://sentry.io/', title: undefined },
			});
			const result = await trigger.handle(ctx);
			expect(result?.agentInput?.alertTitle).toBe('Issue Alert');
		});

		it('sets alertIssueUrl from event.web_url', async () => {
			const result = await trigger.handle(makeSentryIssueAlertCtx());
			expect(result?.agentInput?.alertIssueUrl).toBe('https://sentry.io/issues/issue-42/');
		});

		it('falls back to issue_url for alertIssueUrl when web_url is absent', async () => {
			const issueUrl = 'https://sentry.io/api/0/issues/issue-42/';
			const ctx = makeSentryIssueAlertCtx({
				eventOverrides: { web_url: undefined, issue_url: issueUrl },
			});
			const result = await trigger.handle(ctx);
			expect(result?.agentInput?.alertIssueUrl).toBe(issueUrl);
		});
	});
});

// ============================================================================
// SentryMetricAlertTrigger
// ============================================================================

describe('SentryMetricAlertTrigger', () => {
	let trigger: SentryMetricAlertTrigger;

	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({ enabled: true, parameters: {} });
		vi.mocked(getSentryIntegrationConfig).mockResolvedValue(sentryConfig);
		trigger = new SentryMetricAlertTrigger();
	});

	// -------------------------------------------------------------------------
	// matches()
	// -------------------------------------------------------------------------

	describe('matches()', () => {
		it('returns true for sentry source with metric_alert + critical action', () => {
			expect(trigger.matches(makeSentryMetricAlertCtx({ action: 'critical' }))).toBe(true);
		});

		it('returns true for sentry source with metric_alert + warning action', () => {
			expect(trigger.matches(makeSentryMetricAlertCtx({ action: 'warning' }))).toBe(true);
		});

		it('returns false for resolved action (not an active alert)', () => {
			expect(trigger.matches(makeSentryMetricAlertCtx({ action: 'resolved' }))).toBe(false);
		});

		it('returns false for non-sentry source', () => {
			const ctx = { ...makeSentryMetricAlertCtx(), source: 'github' } as TriggerContext;
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('returns false when resource is event_alert', () => {
			expect(trigger.matches(makeSentryMetricAlertCtx({ resource: 'event_alert' }))).toBe(false);
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
			const result = await trigger.handle(makeSentryMetricAlertCtx());
			expect(result).toBeNull();
		});

		it('returns null for warning action when minSeverity defaults to critical', async () => {
			// Default parameters: severity is not set, so minSeverity = 'critical'
			const result = await trigger.handle(makeSentryMetricAlertCtx({ action: 'warning' }));
			expect(result).toBeNull();
			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.stringContaining('below minimum severity'),
				expect.any(Object),
			);
		});

		it('allows warning action when minSeverity is set to warning', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({
				enabled: true,
				parameters: { severity: 'warning' },
			});
			const result = await trigger.handle(makeSentryMetricAlertCtx({ action: 'warning' }));
			expect(result).not.toBeNull();
		});

		it('allows critical action regardless of minSeverity', async () => {
			vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({
				enabled: true,
				parameters: { severity: 'critical' },
			});
			const result = await trigger.handle(makeSentryMetricAlertCtx({ action: 'critical' }));
			expect(result).not.toBeNull();
		});

		it('returns null when Sentry integration config is missing', async () => {
			vi.mocked(getSentryIntegrationConfig).mockResolvedValue(null);
			const result = await trigger.handle(makeSentryMetricAlertCtx());
			expect(result).toBeNull();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('no Sentry integration config'),
				expect.any(Object),
			);
		});

		it('returns a TriggerResult with alertOrgId from config', async () => {
			const result = await trigger.handle(makeSentryMetricAlertCtx({ action: 'critical' }));
			expect(result).toMatchObject({
				agentType: 'alerting',
				agentInput: {
					triggerEvent: 'alerting:metric-alert',
					alertOrgId: 'my-org',
				},
			});
		});

		it('uses description_title as alertTitle', async () => {
			const ctx = makeSentryMetricAlertCtx({ descriptionTitle: 'Error Rate High' });
			const result = await trigger.handle(ctx);
			expect(result?.agentInput?.alertTitle).toBe('Error Rate High');
		});

		it('falls back to metric_alert aggregate as alertTitle', async () => {
			const ctx = makeSentryMetricAlertCtx({ aggregate: 'p95(transaction.duration)' });
			const result = await trigger.handle(ctx);
			expect(result?.agentInput?.alertTitle).toBe('p95(transaction.duration)');
		});

		it('uses default alertTitle when all title sources are absent', async () => {
			const result = await trigger.handle(makeSentryMetricAlertCtx({ action: 'critical' }));
			expect(result?.agentInput?.alertTitle).toBe('Metric Alert (critical)');
		});

		it('sets alertIssueUrl from data.web_url', async () => {
			const ctx = makeSentryMetricAlertCtx({ webUrl: 'https://sentry.io/alerts/123/' });
			const result = await trigger.handle(ctx);
			expect(result?.agentInput?.alertIssueUrl).toBe('https://sentry.io/alerts/123/');
		});

		it('sets alertIssueUrl to undefined when web_url is absent', async () => {
			const result = await trigger.handle(makeSentryMetricAlertCtx({ action: 'critical' }));
			expect(result?.agentInput?.alertIssueUrl).toBeUndefined();
		});
	});
});
