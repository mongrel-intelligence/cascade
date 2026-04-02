import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	getRunById: vi.fn(),
	getDebugAnalysisByRunId: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		warn: vi.fn(),
		info: vi.fn(),
	},
}));

import {
	getDebugAnalysisByRunId,
	getRunById,
} from '../../../src/db/repositories/runsRepository.js';
import { shouldTriggerDebug } from '../../../src/triggers/shared/debug-trigger.js';

describe('shouldTriggerDebug', () => {
	it('returns null when runId is undefined', async () => {
		const result = await shouldTriggerDebug(undefined);
		expect(result).toBeNull();
		expect(getRunById).not.toHaveBeenCalled();
	});

	it('returns null when run is not found', async () => {
		vi.mocked(getRunById).mockResolvedValue(null);

		const result = await shouldTriggerDebug('run-1');
		expect(result).toBeNull();
	});

	it('returns null for completed runs', async () => {
		vi.mocked(getRunById).mockResolvedValue({
			id: 'run-1',
			agentType: 'implementation',
			status: 'completed',
			workItemId: 'card-1',
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);

		const result = await shouldTriggerDebug('run-1');
		expect(result).toBeNull();
	});

	it('returns null for running status', async () => {
		vi.mocked(getRunById).mockResolvedValue({
			id: 'run-1',
			agentType: 'implementation',
			status: 'running',
			workItemId: 'card-1',
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);

		const result = await shouldTriggerDebug('run-1');
		expect(result).toBeNull();
	});

	it('returns null for debug agent runs (prevent infinite loop)', async () => {
		vi.mocked(getRunById).mockResolvedValue({
			id: 'run-1',
			agentType: 'debug',
			status: 'failed',
			workItemId: 'card-1',
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);

		const result = await shouldTriggerDebug('run-1');
		expect(result).toBeNull();
	});

	it('returns null when debug analysis already exists', async () => {
		vi.mocked(getRunById).mockResolvedValue({
			id: 'run-1',
			agentType: 'implementation',
			status: 'failed',
			workItemId: 'card-1',
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);
		vi.mocked(getDebugAnalysisByRunId).mockResolvedValue({
			id: 'da-1',
			analyzedRunId: 'run-1',
			summary: 'Already analyzed',
		} as ReturnType<typeof getDebugAnalysisByRunId> extends Promise<infer T>
			? NonNullable<T>
			: never);

		const result = await shouldTriggerDebug('run-1');
		expect(result).toBeNull();
	});

	it('returns debug target for failed implementation run', async () => {
		vi.mocked(getRunById).mockResolvedValue({
			id: 'run-1',
			agentType: 'implementation',
			status: 'failed',
			workItemId: 'card-1',
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);
		vi.mocked(getDebugAnalysisByRunId).mockResolvedValue(null);

		const result = await shouldTriggerDebug('run-1');
		expect(result).toEqual({
			runId: 'run-1',
			agentType: 'implementation',
			workItemId: 'card-1',
		});
	});

	it('returns debug target for timed_out run', async () => {
		vi.mocked(getRunById).mockResolvedValue({
			id: 'run-2',
			agentType: 'splitting',
			status: 'timed_out',
			workItemId: 'card-2',
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);
		vi.mocked(getDebugAnalysisByRunId).mockResolvedValue(null);

		const result = await shouldTriggerDebug('run-2');
		expect(result).toEqual({
			runId: 'run-2',
			agentType: 'splitting',
			workItemId: 'card-2',
		});
	});

	it('returns undefined workItemId when run has no workItemId', async () => {
		vi.mocked(getRunById).mockResolvedValue({
			id: 'run-3',
			agentType: 'review',
			status: 'failed',
			workItemId: null,
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);
		vi.mocked(getDebugAnalysisByRunId).mockResolvedValue(null);

		const result = await shouldTriggerDebug('run-3');
		expect(result).toEqual({
			runId: 'run-3',
			agentType: 'review',
			workItemId: undefined,
		});
	});

	it('returns null on database error', async () => {
		vi.mocked(getRunById).mockRejectedValue(new Error('DB connection failed'));

		const result = await shouldTriggerDebug('run-1');
		expect(result).toBeNull();
	});
});
