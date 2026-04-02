import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock external dependencies
vi.mock('../../../../src/gadgets/tmux.js', () => ({
	consumePendingSessionNotices: vi.fn().mockReturnValue(new Map()),
}));

vi.mock('../../../../src/sentry.js', () => ({
	addBreadcrumb: vi.fn(),
}));

vi.mock('../../../../src/utils/interactive.js', () => ({
	displayGadgetCall: vi.fn(),
	displayGadgetResult: vi.fn(),
	displayLLMText: vi.fn(),
	waitForEnter: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../src/agents/utils/logging.js', () => ({
	createAgentLogger: vi.fn(),
}));

vi.mock('../../../../src/agents/utils/tracking.js', () => ({
	consumeLoopAction: vi.fn().mockReturnValue(null),
	consumeLoopWarning: vi.fn().mockReturnValue(null),
	incrementGadgetCall: vi.fn(),
	isSyntheticCall: vi.fn().mockReturnValue(false),
	recordGadgetCallForLoop: vi.fn(),
}));

import { runAgentLoop, truncateContent } from '../../../../src/agents/utils/agentLoop.js';
import {
	consumeLoopAction,
	consumeLoopWarning,
	incrementGadgetCall,
	isSyntheticCall,
	recordGadgetCallForLoop,
} from '../../../../src/agents/utils/tracking.js';
import { consumePendingSessionNotices } from '../../../../src/gadgets/tmux.js';
import { addBreadcrumb } from '../../../../src/sentry.js';
import {
	displayGadgetCall,
	displayGadgetResult,
	displayLLMText,
	waitForEnter,
} from '../../../../src/utils/interactive.js';

const mockAddBreadcrumb = vi.mocked(addBreadcrumb);
const mockConsumePendingSessionNotices = vi.mocked(consumePendingSessionNotices);
const mockDisplayGadgetCall = vi.mocked(displayGadgetCall);
const _mockDisplayGadgetResult = vi.mocked(displayGadgetResult);
const mockDisplayLLMText = vi.mocked(displayLLMText);
const mockWaitForEnter = vi.mocked(waitForEnter);
const mockConsumeLoopAction = vi.mocked(consumeLoopAction);
const mockConsumeLoopWarning = vi.mocked(consumeLoopWarning);
const mockIncrementGadgetCall = vi.mocked(incrementGadgetCall);
const mockIsSyntheticCall = vi.mocked(isSyntheticCall);
const mockRecordGadgetCallForLoop = vi.mocked(recordGadgetCallForLoop);

function createMockLog() {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

function createTrackingContext(overrides?: object) {
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
		...overrides,
	};
}

function createMockAgent(events: object[]) {
	return {
		run: async function* () {
			for (const event of events) {
				yield event;
			}
		},
		getTree: vi.fn().mockReturnValue({ getTotalCost: vi.fn().mockReturnValue(1.5) }),
		injectUserMessage: vi.fn(),
	};
}

beforeEach(() => {
	mockAddBreadcrumb.mockClear();
	mockConsumePendingSessionNotices.mockReturnValue(new Map());
	mockConsumeLoopWarning.mockReturnValue(null);
	mockConsumeLoopAction.mockReturnValue(null);
	mockIsSyntheticCall.mockReturnValue(false);
});

// ============================================================================
// truncateContent
// ============================================================================

describe('truncateContent', () => {
	it('returns content unchanged if within maxLen', () => {
		const content = 'hello world';
		expect(truncateContent(content, 400)).toBe('hello world');
	});

	it('truncates content that exceeds maxLen', () => {
		const content = 'a'.repeat(500);
		const result = truncateContent(content, 400);
		expect(result).toContain('[100 truncated]');
		expect(result.length).toBeLessThan(500);
	});

	it('uses default maxLen of 400', () => {
		const content = 'x'.repeat(500);
		const result = truncateContent(content);
		expect(result).toContain('truncated');
	});

	it('preserves first and last half of content', () => {
		const content = `FIRST${'x'.repeat(500)}LAST`;
		const result = truncateContent(content, 400);
		expect(result.startsWith('FIRST')).toBe(true);
		expect(result.endsWith('LAST')).toBe(true);
	});

	it('returns content exactly at maxLen unchanged', () => {
		const content = 'a'.repeat(400);
		expect(truncateContent(content, 400)).toBe(content);
	});
});

