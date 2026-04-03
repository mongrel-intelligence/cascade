import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

import { resolveTriggerResult } from '../../../../src/triggers/shared/trigger-resolution.js';
import type { TriggerContext, TriggerResult } from '../../../../src/types/index.js';
import { logger } from '../../../../src/utils/logging.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockProject = {
	id: 'project-1',
	name: 'Test',
	repo: 'owner/repo',
	baseBranch: 'main',
} as Parameters<typeof resolveTriggerResult>[1]['project'];

const ctx: TriggerContext = {
	project: mockProject,
	source: 'github',
	payload: { some: 'data' },
};

const triggerResult: TriggerResult = {
	agentType: 'implementation',
	agentInput: { repoFullName: 'owner/repo' },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveTriggerResult', () => {
	let mockRegistry: { dispatch: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		vi.clearAllMocks();
		mockRegistry = { dispatch: vi.fn().mockResolvedValue(null) };
	});

	it('returns preResolvedResult without dispatching when provided', async () => {
		const result = await resolveTriggerResult(mockRegistry as never, ctx, triggerResult);

		expect(result).toBe(triggerResult);
		expect(mockRegistry.dispatch).not.toHaveBeenCalled();
	});

	it('logs info message with agentType when preResolvedResult is provided', async () => {
		await resolveTriggerResult(mockRegistry as never, ctx, triggerResult, 'MyHandler');

		expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
			expect.stringContaining('pre-resolved trigger result'),
			expect.objectContaining({ agentType: 'implementation' }),
		);
	});

	it('includes logLabel in log message when provided', async () => {
		await resolveTriggerResult(mockRegistry as never, ctx, triggerResult, 'MyCustomLabel');

		expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
			expect.stringContaining('MyCustomLabel'),
			expect.any(Object),
		);
	});

	it('falls back to ctx.source in log message when no logLabel', async () => {
		await resolveTriggerResult(mockRegistry as never, ctx, triggerResult);

		expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
			expect.stringContaining('github'),
			expect.any(Object),
		);
	});

	it('dispatches to registry when no preResolvedResult', async () => {
		mockRegistry.dispatch.mockResolvedValue(triggerResult);

		const result = await resolveTriggerResult(mockRegistry as never, ctx);

		expect(mockRegistry.dispatch).toHaveBeenCalledWith(ctx);
		expect(result).toBe(triggerResult);
	});

	it('returns null when registry dispatch returns null', async () => {
		mockRegistry.dispatch.mockResolvedValue(null);

		const result = await resolveTriggerResult(mockRegistry as never, ctx);

		expect(result).toBeNull();
	});

	it('logs info when no trigger matched (dispatch returns null)', async () => {
		mockRegistry.dispatch.mockResolvedValue(null);

		await resolveTriggerResult(mockRegistry as never, ctx, undefined, 'TestHandler');

		expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
			expect.stringContaining('no trigger matched'),
		);
	});

	it('does not log "no trigger matched" when dispatch returns a result', async () => {
		mockRegistry.dispatch.mockResolvedValue(triggerResult);

		await resolveTriggerResult(mockRegistry as never, ctx);

		const infoCall = vi
			.mocked(logger.info)
			.mock.calls.find((call) => String(call[0]).includes('no trigger matched'));
		expect(infoCall).toBeUndefined();
	});

	it('passes undefined preResolvedResult and dispatches', async () => {
		mockRegistry.dispatch.mockResolvedValue(triggerResult);

		const result = await resolveTriggerResult(mockRegistry as never, ctx, undefined);

		expect(mockRegistry.dispatch).toHaveBeenCalledOnce();
		expect(result).toBe(triggerResult);
	});
});
