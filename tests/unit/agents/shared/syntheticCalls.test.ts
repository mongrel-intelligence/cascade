import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/squintDb.js', () => ({
	resolveSquintDbPath: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../../src/agents/utils/tracking.js', () => ({
	recordSyntheticInvocationId: vi.fn(),
}));

vi.mock('node:child_process', () => ({
	execFileSync: vi.fn(),
}));

// Mock ListDirectory gadget
vi.mock('../../../../src/gadgets/ListDirectory.js', () => ({
	ListDirectory: vi.fn().mockImplementation(() => ({
		execute: vi.fn().mockReturnValue('mocked directory listing output'),
	})),
}));

import { execFileSync } from 'node:child_process';
import {
	injectContextFiles,
	injectDirectoryListing,
	injectSquintContext,
	injectSyntheticCall,
} from '../../../../src/agents/shared/syntheticCalls.js';
import { recordSyntheticInvocationId } from '../../../../src/agents/utils/tracking.js';
import { resolveSquintDbPath } from '../../../../src/utils/squintDb.js';

const mockResolveSquintDbPath = vi.mocked(resolveSquintDbPath);
const mockExecFileSync = vi.mocked(execFileSync);
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
	mockResolveSquintDbPath.mockReturnValue(null);
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

describe('injectDirectoryListing', () => {
	it('calls injectSyntheticCall with ListDirectory gadget name', () => {
		const builder = createMockBuilder();
		const ctx = createTrackingContext();

		injectDirectoryListing(builder as never, ctx as never);

		expect(builder.withSyntheticGadgetCall).toHaveBeenCalledWith(
			'ListDirectory',
			expect.objectContaining({ directoryPath: '.', maxDepth: 3 }),
			'mocked directory listing output',
			'gc_dir',
		);
	});

	it('uses custom maxDepth when provided', () => {
		const builder = createMockBuilder();
		const ctx = createTrackingContext();

		injectDirectoryListing(builder as never, ctx as never, 5);

		expect(builder.withSyntheticGadgetCall).toHaveBeenCalledWith(
			'ListDirectory',
			expect.objectContaining({ maxDepth: 5 }),
			expect.any(String),
			'gc_dir',
		);
	});

	it('records the invocation ID gc_dir', () => {
		const builder = createMockBuilder();
		const ctx = createTrackingContext();

		injectDirectoryListing(builder as never, ctx as never);

		expect(mockRecordSyntheticInvocationId).toHaveBeenCalledWith(ctx, 'gc_dir');
	});
});

describe('injectContextFiles', () => {
	it('injects multiple context files with sequential IDs', () => {
		const builder = createMockBuilder();
		const ctx = createTrackingContext();
		const files = [
			{ path: 'CLAUDE.md', content: '# Project docs' },
			{ path: 'AGENTS.md', content: '# Agent docs' },
		];

		injectContextFiles(builder as never, ctx as never, files);

		expect(builder.withSyntheticGadgetCall).toHaveBeenCalledTimes(2);
		expect(builder.withSyntheticGadgetCall).toHaveBeenCalledWith(
			'ReadFile',
			expect.objectContaining({ filePath: 'CLAUDE.md' }),
			'# Project docs',
			'gc_init_1',
		);
		expect(builder.withSyntheticGadgetCall).toHaveBeenCalledWith(
			'ReadFile',
			expect.objectContaining({ filePath: 'AGENTS.md' }),
			'# Agent docs',
			'gc_init_2',
		);
	});

	it('returns builder unchanged when contextFiles is empty', () => {
		const builder = createMockBuilder();
		const ctx = createTrackingContext();

		const result = injectContextFiles(builder as never, ctx as never, []);

		expect(builder.withSyntheticGadgetCall).not.toHaveBeenCalled();
		expect(result).toBe(builder);
	});

	it('records synthetic invocation ID for each file', () => {
		const builder = createMockBuilder();
		const ctx = createTrackingContext();
		const files = [
			{ path: 'CLAUDE.md', content: 'docs' },
			{ path: 'AGENTS.md', content: 'agents' },
		];

		injectContextFiles(builder as never, ctx as never, files);

		expect(mockRecordSyntheticInvocationId).toHaveBeenCalledWith(ctx, 'gc_init_1');
		expect(mockRecordSyntheticInvocationId).toHaveBeenCalledWith(ctx, 'gc_init_2');
	});

	it('includes comment describing the file in ReadFile params', () => {
		const builder = createMockBuilder();
		const ctx = createTrackingContext();
		const files = [{ path: 'CLAUDE.md', content: 'docs' }];

		injectContextFiles(builder as never, ctx as never, files);

		expect(builder.withSyntheticGadgetCall).toHaveBeenCalledWith(
			'ReadFile',
			expect.objectContaining({ comment: expect.stringContaining('CLAUDE.md') }),
			'docs',
			'gc_init_1',
		);
	});
});

describe('injectSquintContext', () => {
	it('returns builder unchanged when squint DB not found', () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		const builder = createMockBuilder();
		const ctx = createTrackingContext();

		const result = injectSquintContext(builder as never, ctx as never, '/repo');

		expect(result).toBe(builder);
		expect(builder.withSyntheticGadgetCall).not.toHaveBeenCalled();
	});

	it('calls squint overview command when DB is found', () => {
		mockResolveSquintDbPath.mockReturnValue('/repo/.squint.db');
		mockExecFileSync.mockReturnValue('squint overview output' as never);
		const builder = createMockBuilder();
		const ctx = createTrackingContext();

		injectSquintContext(builder as never, ctx as never, '/repo');

		expect(mockExecFileSync).toHaveBeenCalledWith(
			'squint',
			['overview', '-d', '/repo/.squint.db'],
			{
				encoding: 'utf-8',
				timeout: 30_000,
			},
		);
	});

	it('injects squint overview as synthetic SquintOverview call', () => {
		mockResolveSquintDbPath.mockReturnValue('/repo/.squint.db');
		mockExecFileSync.mockReturnValue('# Squint Overview\n- modules: 5' as never);
		const builder = createMockBuilder();
		const ctx = createTrackingContext();

		injectSquintContext(builder as never, ctx as never, '/repo');

		expect(builder.withSyntheticGadgetCall).toHaveBeenCalledWith(
			'SquintOverview',
			expect.objectContaining({ database: '/repo/.squint.db' }),
			'# Squint Overview\n- modules: 5',
			'gc_squint_overview',
		);
	});

	it('returns builder unchanged when squint output is empty', () => {
		mockResolveSquintDbPath.mockReturnValue('/repo/.squint.db');
		mockExecFileSync.mockReturnValue('' as never);
		const builder = createMockBuilder();
		const ctx = createTrackingContext();

		const result = injectSquintContext(builder as never, ctx as never, '/repo');

		expect(result).toBe(builder);
		expect(builder.withSyntheticGadgetCall).not.toHaveBeenCalled();
	});

	it('returns builder unchanged when squint command throws', () => {
		mockResolveSquintDbPath.mockReturnValue('/repo/.squint.db');
		mockExecFileSync.mockImplementation(() => {
			throw new Error('squint not found');
		});
		const builder = createMockBuilder();
		const ctx = createTrackingContext();

		const result = injectSquintContext(builder as never, ctx as never, '/repo');

		expect(result).toBe(builder);
		expect(builder.withSyntheticGadgetCall).not.toHaveBeenCalled();
	});
});
