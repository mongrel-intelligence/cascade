import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockLogger } from '../../helpers/sharedMocks.js';

vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));

vi.mock('../../../src/config/provider.js', () => ({
	loadProjectConfigById: vi.fn(),
}));

vi.mock('../../../src/sentry/integration.js', () => ({
	getSentryIntegrationConfig: vi.fn(),
}));

vi.mock('../../../src/utils/lifecycle.js', () => ({
	startWatchdog: vi.fn(),
}));

vi.mock('../../../src/triggers/shared/agent-execution.js', () => ({
	runAgentExecutionPipeline: vi.fn().mockResolvedValue(undefined),
}));

// Mock shared utilities used by processSentryWebhook
vi.mock('../../../src/triggers/shared/concurrency.js', () => ({
	withAgentTypeConcurrency: vi.fn().mockImplementation((_projectId, _agentType, fn) => fn()),
}));

vi.mock('../../../src/triggers/shared/credential-scope.js', () => ({
	withPMScope: vi.fn().mockImplementation((_project, fn) => fn()),
}));

vi.mock('../../../src/triggers/shared/trigger-resolution.js', () => ({
	resolveTriggerResult: vi.fn(),
}));

vi.mock('../../../src/pm/registry.js', () => ({
	pmRegistry: {
		createProvider: vi.fn(() => ({
			getWorkItemUrl: (id: string) => `https://pm.example.test/${id}`,
		})),
	},
}));

// Mock the dynamically-imported materialization helpers
vi.mock('../../../src/integrations/alerting/_shared/materialize.js', () => ({
	materializeAlertWorkItem: vi.fn(),
}));
vi.mock('../../../src/integrations/alerting/_shared/format.js', () => ({
	formatSentryCardBody: vi
		.fn()
		.mockReturnValue({ title: '[Sentry] Test', descriptionMarkdown: 'desc' }),
	formatSentryMetricCardBody: vi.fn().mockReturnValue({
		title: '[Sentry Metric] Error Rate High',
		descriptionMarkdown: 'metric desc',
	}),
	formatSentryIssueLifecycleCardBody: vi.fn().mockReturnValue({
		title: '[Sentry] wedged work-item lock',
		descriptionMarkdown: 'issue lifecycle desc',
	}),
}));

import { loadProjectConfigById } from '../../../src/config/provider.js';
import {
	formatSentryCardBody,
	formatSentryIssueLifecycleCardBody,
	formatSentryMetricCardBody,
} from '../../../src/integrations/alerting/_shared/format.js';
import { materializeAlertWorkItem } from '../../../src/integrations/alerting/_shared/materialize.js';
import { AlertSlotMissingError } from '../../../src/integrations/alerting/_shared/types.js';
import { getSentryIntegrationConfig } from '../../../src/sentry/integration.js';
import { processSentryWebhook } from '../../../src/triggers/sentry/webhook-handler.js';
import { runAgentExecutionPipeline } from '../../../src/triggers/shared/agent-execution.js';
import { withAgentTypeConcurrency } from '../../../src/triggers/shared/concurrency.js';
import { withPMScope } from '../../../src/triggers/shared/credential-scope.js';
import { resolveTriggerResult } from '../../../src/triggers/shared/trigger-resolution.js';
import { createMockProject } from '../../helpers/factories.js';

const mockProject = createMockProject({ id: 'proj-sentry' });

function makeEventAlertPayload(project = 'api') {
	return {
		resource: 'event_alert',
		cascadeProjectId: 'proj-sentry',
		payload: { data: { event: { project } } },
	};
}

function makeMetricAlertPayload(project = 'api') {
	return {
		resource: 'metric_alert',
		cascadeProjectId: 'proj-sentry',
		payload: { data: { metric_alert: { projects: [{ slug: project }] } } },
	};
}

function makeIssuePayload(project = 'api') {
	return {
		resource: 'issue',
		cascadeProjectId: 'proj-sentry',
		payload: { data: { issue: { project } } },
	};
}

