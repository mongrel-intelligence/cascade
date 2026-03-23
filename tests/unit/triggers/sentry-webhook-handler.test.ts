import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockLogger } from '../../helpers/sharedMocks.js';

vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));

vi.mock('../../../src/config/provider.js', () => ({
	loadProjectConfigById: vi.fn(),
}));

import { loadProjectConfigById } from '../../../src/config/provider.js';
import { processSentryWebhook } from '../../../src/triggers/sentry/webhook-handler.js';
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
	});

	it('loads project config by projectId and dispatches with sentry source', async () => {
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

	it('dispatches even when triggerResult is provided (pre-computed result is logged, not used to skip dispatch)', async () => {
		const payload = { resource: 'event_alert', cascadeProjectId: 'proj-sentry' };
		const triggerResult = { agentType: 'alerting', agentInput: {} } as never;

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never, triggerResult);

		expect(mockRegistry.dispatch).toHaveBeenCalled();
	});

	it('logs debug message when triggerResult is provided', async () => {
		const payload = { resource: 'event_alert' };
		const triggerResult = { agentType: 'alerting', agentInput: {} } as never;

		await processSentryWebhook(payload, 'proj-sentry', mockRegistry as never, triggerResult);

		expect(mockLogger.debug).toHaveBeenCalledWith(
			expect.stringContaining('pre-computed trigger result'),
			expect.objectContaining({ projectId: 'proj-sentry', agentType: 'alerting' }),
		);
	});
});
