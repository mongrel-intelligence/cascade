import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/agents/utils/tracking.js', () => ({
	recordSyntheticInvocationId: vi.fn(),
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock llmist to capture imageFromBase64 and text calls
vi.mock('llmist', () => ({
	imageFromBase64: vi.fn((data: string, mimeType: string) => ({
		type: 'image',
		source: { type: 'base64', mediaType: mimeType, data },
	})),
	text: vi.fn((content: string) => ({ type: 'text', text: content })),
}));

import { imageFromBase64, text } from 'llmist';
import { injectSyntheticCall } from '../../../../src/agents/shared/syntheticCalls.js';
import { recordSyntheticInvocationId } from '../../../../src/agents/utils/tracking.js';
import { logger } from '../../../../src/utils/logging.js';

const mockRecordSyntheticInvocationId = vi.mocked(recordSyntheticInvocationId);
const mockImageFromBase64 = vi.mocked(imageFromBase64);
const mockText = vi.mocked(text);
const mockLogger = vi.mocked(logger);

function createMockBuilder() {
	const builder = {
		withSyntheticGadgetCall: vi.fn(),
		addMessage: vi.fn(),
	};
	builder.withSyntheticGadgetCall.mockReturnValue(builder);
	builder.addMessage.mockReturnValue(builder);
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

	it('does not call addMessage when no images are provided', () => {
		const builder = createMockBuilder();
		const ctx = createTrackingContext();

		injectSyntheticCall(builder as never, ctx as never, 'ReadFile', {}, 'result', 'gc_3');

		expect(builder.addMessage).not.toHaveBeenCalled();
	});

	it('does not call addMessage when images array is empty', () => {
		const builder = createMockBuilder();
		const ctx = createTrackingContext();

		injectSyntheticCall(builder as never, ctx as never, 'ReadFile', {}, 'result', 'gc_4', []);

		expect(builder.addMessage).not.toHaveBeenCalled();
	});

	it('calls addMessage with image content parts when images are provided', () => {
		const builder = createMockBuilder();
		const ctx = createTrackingContext();

		const images = [{ base64Data: 'abc123', mimeType: 'image/png', altText: 'Screenshot' }];

		injectSyntheticCall(
			builder as never,
			ctx as never,
			'ReadWorkItem',
			{ workItemId: 'c1' },
			'card content',
			'gc_5',
			images,
		);

		expect(builder.addMessage).toHaveBeenCalledTimes(1);
		expect(mockImageFromBase64).toHaveBeenCalledWith('abc123', 'image/png');
		expect(mockText).toHaveBeenCalled();
		// Verify addMessage called with a user message containing content parts
		const addMessageArg = builder.addMessage.mock.calls[0][0];
		expect(addMessageArg).toHaveProperty('user');
		expect(Array.isArray(addMessageArg.user)).toBe(true);
	});

	it('calls addMessage with multiple image content parts for multiple images', () => {
		const builder = createMockBuilder();
		const ctx = createTrackingContext();

		const images = [
			{ base64Data: 'data1', mimeType: 'image/png', altText: 'First' },
			{ base64Data: 'data2', mimeType: 'image/jpeg' },
		];

		injectSyntheticCall(
			builder as never,
			ctx as never,
			'ReadWorkItem',
			{},
			'card content',
			'gc_6',
			images,
		);

		expect(builder.addMessage).toHaveBeenCalledTimes(1);
		expect(mockImageFromBase64).toHaveBeenCalledTimes(2);
		expect(mockImageFromBase64).toHaveBeenNthCalledWith(1, 'data1', 'image/png');
		expect(mockImageFromBase64).toHaveBeenNthCalledWith(2, 'data2', 'image/jpeg');
		// 1 text part + 2 image parts
		const addMessageArg = builder.addMessage.mock.calls[0][0];
		expect((addMessageArg as { user: unknown[] }).user).toHaveLength(3);
	});

	it('skips images with unsupported MIME types and logs a warning', () => {
		const builder = createMockBuilder();
		const ctx = createTrackingContext();

		const images = [
			{ base64Data: 'data1', mimeType: 'image/bmp' }, // unsupported
		];

		injectSyntheticCall(
			builder as never,
			ctx as never,
			'ReadWorkItem',
			{},
			'card content',
			'gc_7',
			images,
		);

		// No addMessage call since all images were filtered out
		expect(builder.addMessage).not.toHaveBeenCalled();
		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('unsupported MIME type'),
			expect.objectContaining({ mimeType: 'image/bmp' }),
		);
	});

	it('gracefully falls back when addMessage throws', () => {
		const builder = createMockBuilder();
		builder.addMessage.mockImplementation(() => {
			throw new Error('addMessage failed');
		});
		const ctx = createTrackingContext();

		const images = [{ base64Data: 'abc', mimeType: 'image/png' }];

		// Should not throw
		expect(() =>
			injectSyntheticCall(
				builder as never,
				ctx as never,
				'ReadWorkItem',
				{},
				'result',
				'gc_8',
				images,
			),
		).not.toThrow();

		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Failed to inject images'),
			expect.objectContaining({ gadgetName: 'ReadWorkItem' }),
		);
	});
});