describe('processSentryWebhook', () => {
	let mockRegistry: { dispatch: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		vi.resetAllMocks();
		mockRegistry = { dispatch: vi.fn().mockResolvedValue(null) };
		vi.mocked(loadProjectConfigById).mockResolvedValue({
			project: mockProject,
			config: { projects: [mockProject] } as never,
		});
		vi.mocked(getSentryIntegrationConfig).mockResolvedValue({
			organizationSlug: 'mongrel',
			projectSlug: 'api',
		});
		vi.mocked(runAgentExecutionPipeline).mockResolvedValue(undefined);
		// Re-apply pass-through implementations after resetAllMocks clears them
		vi.mocked(withAgentTypeConcurrency).mockImplementation((_projectId, _agentType, fn) =>
			fn().then(() => true),
		);
		vi.mocked(withPMScope).mockImplementation((_project, fn) => fn());
		// resolveTriggerResult defaults to null (no trigger matched)
		vi.mocked(resolveTriggerResult).mockResolvedValue(null);
		// Re-apply format helper return values after resetAllMocks clears them
		vi.mocked(formatSentryCardBody).mockReturnValue({
			title: '[Sentry] Test',
			descriptionMarkdown: 'desc',
		});
		vi.mocked(formatSentryMetricCardBody).mockReturnValue({
			title: '[Sentry Metric] Error Rate High',
			descriptionMarkdown: 'metric desc',
		});
		vi.mocked(formatSentryIssueLifecycleCardBody).mockReturnValue({
			title: '[Sentry] wedged work-item lock',
			descriptionMarkdown: 'issue lifecycle desc',
		});
	});

	it('loads project config by projectId and calls resolveTriggerResult with sentry source', async () => {
		const payload = makeEventAlertPayload();

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never, undefined);

		expect(loadProjectConfigById).toHaveBeenCalledWith('proj-sentry');
		expect(resolveTriggerResult).toHaveBeenCalledWith(
			mockRegistry,
			expect.objectContaining({
				source: 'sentry',
				payload,
				project: mockProject,
			}),
			undefined,
			'processSentryWebhook',
		);
	});

	it('creates a TriggerContext with source sentry and the given payload', async () => {
		const payload = makeMetricAlertPayload();

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never);

		const resolveCall = vi.mocked(resolveTriggerResult).mock.calls[0];
		const ctx = resolveCall[1];
		expect(ctx.source).toBe('sentry');
		expect(ctx.payload).toBe(payload);
		expect(ctx.project).toBe(mockProject);
	});

	it('logs a warning and returns without calling resolveTriggerResult when project is not found', async () => {
		vi.mocked(loadProjectConfigById).mockResolvedValue(undefined);

		const payload = { resource: 'event_alert' };
		await processSentryWebhook(payload, 'unknown-proj', mockRegistry as never);

		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('project not found'),
			expect.objectContaining({ projectId: 'unknown-proj' }),
		);
		expect(resolveTriggerResult).not.toHaveBeenCalled();
	});

	it('passes triggerResult to resolveTriggerResult when provided', async () => {
		const payload = makeEventAlertPayload();
		const triggerResult = { agentType: 'alerting', agentInput: {} } as never;

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never, triggerResult);

		expect(resolveTriggerResult).toHaveBeenCalledWith(
			mockRegistry,
			expect.any(Object),
			triggerResult,
			'processSentryWebhook',
		);
	});

	it('logs info message when triggerResult is provided (via resolveTriggerResult)', async () => {
		const payload = makeEventAlertPayload();
		const triggerResult = { agentType: 'alerting', agentInput: {} } as never;
		vi.mocked(resolveTriggerResult).mockResolvedValue(triggerResult);

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never, triggerResult);

		// processSentryWebhook logs "running agent" when it proceeds after resolution
		expect(mockLogger.info).toHaveBeenCalledWith(
			expect.stringContaining('running agent'),
			expect.objectContaining({ projectId: 'proj-sentry', agentType: 'alerting' }),
		);
	});

	it('runs the agent execution pipeline when triggerResult has an agentType', async () => {
		const payload = makeEventAlertPayload();
		const triggerResult = { agentType: 'alerting', agentInput: {} } as never;
		vi.mocked(resolveTriggerResult).mockResolvedValue(triggerResult);

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never, triggerResult);

		expect(runAgentExecutionPipeline).toHaveBeenCalledWith(
			triggerResult,
			mockProject,
			expect.objectContaining({ projects: [mockProject] }),
			expect.objectContaining({ logLabel: 'Sentry agent' }),
		);
	});

	it('does not run the agent when resolveTriggerResult returns null', async () => {
		const payload = makeEventAlertPayload();
		vi.mocked(resolveTriggerResult).mockResolvedValue(null);

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never);

		expect(runAgentExecutionPipeline).not.toHaveBeenCalled();
	});

	it('returns before trigger resolution and PM materialization when payload project mismatches configured project', async () => {
		const payload = makeEventAlertPayload('mobile');
		const triggerResult = {
			agentType: 'alerting',
			agentInput: { alertIssueId: 'sentry-issue-42' },
		} as never;

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never, triggerResult);

		expect(getSentryIntegrationConfig).toHaveBeenCalledWith('proj-sentry');
		expect(resolveTriggerResult).not.toHaveBeenCalled();
		expect(materializeAlertWorkItem).not.toHaveBeenCalled();
		expect(runAgentExecutionPipeline).not.toHaveBeenCalled();
	});

	it('applies agent-type concurrency when running the agent', async () => {
		const payload = makeEventAlertPayload();
		const triggerResult = { agentType: 'alerting', agentInput: {} } as never;
		vi.mocked(resolveTriggerResult).mockResolvedValue(triggerResult);

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never, triggerResult);

		expect(withAgentTypeConcurrency).toHaveBeenCalledWith(
			'proj-sentry',
			'alerting',
			expect.any(Function),
			'processSentryWebhook',
			undefined,
		);
	});

	it('skips execution when concurrency is blocked', async () => {
		const payload = makeEventAlertPayload();
		const triggerResult = { agentType: 'alerting', agentInput: {} } as never;
		vi.mocked(resolveTriggerResult).mockResolvedValue(triggerResult);
		vi.mocked(withAgentTypeConcurrency).mockResolvedValue(false);

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never, triggerResult);

		expect(runAgentExecutionPipeline).not.toHaveBeenCalled();
	});

	// ── PM card materialisation (spec 019) ──────────────────────────────────

	it('materialises a PM work item when alertIssueId is set and workItemId is absent', async () => {
		const payload = makeEventAlertPayload();
		const triggerResult = {
			agentType: 'alerting',
			agentInput: {
				triggerEvent: 'alerting:issue-alert',
				alertIssueId: 'sentry-issue-42',
				alertIssueUrl: 'https://sentry.io/issues/sentry-issue-42/',
			},
		} as never;
		vi.mocked(resolveTriggerResult).mockResolvedValue(triggerResult);
		vi.mocked(materializeAlertWorkItem).mockResolvedValue('card-new');

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never);

		expect(materializeAlertWorkItem).toHaveBeenCalledWith(
			'sentry',
			'sentry-issue-42',
			mockProject,
			expect.objectContaining({ title: '[Sentry] Test' }),
		);
		expect(runAgentExecutionPipeline).toHaveBeenCalledWith(
			expect.objectContaining({
				workItemId: 'card-new',
				workItemTitle: '[Sentry] Test',
				workItemUrl: 'https://pm.example.test/card-new',
				agentInput: expect.objectContaining({
					workItemId: 'card-new',
					workItemTitle: '[Sentry] Test',
					workItemUrl: 'https://pm.example.test/card-new',
					alertIssueUrl: 'https://sentry.io/issues/sentry-issue-42/',
				}),
			}),
			mockProject,
			expect.any(Object),
			expect.objectContaining({ logLabel: 'Sentry agent' }),
		);
	});

	it('skips materialisation and runs agent directly when workItemId is already set', async () => {
		const payload = makeEventAlertPayload();
		const triggerResult = {
			agentType: 'alerting',
			workItemId: 'wi-already-set',
			agentInput: { alertIssueId: 'sentry-issue-42', workItemId: 'wi-already-set' },
		} as never;
		vi.mocked(resolveTriggerResult).mockResolvedValue(triggerResult);

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never);

		expect(materializeAlertWorkItem).not.toHaveBeenCalled();
		expect(runAgentExecutionPipeline).toHaveBeenCalledWith(
			triggerResult,
			mockProject,
			expect.any(Object),
			expect.any(Object),
		);
	});

	it('skips materialisation when alertIssueId is not a string', async () => {
		const payload = makeEventAlertPayload();
		const triggerResult = {
			agentType: 'alerting',
			agentInput: {},
		} as never;
		vi.mocked(resolveTriggerResult).mockResolvedValue(triggerResult);

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never);

		expect(materializeAlertWorkItem).not.toHaveBeenCalled();
		expect(runAgentExecutionPipeline).toHaveBeenCalled();
	});

	it('logs a warning and skips agent when materialisation throws AlertSlotMissingError', async () => {
		const payload = makeEventAlertPayload();
		const triggerResult = {
			agentType: 'alerting',
			agentInput: { alertIssueId: 'sentry-issue-42' },
		} as never;
		vi.mocked(resolveTriggerResult).mockResolvedValue(triggerResult);
		vi.mocked(materializeAlertWorkItem).mockRejectedValue(
			new AlertSlotMissingError('proj-sentry', 'trello'),
		);

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never);

		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('alerts slot no longer configured'),
			expect.objectContaining({ projectId: 'proj-sentry', reason: 'alerts_slot_missing' }),
		);
		expect(runAgentExecutionPipeline).not.toHaveBeenCalled();
	});

	it('re-throws transient PM errors so BullMQ can retry the job', async () => {
		const payload = makeEventAlertPayload();
		const triggerResult = {
			agentType: 'alerting',
			agentInput: { alertIssueId: 'sentry-issue-42' },
		} as never;
		vi.mocked(resolveTriggerResult).mockResolvedValue(triggerResult);
		const transientError = new Error('PM 503 Service Unavailable');
		vi.mocked(materializeAlertWorkItem).mockRejectedValue(transientError);

		await expect(
			processSentryWebhook(payload, 'proj-sentry', mockRegistry as never),
		).rejects.toThrow('PM 503 Service Unavailable');

		expect(runAgentExecutionPipeline).not.toHaveBeenCalled();
	});

	// ── Metric alert PM card materialisation (spec 019 review feedback) ──────

	it('materialises a PM work item for metric alerts when alertMetricKey is set', async () => {
		const payload = makeMetricAlertPayload();
		const triggerResult = {
			agentType: 'alerting',
			agentInput: {
				alertMetricKey: 'my-org:Error Rate High',
				alertIssueUrl: 'https://sentry.io/alerts/123/',
			},
			lockKey: 'sentry-metric:my-org:Error Rate High',
		} as never;
		vi.mocked(resolveTriggerResult).mockResolvedValue(triggerResult);
		vi.mocked(materializeAlertWorkItem).mockResolvedValue('metric-card-1');

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never);

		expect(materializeAlertWorkItem).toHaveBeenCalledWith(
			'sentry-metric',
			'my-org:Error Rate High',
			mockProject,
			expect.objectContaining({ title: '[Sentry Metric] Error Rate High' }),
		);
		expect(formatSentryMetricCardBody).toHaveBeenCalledWith(payload);
		expect(runAgentExecutionPipeline).toHaveBeenCalledWith(
			expect.objectContaining({
				workItemId: 'metric-card-1',
				workItemTitle: '[Sentry Metric] Error Rate High',
				workItemUrl: 'https://pm.example.test/metric-card-1',
				agentInput: expect.objectContaining({
					workItemId: 'metric-card-1',
					workItemTitle: '[Sentry Metric] Error Rate High',
					workItemUrl: 'https://pm.example.test/metric-card-1',
					alertIssueUrl: 'https://sentry.io/alerts/123/',
				}),
			}),
			mockProject,
			expect.any(Object),
			expect.objectContaining({ logLabel: 'Sentry agent' }),
		);
	});

	it('skips metric alert materialisation when workItemId is already set', async () => {
		const payload = makeMetricAlertPayload();
		const triggerResult = {
			agentType: 'alerting',
			workItemId: 'metric-card-already',
			agentInput: { alertMetricKey: 'my-org:Error Rate High', workItemId: 'metric-card-already' },
		} as never;
		vi.mocked(resolveTriggerResult).mockResolvedValue(triggerResult);

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never);

		expect(materializeAlertWorkItem).not.toHaveBeenCalled();
		expect(runAgentExecutionPipeline).toHaveBeenCalledWith(
			triggerResult,
			mockProject,
			expect.any(Object),
			expect.any(Object),
		);
	});

	it('skips agent and warns when metric alert materialisation throws AlertSlotMissingError', async () => {
		const payload = makeMetricAlertPayload();
		const triggerResult = {
			agentType: 'alerting',
			agentInput: { alertMetricKey: 'my-org:Error Rate High' },
		} as never;
		vi.mocked(resolveTriggerResult).mockResolvedValue(triggerResult);
		vi.mocked(materializeAlertWorkItem).mockRejectedValue(
			new AlertSlotMissingError('proj-sentry', 'trello'),
		);

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never);

		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('alerts slot no longer configured'),
			expect.objectContaining({ reason: 'alerts_slot_missing' }),
		);
		expect(runAgentExecutionPipeline).not.toHaveBeenCalled();
	});

	it('re-throws transient PM errors for metric alerts so BullMQ can retry', async () => {
		const payload = makeMetricAlertPayload();
		const triggerResult = {
			agentType: 'alerting',
			agentInput: { alertMetricKey: 'my-org:Error Rate High' },
		} as never;
		vi.mocked(resolveTriggerResult).mockResolvedValue(triggerResult);
		vi.mocked(materializeAlertWorkItem).mockRejectedValue(new Error('PM 503'));

		await expect(
			processSentryWebhook(payload, 'proj-sentry', mockRegistry as never),
		).rejects.toThrow('PM 503');

		expect(runAgentExecutionPipeline).not.toHaveBeenCalled();
	});

	// ── Issue-lifecycle PM card materialisation ──────────────────────────────
	//
	// Sentry-Hook-Resource: issue surface (Internal Integration default).
	// The issue-lifecycle handler also passes `alertIssueId`, so the
	// dispatcher discriminates on `agentInput.triggerEvent === 'alerting:issue-lifecycle'`
	// to pick the lifecycle format helper + 'sentry-issue' AlertSource.

	it('materialises a PM work item for issue-lifecycle when triggerEvent is alerting:issue-lifecycle', async () => {
		const payload = makeIssuePayload();
		const triggerResult = {
			agentType: 'alerting',
			agentInput: {
				triggerEvent: 'alerting:issue-lifecycle',
				alertIssueId: '118723355',
				alertIssueUrl: 'https://mongrel.sentry.io/issues/118723355/',
			},
			lockKey: 'sentry-issue:118723355',
		} as never;
		vi.mocked(resolveTriggerResult).mockResolvedValue(triggerResult);
		vi.mocked(materializeAlertWorkItem).mockResolvedValue('issue-card-1');

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never);

		expect(materializeAlertWorkItem).toHaveBeenCalledWith(
			'sentry-issue',
			'118723355',
			mockProject,
			expect.objectContaining({ title: '[Sentry] wedged work-item lock' }),
		);
		expect(formatSentryIssueLifecycleCardBody).toHaveBeenCalledWith(payload);
		// Existing event_alert formatter is NOT invoked for the lifecycle branch.
		expect(formatSentryCardBody).not.toHaveBeenCalled();
		expect(runAgentExecutionPipeline).toHaveBeenCalledWith(
			expect.objectContaining({
				workItemId: 'issue-card-1',
				workItemTitle: '[Sentry] wedged work-item lock',
				workItemUrl: 'https://pm.example.test/issue-card-1',
				agentInput: expect.objectContaining({
					workItemId: 'issue-card-1',
					workItemTitle: '[Sentry] wedged work-item lock',
					workItemUrl: 'https://pm.example.test/issue-card-1',
					alertIssueUrl: 'https://mongrel.sentry.io/issues/118723355/',
				}),
			}),
			mockProject,
			expect.any(Object),
			expect.objectContaining({ logLabel: 'Sentry agent' }),
		);
	});

	it('uses event_alert path (formatSentryCardBody + source=sentry) when triggerEvent is alerting:issue-alert', async () => {
		// Regression net: the existing event_alert flow must keep using
		// `formatSentryCardBody` and `'sentry'` AlertSource even though both
		// surfaces pass `alertIssueId`.
		const payload = makeEventAlertPayload();
		const triggerResult = {
			agentType: 'alerting',
			agentInput: {
				triggerEvent: 'alerting:issue-alert',
				alertIssueId: 'sentry-issue-42',
			},
		} as never;
		vi.mocked(resolveTriggerResult).mockResolvedValue(triggerResult);
		vi.mocked(materializeAlertWorkItem).mockResolvedValue('card-new');

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never);

		expect(materializeAlertWorkItem).toHaveBeenCalledWith(
			'sentry',
			'sentry-issue-42',
			mockProject,
			expect.objectContaining({ title: '[Sentry] Test' }),
		);
		expect(formatSentryCardBody).toHaveBeenCalledWith(payload);
		expect(formatSentryIssueLifecycleCardBody).not.toHaveBeenCalled();
	});

	it('skips issue-lifecycle materialisation when workItemId is already set', async () => {
		const payload = makeIssuePayload();
		const triggerResult = {
			agentType: 'alerting',
			workItemId: 'issue-card-already',
			agentInput: {
				triggerEvent: 'alerting:issue-lifecycle',
				alertIssueId: '118723355',
				workItemId: 'issue-card-already',
			},
		} as never;
		vi.mocked(resolveTriggerResult).mockResolvedValue(triggerResult);

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never);

		expect(materializeAlertWorkItem).not.toHaveBeenCalled();
		expect(runAgentExecutionPipeline).toHaveBeenCalledWith(
			triggerResult,
			mockProject,
			expect.any(Object),
			expect.any(Object),
		);
	});

	it('skips agent and warns when issue-lifecycle materialisation throws AlertSlotMissingError', async () => {
		const payload = makeIssuePayload();
		const triggerResult = {
			agentType: 'alerting',
			agentInput: {
				triggerEvent: 'alerting:issue-lifecycle',
				alertIssueId: '118723355',
			},
		} as never;
		vi.mocked(resolveTriggerResult).mockResolvedValue(triggerResult);
		vi.mocked(materializeAlertWorkItem).mockRejectedValue(
			new AlertSlotMissingError('proj-sentry', 'trello'),
		);

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never);

		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('alerts slot no longer configured'),
			expect.objectContaining({ reason: 'alerts_slot_missing' }),
		);
		expect(runAgentExecutionPipeline).not.toHaveBeenCalled();
	});

	it('re-throws transient PM errors for issue-lifecycle so BullMQ can retry', async () => {
		const payload = makeIssuePayload();
		const triggerResult = {
			agentType: 'alerting',
			agentInput: {
				triggerEvent: 'alerting:issue-lifecycle',
				alertIssueId: '118723355',
			},
		} as never;
		vi.mocked(resolveTriggerResult).mockResolvedValue(triggerResult);
		vi.mocked(materializeAlertWorkItem).mockRejectedValue(new Error('PM 503'));

		await expect(
			processSentryWebhook(payload, 'proj-sentry', mockRegistry as never),
		).rejects.toThrow('PM 503');

		expect(runAgentExecutionPipeline).not.toHaveBeenCalled();
	});
});
