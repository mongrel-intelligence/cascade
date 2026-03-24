import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockLogger } from '../../helpers/sharedMocks.js';

vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));

vi.mock('../../../src/config/provider.js', () => ({
	loadProjectConfigById: vi.fn(),
}));

vi.mock('../../../src/pm/context.js', () => ({
	withPMCredentials: vi.fn().mockImplementation((_id, _type, _getter, fn) => fn()),
	withPMProvider: vi.fn().mockImplementation((_provider, fn) => fn()),
}));

vi.mock('../../../src/pm/index.js', () => ({
	createPMProvider: vi.fn().mockReturnValue({}),
	pmRegistry: { getOrNull: vi.fn().mockReturnValue(null) },
}));

vi.mock('../../../src/utils/lifecycle.js', () => ({
	startWatchdog: vi.fn(),
}));

vi.mock('../../../src/triggers/shared/agent-execution.js', () => ({
	runAgentExecutionPipeline: vi.fn().mockResolvedValue(undefined),
}));

import { loadProjectConfigById } from '../../../src/config/provider.js';
import { withPMCredentials, withPMProvider } from '../../../src/pm/context.js';
import { processSentryWebhook } from '../../../src/triggers/sentry/webhook-handler.js';
import { runAgentExecutionPipeline } from '../../../src/triggers/shared/agent-execution.js';
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
		vi.mocked(withPMCredentials).mockImplementation((_id, _type, _getter, fn) => fn());
		vi.mocked(withPMProvider).mockImplementation((_provider, fn) => fn());
	});

	it('loads project config by projectId and dispatches with sentry source when no triggerResult', async () => {
		const payload = { resource: 'event_alert', cascadeProjectId: 'proj-sentry' };

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never, undefined);

		expect(loadProjectConfigById).toHaveBeenCalledWith('proj-sentry');
		expect(mockRegistry.dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				source: 'sentry',
				payload,
				project: mockProject,
			}),
		);
	});

	it('creates a TriggerContext with source sentry and the given payload', async () => {
		const payload = { resource: 'metric_alert', cascadeProjectId: 'proj-sentry' };

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never);

		const dispatchCall = mockRegistry.dispatch.mock.calls[0][0];
		expect(dispatchCall.source).toBe('sentry');
		expect(dispatchCall.payload).toBe(payload);
		expect(dispatchCall.project).toBe(mockProject);
	});

	it('logs a warning and returns without dispatching when project is not found', async () => {
		vi.mocked(loadProjectConfigById).mockResolvedValue(undefined);

		const payload = { resource: 'event_alert' };
		await processSentryWebhook(payload, 'unknown-proj', mockRegistry as never);

		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('project not found'),
			expect.objectContaining({ projectId: 'unknown-proj' }),
		);
		expect(mockRegistry.dispatch).not.toHaveBeenCalled();
	});

	it('does NOT call registry.dispatch when triggerResult is provided', async () => {
		const payload = { resource: 'event_alert', cascadeProjectId: 'proj-sentry' };
		const triggerResult = { agentType: 'alerting', agentInput: {} } as never;

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never, triggerResult);

		expect(mockRegistry.dispatch).not.toHaveBeenCalled();
	});

	it('logs info message when triggerResult is provided', async () => {
		const payload = { resource: 'event_alert' };
		const triggerResult = { agentType: 'alerting', agentInput: {} } as never;

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never, triggerResult);

		expect(mockLogger.info).toHaveBeenCalledWith(
			expect.stringContaining('pre-computed trigger result'),
			expect.objectContaining({ projectId: 'proj-sentry', agentType: 'alerting' }),
		);
	});

	it('runs the agent execution pipeline when triggerResult has an agentType', async () => {
		const payload = { resource: 'event_alert', cascadeProjectId: 'proj-sentry' };
		const triggerResult = { agentType: 'alerting', agentInput: {} } as never;

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never, triggerResult);

		expect(runAgentExecutionPipeline).toHaveBeenCalledWith(
			triggerResult,
			mockProject,
			expect.objectContaining({ projects: [mockProject] }),
			expect.objectContaining({ logLabel: 'Sentry agent' }),
		);
	});

	it('does not run the agent when registry dispatch returns null', async () => {
		const payload = { resource: 'event_alert', cascadeProjectId: 'proj-sentry' };
		mockRegistry.dispatch.mockResolvedValue(null);

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never);

		expect(runAgentExecutionPipeline).not.toHaveBeenCalled();
	});
});
