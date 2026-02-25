import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/agents/utils/tracking.js', () => ({
	recordSyntheticInvocationId: vi.fn(),
}));

import { injectSyntheticCall } from '../../../../src/agents/shared/syntheticCalls.js';
import { recordSyntheticInvocationId } from '../../../../src/agents/utils/tracking.js';

const mockRecordSyntheticInvocationId = vi.mocked(recordSyntheticInvocationId);

function createMockBuilder() {
	const builder = {
		withSyntheticGadgetCall: vi.fn(),
	};
	builder.withSyntheticGadgetCall.mockReturnValue(builder);
	return builder;
}

function createTrackingContext() {
	return {
		metrics: { llmIterations: 0, gadgetCalls: 0 },
		syntheticInvocationIds: new Set<string>(),
		loopDetection: {
			previousIterationCalls: [],
			currentIterationCalls: [],
			repeatCount: 1,
			repeatedPattern: null,
			pendingWarning: null,
			nameOnlyRepeatCount: 1,
			pendingAction: null,
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('injectSyntheticCall', () => {
	it('records the invocation ID for tracking', () => {
		const builder = createMockBuilder();
		const ctx = createTrackingContext();

		injectSyntheticCall(
			builder as never,
			ctx as never,
			'ReadFile',
			{ filePath: '/foo.ts' },
			'content',
			'gc_test',
		);

		expect(mockRecordSyntheticInvocationId).toHaveBeenCalledWith(ctx, 'gc_test');
	});

	it('calls withSyntheticGadgetCall on builder with correct params', () => {
		const builder = createMockBuilder();
		const ctx = createTrackingContext();

		injectSyntheticCall(
			builder as never,
			ctx as never,
			'ReadFile',
			{ filePath: '/foo.ts' },
			'file content',
			'gc_1',
		);

		expect(builder.withSyntheticGadgetCall).toHaveBeenCalledWith(
			'ReadFile',
			{ filePath: '/foo.ts' },
			'file content',
			'gc_1',
		);
	});

	it('returns the result of withSyntheticGadgetCall', () => {
		const builder = createMockBuilder();
		const ctx = createTrackingContext();

		const result = injectSyntheticCall(
			builder as never,
			ctx as never,
			'ReadFile',
			{},
			'result',
			'gc_2',
		);

		expect(result).toBe(builder);
	});
});
