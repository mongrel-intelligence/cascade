import { describe, expect, it, vi } from 'vitest';

const { mockGet, mockProcessPMWebhook } = vi.hoisted(() => ({
	mockGet: vi.fn(),
	mockProcessPMWebhook: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/pm/index.js', () => ({
	pmRegistry: { get: mockGet },
}));

vi.mock('../../../src/pm/webhook-handler.js', () => ({
	processPMWebhook: mockProcessPMWebhook,
}));

import { processGitHubProjectsWebhook } from '../../../src/triggers/github-projects/webhook-handler.js';

describe('processGitHubProjectsWebhook', () => {
	it('resolves the github-projects integration from the registry and delegates to processPMWebhook', async () => {
		const fakeIntegration = { type: 'github-projects' };
		mockGet.mockReturnValue(fakeIntegration);
		const payload = { action: 'edited' };
		const registry = {
			dispatch: vi.fn(),
		} as unknown as import('../../../src/triggers/registry.js').TriggerRegistry;
		const triggerResult = { agentType: 'implementation' } as never;

		await processGitHubProjectsWebhook(payload, registry, 'ack-1', triggerResult, 'proj-1');

		expect(mockGet).toHaveBeenCalledWith('github-projects');
		expect(mockProcessPMWebhook).toHaveBeenCalledWith(
			fakeIntegration,
			payload,
			registry,
			'ack-1',
			triggerResult,
			'proj-1',
		);
	});

	it('forwards undefined optional args through to processPMWebhook', async () => {
		const fakeIntegration = { type: 'github-projects' };
		mockGet.mockReturnValue(fakeIntegration);
		const payload = { action: 'created' };
		const registry = {
			dispatch: vi.fn(),
		} as unknown as import('../../../src/triggers/registry.js').TriggerRegistry;

		await processGitHubProjectsWebhook(payload, registry);

		expect(mockProcessPMWebhook).toHaveBeenCalledWith(
			fakeIntegration,
			payload,
			registry,
			undefined,
			undefined,
			undefined,
		);
	});
});
