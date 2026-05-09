import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentResult, CascadeConfig, ProjectConfig } from '../../../../src/types/index.js';

const { mockShouldTriggerDebug, mockTriggerDebugAnalysis, mockLogger } = vi.hoisted(() => ({
	mockShouldTriggerDebug: vi.fn(),
	mockTriggerDebugAnalysis: vi.fn(),
	mockLogger: {
		error: vi.fn(),
	},
}));

vi.mock('../../../../src/triggers/shared/debug-trigger.js', () => ({
	shouldTriggerDebug: (...args: unknown[]) => mockShouldTriggerDebug(...args),
}));

vi.mock('../../../../src/triggers/shared/debug-runner.js', () => ({
	triggerDebugAnalysis: (...args: unknown[]) => mockTriggerDebugAnalysis(...args),
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

import { triggerAutoDebugIfNeeded } from '../../../../src/triggers/shared/agent-auto-debug.js';

const PROJECT = { id: 'project-1', pm: { type: 'trello' } } as ProjectConfig;
const CONFIG = {} as CascadeConfig;

describe('triggerAutoDebugIfNeeded', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockShouldTriggerDebug.mockResolvedValue(null);
		mockTriggerDebugAnalysis.mockResolvedValue(undefined);
	});

	it('returns missing-run-id and does not check eligibility without runId', async () => {
		const result = await triggerAutoDebugIfNeeded(
			{ success: false, output: '', error: 'failed' } as AgentResult,
			PROJECT,
			CONFIG,
		);

		expect(result).toEqual({ triggered: false, reason: 'missing-run-id' });
		expect(mockShouldTriggerDebug).not.toHaveBeenCalled();
	});

	it('returns not-eligible when debug trigger check skips the run', async () => {
		const result = await triggerAutoDebugIfNeeded(
			{ success: false, output: '', runId: 'run-1' } as AgentResult,
			PROJECT,
			CONFIG,
		);

		expect(result).toEqual({ triggered: false, reason: 'not-eligible' });
		expect(mockShouldTriggerDebug).toHaveBeenCalledWith('run-1');
		expect(mockTriggerDebugAnalysis).not.toHaveBeenCalled();
	});

	it('fires triggerDebugAnalysis asynchronously when eligible', async () => {
		mockShouldTriggerDebug.mockResolvedValueOnce({
			runId: 'run-1',
			agentType: 'implementation',
			workItemId: 'card-1',
		});

		const result = await triggerAutoDebugIfNeeded(
			{ success: false, output: '', runId: 'run-1' } as AgentResult,
			PROJECT,
			CONFIG,
		);

		expect(result).toEqual({ triggered: true, runId: 'run-1', workItemId: 'card-1' });
		expect(mockTriggerDebugAnalysis).toHaveBeenCalledWith('run-1', PROJECT, CONFIG, 'card-1');
	});

	it('logs asynchronous debug dispatch failures without throwing', async () => {
		mockShouldTriggerDebug.mockResolvedValueOnce({
			runId: 'run-1',
			agentType: 'implementation',
			workItemId: 'card-1',
		});
		mockTriggerDebugAnalysis.mockRejectedValueOnce(new Error('debug failed'));

		await expect(
			triggerAutoDebugIfNeeded(
				{ success: false, output: '', runId: 'run-1' } as AgentResult,
				PROJECT,
				CONFIG,
			),
		).resolves.toEqual({ triggered: true, runId: 'run-1', workItemId: 'card-1' });
		await Promise.resolve();

		expect(mockLogger.error).toHaveBeenCalledWith('Auto-debug failed', {
			error: 'Error: debug failed',
		});
	});
});
