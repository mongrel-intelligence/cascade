import { describe, expect, it, vi } from 'vitest';

const {
	mockGetPMProvider,
	mockIsActivePipelineOverCapacity,
	mockResolveProjectPMConfig,
	mockLogger,
} = vi.hoisted(() => ({
	mockGetPMProvider: vi.fn(),
	mockIsActivePipelineOverCapacity: vi.fn(),
	mockResolveProjectPMConfig: vi.fn(),
	mockLogger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../../src/pm/context.js', () => ({
	getPMProvider: mockGetPMProvider,
}));

vi.mock('../../../../src/triggers/shared/backlog-check.js', () => ({
	isActivePipelineOverCapacity: mockIsActivePipelineOverCapacity,
}));

vi.mock('../../../../src/pm/lifecycle.js', () => ({
	resolveProjectPMConfig: mockResolveProjectPMConfig,
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

	it('blocks implementation when active pipeline is over capacity and moves card back to backlog', async () => {
		const fakeProvider = {
			type: 'jira',
			moveWorkItem: vi.fn().mockResolvedValue(undefined),
			addComment: vi.fn().mockResolvedValue('comment-id'),
		};
		mockGetPMProvider.mockReturnValue(fakeProvider);
		mockIsActivePipelineOverCapacity.mockResolvedValue({
			overCapacity: true,
			reason: 'over-capacity',
			inFlightCount: 2,
			limit: 1,
		});
		mockResolveProjectPMConfig.mockReturnValue({
			labels: {},
			statuses: { backlog: 'Backlog' },
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
			'pipeline-at-capacity: moving card back to backlog',
			expect.objectContaining({
				agentType: 'implementation',
				workItemId: 'UA-3',
				inFlightCount: 2,
				limit: 1,
			}),
		);
		// Card must be moved back to BACKLOG so it doesn't permanently inflate inFlightCount
		expect(fakeProvider.moveWorkItem).toHaveBeenCalledWith('UA-3', 'Backlog');
		expect(fakeProvider.addComment).toHaveBeenCalledWith(
			'UA-3',
			expect.stringContaining('Pipeline at capacity'),
		);
		expect(mockLogger.info).toHaveBeenCalledWith(
			'pipeline-capacity-gate: card moved back to backlog',
			expect.objectContaining({ workItemId: 'UA-3', backlogDestination: 'Backlog' }),
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

	it('blocks and still returns true even when no backlog status is configured (logs warn, card left in place)', async () => {
		const fakeProvider = {
			type: 'jira',
			moveWorkItem: vi.fn(),
			addComment: vi.fn(),
		};
		mockGetPMProvider.mockReturnValue(fakeProvider);
		mockIsActivePipelineOverCapacity.mockResolvedValue({
			overCapacity: true,
			reason: 'over-capacity',
			inFlightCount: 1,
			limit: 1,
		});
		mockResolveProjectPMConfig.mockReturnValue({
			labels: {},
			statuses: {}, // no backlog configured
		});

		const blocked = await shouldBlockForPipelineCapacity({
			project,
			agentType: 'implementation',
			workItemId: 'UA-5',
			source: 'jira',
		});

		expect(blocked).toBe(true);
		expect(fakeProvider.moveWorkItem).not.toHaveBeenCalled();
		expect(mockLogger.warn).toHaveBeenCalledWith(
			'pipeline-capacity-gate: no backlog status configured, card left in current column',
			expect.objectContaining({ workItemId: 'UA-5' }),
		);
	});

	it('blocks and still returns true even when moveWorkItem throws (non-fatal, logs warn)', async () => {
		const fakeProvider = {
			type: 'trello',
			moveWorkItem: vi.fn().mockRejectedValue(new Error('API error')),
			addComment: vi.fn(),
		};
		mockGetPMProvider.mockReturnValue(fakeProvider);
		mockIsActivePipelineOverCapacity.mockResolvedValue({
			overCapacity: true,
			reason: 'over-capacity',
			inFlightCount: 1,
			limit: 1,
		});
		mockResolveProjectPMConfig.mockReturnValue({
			labels: {},
			statuses: { backlog: 'backlog-list-id' },
		});

		const blocked = await shouldBlockForPipelineCapacity({
			project,
			agentType: 'implementation',
			workItemId: 'card-7',
			source: 'trello',
		});

		// Gate must still block even when the move-back call fails
		expect(blocked).toBe(true);
		expect(mockLogger.warn).toHaveBeenCalledWith(
			'pipeline-capacity-gate: failed to move card back to backlog',
			expect.objectContaining({ workItemId: 'card-7', error: 'Error: API error' }),
		);
	});
});
