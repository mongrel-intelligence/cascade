import { describe, expect, it, vi } from 'vitest';

const { mockGetPMProvider, mockIsActivePipelineOverCapacity, mockLogger } = vi.hoisted(() => ({
	mockGetPMProvider: vi.fn(),
	mockIsActivePipelineOverCapacity: vi.fn(),
	mockLogger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../../src/pm/context.js', () => ({
	getPMProvider: mockGetPMProvider,
}));

vi.mock('../../../../src/triggers/shared/backlog-check.js', () => ({
	isActivePipelineOverCapacity: mockIsActivePipelineOverCapacity,
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

import { shouldBlockForPipelineCapacity } from '../../../../src/triggers/shared/pipeline-capacity-gate.js';
import { createMockProject } from '../../../helpers/factories.js';

const project = createMockProject({ maxInFlightItems: 1 });

describe('shouldBlockForPipelineCapacity', () => {
	it('does not gate non-slot-consuming agent types (review, planning, splitting, backlog-manager)', async () => {
		for (const agentType of ['review', 'planning', 'splitting', 'backlog-manager', 'debug']) {
			expect(
				await shouldBlockForPipelineCapacity({
					project,
					agentType,
					workItemId: 'UA-1',
					source: 'jira',
				}),
			).toBe(false);
		}
		expect(mockGetPMProvider).not.toHaveBeenCalled();
		expect(mockIsActivePipelineOverCapacity).not.toHaveBeenCalled();
	});

	it('blocks implementation when active pipeline is over capacity', async () => {
		const fakeProvider = { type: 'jira' };
		mockGetPMProvider.mockReturnValue(fakeProvider);
		mockIsActivePipelineOverCapacity.mockResolvedValue({
			overCapacity: true,
			reason: 'over-capacity',
			inFlightCount: 2,
			limit: 1,
		});

		const blocked = await shouldBlockForPipelineCapacity({
			project,
			agentType: 'implementation',
			workItemId: 'UA-3',
			source: 'jira',
		});

		expect(blocked).toBe(true);
		expect(mockIsActivePipelineOverCapacity).toHaveBeenCalledWith(project, fakeProvider, {
			excludeWorkItemId: 'UA-3',
		});
		expect(mockLogger.info).toHaveBeenCalledWith(
			'pipeline-at-capacity: skipping status-changed trigger',
			expect.objectContaining({
				agentType: 'implementation',
				workItemId: 'UA-3',
				inFlightCount: 2,
				limit: 1,
			}),
		);
	});

	it('allows implementation when below capacity', async () => {
		mockGetPMProvider.mockReturnValue({ type: 'jira' });
		mockIsActivePipelineOverCapacity.mockResolvedValue({
			overCapacity: false,
			reason: 'below-capacity',
			inFlightCount: 0,
			limit: 1,
		});

		const blocked = await shouldBlockForPipelineCapacity({
			project,
			agentType: 'implementation',
			workItemId: 'UA-3',
			source: 'jira',
		});

		expect(blocked).toBe(false);
	});

	it('allows (conservatively) when no PM provider scope is available', async () => {
		mockGetPMProvider.mockImplementation(() => {
			throw new Error('no scope');
		});

		const blocked = await shouldBlockForPipelineCapacity({
			project,
			agentType: 'implementation',
			workItemId: 'UA-3',
			source: 'jira',
		});

		expect(blocked).toBe(false);
		expect(mockLogger.warn).toHaveBeenCalledWith(
			'pipeline-capacity-gate: PM provider unavailable, allowing run',
			expect.objectContaining({ workItemId: 'UA-3' }),
		);
	});
});
