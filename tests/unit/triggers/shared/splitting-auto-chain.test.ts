import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from '../../../../src/types/index.js';

const {
	mockGetPMProvider,
	mockResolveProjectPMConfig,
	mockHasAutoLabel,
	mockCheckTriggerEnabled,
	mockIsPipelineAtCapacity,
	mockLogger,
} = vi.hoisted(() => ({
	mockGetPMProvider: vi.fn(),
	mockResolveProjectPMConfig: vi.fn(),
	mockHasAutoLabel: vi.fn(),
	mockCheckTriggerEnabled: vi.fn(),
	mockIsPipelineAtCapacity: vi.fn(),
	mockLogger: {
		info: vi.fn(),
		warn: vi.fn(),
	},
}));

vi.mock('../../../../src/pm/context.js', () => ({
	getPMProvider: mockGetPMProvider,
}));

vi.mock('../../../../src/pm/index.js', () => ({
	resolveProjectPMConfig: mockResolveProjectPMConfig,
	hasAutoLabel: (...args: unknown[]) => mockHasAutoLabel(...args),
}));

vi.mock('../../../../src/triggers/shared/trigger-check.js', () => ({
	checkTriggerEnabled: (...args: unknown[]) => mockCheckTriggerEnabled(...args),
}));

vi.mock('../../../../src/triggers/shared/backlog-check.js', () => ({
	isPipelineAtCapacity: (...args: unknown[]) => mockIsPipelineAtCapacity(...args),
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

import { buildSplittingAutoChainDispatch } from '../../../../src/triggers/shared/splitting-auto-chain.js';

const PROJECT = {
	id: 'project-1',
	repo: 'acme/myapp',
	pm: { type: 'trello' },
} as ProjectConfig;

const PM_CONFIG = {
	type: 'trello',
	labels: { auto: 'label-auto-id' },
};

function setupProvider(overrides: Record<string, unknown> = {}) {
	const provider = {
		getWorkItem: vi.fn().mockResolvedValue({
			id: 'parent-card',
			labels: [{ id: 'label-auto-id', name: 'auto' }],
		}),
		listWorkItems: vi.fn().mockResolvedValue([
			{ id: 'backlog-1', labels: [] },
			{ id: 'backlog-2', labels: [{ id: 'label-auto-id', name: 'auto' }] },
		]),
		addLabel: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
	mockGetPMProvider.mockReturnValue(provider);
	return provider;
}

describe('buildSplittingAutoChainDispatch', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupProvider();
		mockResolveProjectPMConfig.mockReturnValue(PM_CONFIG);
		mockHasAutoLabel.mockImplementation((labels: Array<{ id: string }>) =>
			labels.some((label) => label.id === 'label-auto-id'),
		);
		mockCheckTriggerEnabled.mockResolvedValue(true);
		mockIsPipelineAtCapacity.mockResolvedValue({ atCapacity: false, inFlightCount: 0 });
	});

	it('propagates auto label and returns backlog-manager TriggerResult', async () => {
		const provider = setupProvider();

		const result = await buildSplittingAutoChainDispatch('parent-card', PROJECT);

		expect(result).toEqual({
			agentType: 'backlog-manager',
			agentInput: { triggerEvent: 'internal:auto-chain', workItemId: 'parent-card' },
			workItemId: 'parent-card',
		});
		expect(provider.listWorkItems).toHaveBeenCalledWith(undefined, { status: 'backlog' });
		expect(provider.addLabel).toHaveBeenCalledWith('backlog-1', 'label-auto-id');
		expect(provider.addLabel).toHaveBeenCalledTimes(1);
		expect(mockCheckTriggerEnabled).toHaveBeenCalledWith(
			'project-1',
			'backlog-manager',
			'internal:auto-chain',
			'splitting-auto-propagate',
		);
		expect(mockIsPipelineAtCapacity).toHaveBeenCalledWith(PROJECT, provider);
	});

	it('returns null when parent item does not have auto label', async () => {
		const provider = setupProvider();
		mockHasAutoLabel.mockReturnValueOnce(false);

		const result = await buildSplittingAutoChainDispatch('parent-card', PROJECT);

		expect(result).toBeNull();
		expect(provider.listWorkItems).not.toHaveBeenCalled();
		expect(mockCheckTriggerEnabled).not.toHaveBeenCalled();
	});

	it('returns null after label propagation when backlog-manager trigger is disabled', async () => {
		const provider = setupProvider();
		mockCheckTriggerEnabled.mockResolvedValueOnce(false);

		const result = await buildSplittingAutoChainDispatch('parent-card', PROJECT);

		expect(result).toBeNull();
		expect(provider.addLabel).toHaveBeenCalledWith('backlog-1', 'label-auto-id');
		expect(mockIsPipelineAtCapacity).not.toHaveBeenCalled();
	});

	it('returns null when pipeline is at capacity', async () => {
		mockIsPipelineAtCapacity.mockResolvedValueOnce({
			atCapacity: true,
			reason: 'limit-reached',
			inFlightCount: 2,
			limit: 2,
			availableSlots: 0,
		});

		const result = await buildSplittingAutoChainDispatch('parent-card', PROJECT);

		expect(result).toBeNull();
		expect(mockLogger.info).toHaveBeenCalledWith(
			'propagateAutoLabelAfterSplitting: pipeline at capacity, skipping backlog-manager chain',
			expect.objectContaining({ reason: 'limit-reached' }),
		);
	});

	it('logs and returns null when provider listing fails', async () => {
		setupProvider({
			listWorkItems: vi.fn().mockRejectedValue(new Error('PM down')),
		});

		const result = await buildSplittingAutoChainDispatch('parent-card', PROJECT);

		expect(result).toBeNull();
		expect(mockLogger.warn).toHaveBeenCalledWith(
			'propagateAutoLabelAfterSplitting: failed to list backlog items',
			expect.objectContaining({ error: 'Error: PM down' }),
		);
	});

	it('logs addLabel failures without blocking dispatch', async () => {
		setupProvider({
			addLabel: vi.fn().mockRejectedValue(new Error('label failed')),
		});

		const result = await buildSplittingAutoChainDispatch('parent-card', PROJECT);

		expect(result?.agentType).toBe('backlog-manager');
		expect(mockLogger.warn).toHaveBeenCalledWith(
			'Failed to add auto label to backlog item',
			expect.objectContaining({ itemId: 'backlog-1', error: 'Error: label failed' }),
		);
	});
});