// ============================================================================
// runAgentLoop
// ============================================================================

describe('runAgentLoop', () => {
	it('processes text events and accumulates output', async () => {
		const agent = createMockAgent([
			{ type: 'text', content: 'Hello' },
			{ type: 'text', content: 'World' },
		]);
		const log = createMockLog();
		const ctx = createTrackingContext();

		const result = await runAgentLoop(agent as never, log as never, ctx as never);

		expect(result.output).toBe('Hello\nWorld');
	});

	it('returns cost from getTree().getTotalCost()', async () => {
		const agent = createMockAgent([]);
		const log = createMockLog();
		const ctx = createTrackingContext();

		const result = await runAgentLoop(agent as never, log as never, ctx as never);

		expect(result.cost).toBe(1.5);
	});

	it('returns zero cost if getTree() returns null', async () => {
		const agent = createMockAgent([]);
		agent.getTree.mockReturnValue(null);
		const log = createMockLog();
		const ctx = createTrackingContext();

		const result = await runAgentLoop(agent as never, log as never, ctx as never);

		expect(result.cost).toBe(0);
	});

	it('tracks gadget calls via incrementGadgetCall for non-synthetic calls', async () => {
		const agent = createMockAgent([
			{
				type: 'gadget_call',
				call: { gadgetName: 'ReadFile', invocationId: 'gc_1', parameters: { filePath: '/foo.ts' } },
			},
		]);
		mockIsSyntheticCall.mockReturnValue(false);
		const log = createMockLog();
		const ctx = createTrackingContext();

		await runAgentLoop(agent as never, log as never, ctx as never);

		expect(mockIncrementGadgetCall).toHaveBeenCalled();
		expect(mockRecordGadgetCallForLoop).toHaveBeenCalled();
	});

	it('does not call incrementGadgetCall for synthetic calls', async () => {
		const agent = createMockAgent([
			{
				type: 'gadget_call',
				call: { gadgetName: 'ReadFile', invocationId: 'gc_init_1', parameters: {} },
			},
		]);
		mockIsSyntheticCall.mockReturnValue(true);
		const log = createMockLog();
		const ctx = createTrackingContext();

		await runAgentLoop(agent as never, log as never, ctx as never);

		expect(mockIncrementGadgetCall).not.toHaveBeenCalled();
	});

	it('handles gadget_result events and logs them', async () => {
		const agent = createMockAgent([
			{
				type: 'gadget_result',
				result: { gadgetName: 'ReadFile', executionTimeMs: 50, result: 'file contents' },
			},
		]);
		const log = createMockLog();
		const ctx = createTrackingContext();

		await runAgentLoop(agent as never, log as never, ctx as never);

		expect(log.info).toHaveBeenCalledWith(
			'[Gadget result]',
			expect.objectContaining({ name: 'ReadFile', ms: 50 }),
		);
	});

	it('logs error for gadget_result with error field', async () => {
		const agent = createMockAgent([
			{
				type: 'gadget_result',
				result: { gadgetName: 'WriteFile', executionTimeMs: 10, error: 'Permission denied' },
			},
		]);
		const log = createMockLog();
		const ctx = createTrackingContext();

		await runAgentLoop(agent as never, log as never, ctx as never);

		expect(log.error).toHaveBeenCalledWith(
			'[Gadget result]',
			expect.objectContaining({ error: 'Permission denied' }),
		);
	});

	it('handles stream_complete event by logging info', async () => {
		const agent = createMockAgent([{ type: 'stream_complete' }]);
		const log = createMockLog();
		const ctx = createTrackingContext();

		await runAgentLoop(agent as never, log as never, ctx as never);

		expect(log.info).toHaveBeenCalledWith('Stream complete', expect.any(Object));
	});

	it('calls injectUserMessage when session completions are pending', async () => {
		const notice = { exitCode: 0, tailOutput: 'output' };
		mockConsumePendingSessionNotices.mockReturnValue(new Map([['session1', notice]]));

		const agent = createMockAgent([{ type: 'text', content: 'Hello' }]);
		const log = createMockLog();
		const ctx = createTrackingContext();

		await runAgentLoop(agent as never, log as never, ctx as never);

		expect(agent.injectUserMessage).toHaveBeenCalledWith(expect.stringContaining('session1'));
		expect(agent.injectUserMessage).toHaveBeenCalledWith(expect.stringContaining('exit code 0'));
	});

	it('injects loop warning messages when pending', async () => {
		mockConsumeLoopWarning.mockReturnValue('⚠️ LOOP DETECTED — please change approach');

		const agent = createMockAgent([{ type: 'text', content: 'Hello' }]);
		const log = createMockLog();
		const ctx = createTrackingContext();

		await runAgentLoop(agent as never, log as never, ctx as never);

		expect(agent.injectUserMessage).toHaveBeenCalledWith(
			'⚠️ LOOP DETECTED — please change approach',
		);
	});

	it('terminates with hard_stop when loop action says hard_stop', async () => {
		mockConsumeLoopAction.mockReturnValue({
			type: 'hard_stop',
			message: '[System] 🛑 SEMANTIC LOOP — FORCED TERMINATION',
		});

		// Create a generator that yields multiple events
		const events = [
			{ type: 'text', content: 'First' },
			{ type: 'text', content: 'Second' },
		];
		const agent = createMockAgent(events);
		const log = createMockLog();
		const ctx = createTrackingContext();

		const result = await runAgentLoop(agent as never, log as never, ctx as never);

		expect(result.loopTerminated).toBe(true);
		expect(log.error).toHaveBeenCalledWith(
			'[Loop Hard Stop] Agent terminated due to persistent semantic loop',
			expect.any(Object),
		);
	});

	it('does not set loopTerminated when normal completion', async () => {
		const agent = createMockAgent([{ type: 'text', content: 'Done' }]);
		const log = createMockLog();
		const ctx = createTrackingContext();

		const result = await runAgentLoop(agent as never, log as never, ctx as never);

		expect(result.loopTerminated).toBe(false);
	});

	it('displays text in interactive mode', async () => {
		const agent = createMockAgent([{ type: 'text', content: 'Interactive output' }]);
		const log = createMockLog();
		const ctx = createTrackingContext();

		await runAgentLoop(agent as never, log as never, ctx as never, true);

		expect(mockDisplayLLMText).toHaveBeenCalledWith('Interactive output');
	});

	it('does not display text in non-interactive mode', async () => {
		const agent = createMockAgent([{ type: 'text', content: 'Silent output' }]);
		const log = createMockLog();
		const ctx = createTrackingContext();

		await runAgentLoop(agent as never, log as never, ctx as never, false);

		expect(mockDisplayLLMText).not.toHaveBeenCalled();
	});

	it('displays gadget calls in interactive mode', async () => {
		const agent = createMockAgent([
			{
				type: 'gadget_call',
				call: { gadgetName: 'ReadFile', invocationId: 'gc_1', parameters: { filePath: '/foo.ts' } },
			},
		]);
		const log = createMockLog();
		const ctx = createTrackingContext();

		await runAgentLoop(agent as never, log as never, ctx as never, true);

		expect(mockDisplayGadgetCall).toHaveBeenCalledWith('ReadFile', { filePath: '/foo.ts' }, false);
	});

	it('waits for enter on non-synthetic gadget call in interactive non-autoAccept mode', async () => {
		mockIsSyntheticCall.mockReturnValue(false);
		const agent = createMockAgent([
			{
				type: 'gadget_call',
				call: { gadgetName: 'WriteFile', invocationId: 'gc_2', parameters: {} },
			},
		]);
		const log = createMockLog();
		const ctx = createTrackingContext();

		await runAgentLoop(agent as never, log as never, ctx as never, true, false);

		expect(mockWaitForEnter).toHaveBeenCalled();
	});

	it('skips waitForEnter for synthetic calls even in interactive mode', async () => {
		mockIsSyntheticCall.mockReturnValue(true);
		const agent = createMockAgent([
			{
				type: 'gadget_call',
				call: { gadgetName: 'ReadFile', invocationId: 'gc_init_1', parameters: {} },
			},
		]);
		const log = createMockLog();
		const ctx = createTrackingContext();

		await runAgentLoop(agent as never, log as never, ctx as never, true, false);

		expect(mockWaitForEnter).not.toHaveBeenCalled();
	});

	it('skips waitForEnter in autoAccept mode', async () => {
		mockIsSyntheticCall.mockReturnValue(false);
		const agent = createMockAgent([
			{
				type: 'gadget_call',
				call: { gadgetName: 'WriteFile', invocationId: 'gc_2', parameters: {} },
			},
		]);
		const log = createMockLog();
		const ctx = createTrackingContext();

		await runAgentLoop(agent as never, log as never, ctx as never, true, true);

		expect(mockWaitForEnter).not.toHaveBeenCalled();
	});

	it('returns gadgetCalls and iterations from tracking context', async () => {
		const ctx = createTrackingContext({ metrics: { llmIterations: 5, gadgetCalls: 12 } });
		const agent = createMockAgent([]);
		const log = createMockLog();

		const result = await runAgentLoop(agent as never, log as never, ctx as never);

		expect(result.iterations).toBe(5);
		expect(result.gadgetCalls).toBe(12);
	});

	it('adds comment to log context when present in parameters', async () => {
		const agent = createMockAgent([
			{
				type: 'gadget_call',
				call: {
					gadgetName: 'Bash',
					invocationId: 'gc_1',
					parameters: { comment: 'Running tests', command: 'npm test' },
				},
			},
		]);
		const log = createMockLog();
		const ctx = createTrackingContext();

		await runAgentLoop(agent as never, log as never, ctx as never);

		expect(log.info).toHaveBeenCalledWith(
			'[Gadget]',
			expect.objectContaining({ comment: 'Running tests' }),
		);
	});

	it('adds path to log context for gadgets with filePath parameter', async () => {
		const agent = createMockAgent([
			{
				type: 'gadget_call',
				call: {
					gadgetName: 'ReadFile',
					invocationId: 'gc_1',
					parameters: { filePath: '/src/foo.ts' },
				},
			},
		]);
		const log = createMockLog();
		const ctx = createTrackingContext();

		await runAgentLoop(agent as never, log as never, ctx as never);

		expect(log.info).toHaveBeenCalledWith(
			'[Gadget]',
			expect.objectContaining({ path: '/src/foo.ts' }),
		);
	});

	it('adds params to log context for Tmux gadget', async () => {
		const agent = createMockAgent([
			{
				type: 'gadget_call',
				call: {
					gadgetName: 'Tmux',
					invocationId: 'gc_1',
					parameters: { session: 'test', command: 'npm test' },
				},
			},
		]);
		const log = createMockLog();
		const ctx = createTrackingContext();

		await runAgentLoop(agent as never, log as never, ctx as never);

		expect(log.info).toHaveBeenCalledWith(
			'[Gadget]',
			expect.objectContaining({ params: { session: 'test', command: 'npm test' } }),
		);
	});

	it('handles empty events gracefully', async () => {
		const agent = createMockAgent([]);
		const log = createMockLog();
		const ctx = createTrackingContext();

		const result = await runAgentLoop(agent as never, log as never, ctx as never);

		expect(result.output).toBe('');
		expect(result.loopTerminated).toBe(false);
	});

	it('adds Sentry breadcrumb on successful gadget result', async () => {
		const agent = createMockAgent([
			{
				type: 'gadget_result',
				result: { gadgetName: 'ReadFile', executionTimeMs: 50, result: 'file contents' },
			},
		]);
		const log = createMockLog();
		const ctx = createTrackingContext();

		await runAgentLoop(agent as never, log as never, ctx as never);

		expect(mockAddBreadcrumb).toHaveBeenCalledWith({
			category: 'gadget',
			message: 'ReadFile ok (50ms)',
			level: 'info',
			data: {
				gadgetName: 'ReadFile',
				executionTimeMs: 50,
				resultPreview: 'file contents',
			},
		});
	});

	it('adds Sentry breadcrumb with error level on gadget error', async () => {
		const agent = createMockAgent([
			{
				type: 'gadget_result',
				result: { gadgetName: 'WriteFile', executionTimeMs: 10, error: 'Permission denied' },
			},
		]);
		const log = createMockLog();
		const ctx = createTrackingContext();

		await runAgentLoop(agent as never, log as never, ctx as never);

		expect(mockAddBreadcrumb).toHaveBeenCalledWith({
			category: 'gadget',
			message: 'WriteFile error (10ms)',
			level: 'error',
			data: {
				gadgetName: 'WriteFile',
				executionTimeMs: 10,
				error: 'Permission denied',
			},
		});
	});
});
