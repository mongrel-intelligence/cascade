import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockLogger } from '../../helpers/sharedMocks.js';

vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));

vi.mock('../../../src/config/provider.js', () => ({
	loadProjectConfigById: vi.fn(),
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

import { loadProjectConfigById } from '../../../src/config/provider.js';
import { processSentryWebhook } from '../../../src/triggers/sentry/webhook-handler.js';
import { runAgentExecutionPipeline } from '../../../src/triggers/shared/agent-execution.js';
import { withAgentTypeConcurrency } from '../../../src/triggers/shared/concurrency.js';
import { withPMScope } from '../../../src/triggers/shared/credential-scope.js';
import { resolveTriggerResult } from '../../../src/triggers/shared/trigger-resolution.js';
import { createMockProject } from '../../helpers/factories.js';

const mockProject = createMockProject({ id: 'proj-sentry' });

describe('processSentryWebhook', () => {
	let mockRegistry: { dispatch: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		vi.resetAllMocks();
		mockRegistry = { dispatch: vi.fn().mockResolvedValue(null) };
		vi.mocked(loadProjectConfigById).mockResolvedValue({
			project: mockProject,
			config: { projects: [mockProject] } as never,
		});
		vi.mocked(runAgentExecutionPipeline).mockResolvedValue(undefined);
		// Re-apply pass-through implementations after resetAllMocks clears them
		vi.mocked(withAgentTypeConcurrency).mockImplementation((_projectId, _agentType, fn) =>
			fn().then(() => true),
		);
		vi.mocked(withPMScope).mockImplementation((_project, fn) => fn());
		// resolveTriggerResult defaults to null (no trigger matched)
		vi.mocked(resolveTriggerResult).mockResolvedValue(null);
	});

	it('loads project config by projectId and calls resolveTriggerResult with sentry source', async () => {
		const payload = { resource: 'event_alert', cascadeProjectId: 'proj-sentry' };

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
		const payload = { resource: 'metric_alert', cascadeProjectId: 'proj-sentry' };

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
		const payload = { resource: 'event_alert', cascadeProjectId: 'proj-sentry' };
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
		const payload = { resource: 'event_alert' };
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
		const payload = { resource: 'event_alert', cascadeProjectId: 'proj-sentry' };
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
		const payload = { resource: 'event_alert', cascadeProjectId: 'proj-sentry' };
		vi.mocked(resolveTriggerResult).mockResolvedValue(null);

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never);

		expect(runAgentExecutionPipeline).not.toHaveBeenCalled();
	});

	it('applies agent-type concurrency when running the agent', async () => {
		const payload = { resource: 'event_alert' };
		const triggerResult = { agentType: 'alerting', agentInput: {} } as never;
		vi.mocked(resolveTriggerResult).mockResolvedValue(triggerResult);

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never, triggerResult);

		expect(withAgentTypeConcurrency).toHaveBeenCalledWith(
			'proj-sentry',
			'alerting',
			expect.any(Function),
			'processSentryWebhook',
		);
	});

	it('skips execution when concurrency is blocked', async () => {
		const payload = { resource: 'event_alert' };
		const triggerResult = { agentType: 'alerting', agentInput: {} } as never;
		vi.mocked(resolveTriggerResult).mockResolvedValue(triggerResult);
		vi.mocked(withAgentTypeConcurrency).mockResolvedValue(false);

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never, triggerResult);

		expect(runAgentExecutionPipeline).not.toHaveBeenCalled();
	});
});
