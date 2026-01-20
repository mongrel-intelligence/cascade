import { describe, expect, it } from 'vitest';

import {
	checkForLoopAndAdvance,
	consumeLoopWarning,
	createTrackingContext,
	recordGadgetCallForLoop,
} from '../../../../src/agents/utils/tracking.js';

describe('loop detection', () => {
	describe('createTrackingContext', () => {
		it('initializes loop detection state with defaults', () => {
			const ctx = createTrackingContext();

			expect(ctx.loopDetection.previousIterationCalls).toEqual([]);
			expect(ctx.loopDetection.currentIterationCalls).toEqual([]);
			expect(ctx.loopDetection.repeatCount).toBe(1);
			expect(ctx.loopDetection.repeatedPattern).toBeNull();
			expect(ctx.loopDetection.pendingWarning).toBeNull();
		});
	});

	describe('recordGadgetCallForLoop', () => {
		it('records gadget calls to current iteration', () => {
			const ctx = createTrackingContext();

			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/foo.ts' });
			recordGadgetCallForLoop(ctx, 'WriteFile', { filePath: '/bar.ts', content: 'hello' });

			expect(ctx.loopDetection.currentIterationCalls).toHaveLength(2);
			expect(ctx.loopDetection.currentIterationCalls[0].gadgetName).toBe('ReadFile');
			expect(ctx.loopDetection.currentIterationCalls[1].gadgetName).toBe('WriteFile');
		});

		it('creates deterministic parameter hashes', () => {
			const ctx = createTrackingContext();

			// Same parameters in different order should produce same hash
			recordGadgetCallForLoop(ctx, 'Test', { a: 1, b: 2, c: 3 });

			const ctx2 = createTrackingContext();
			recordGadgetCallForLoop(ctx2, 'Test', { c: 3, a: 1, b: 2 });

			expect(ctx.loopDetection.currentIterationCalls[0].parametersHash).toBe(
				ctx2.loopDetection.currentIterationCalls[0].parametersHash,
			);
		});
	});

	describe('checkForLoopAndAdvance', () => {
		it('returns false on first iteration (no previous calls)', () => {
			const ctx = createTrackingContext();

			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/foo.ts' });
			const loopDetected = checkForLoopAndAdvance(ctx);

			expect(loopDetected).toBe(false);
			expect(ctx.loopDetection.repeatCount).toBe(1);
		});

		it('returns false when patterns differ', () => {
			const ctx = createTrackingContext();

			// Iteration 1
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/foo.ts' });
			checkForLoopAndAdvance(ctx);

			// Iteration 2 - different pattern
			recordGadgetCallForLoop(ctx, 'WriteFile', { filePath: '/bar.ts' });
			const loopDetected = checkForLoopAndAdvance(ctx);

			expect(loopDetected).toBe(false);
			expect(ctx.loopDetection.repeatCount).toBe(1);
		});

		it('detects repeated gadget patterns', () => {
			const ctx = createTrackingContext();

			// Iteration 1
			recordGadgetCallForLoop(ctx, 'FileSearchAndReplace', { filePath: '/foo.ts', search: 'x' });
			checkForLoopAndAdvance(ctx);

			// Iteration 2 - same pattern
			recordGadgetCallForLoop(ctx, 'FileSearchAndReplace', { filePath: '/foo.ts', search: 'x' });
			const loopDetected = checkForLoopAndAdvance(ctx);

			expect(loopDetected).toBe(true);
			expect(ctx.loopDetection.repeatCount).toBe(2);
			expect(ctx.loopDetection.repeatedPattern).toBe('FileSearchAndReplace');
		});

		it('detects loops with multiple gadgets', () => {
			const ctx = createTrackingContext();

			// Iteration 1
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/foo.ts' });
			recordGadgetCallForLoop(ctx, 'FileSearchAndReplace', { filePath: '/foo.ts', search: 'x' });
			checkForLoopAndAdvance(ctx);

			// Iteration 2 - same pattern
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/foo.ts' });
			recordGadgetCallForLoop(ctx, 'FileSearchAndReplace', { filePath: '/foo.ts', search: 'x' });
			const loopDetected = checkForLoopAndAdvance(ctx);

			expect(loopDetected).toBe(true);
			expect(ctx.loopDetection.repeatCount).toBe(2);
			expect(ctx.loopDetection.repeatedPattern).toContain('ReadFile');
			expect(ctx.loopDetection.repeatedPattern).toContain('FileSearchAndReplace');
		});

		it('increments repeat count on continued loops', () => {
			const ctx = createTrackingContext();

			// Iteration 1
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/foo.ts' });
			checkForLoopAndAdvance(ctx);

			// Iteration 2 - same
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/foo.ts' });
			checkForLoopAndAdvance(ctx);
			expect(ctx.loopDetection.repeatCount).toBe(2);

			// Iteration 3 - same again
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/foo.ts' });
			checkForLoopAndAdvance(ctx);
			expect(ctx.loopDetection.repeatCount).toBe(3);

			// Iteration 4 - same again
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/foo.ts' });
			checkForLoopAndAdvance(ctx);
			expect(ctx.loopDetection.repeatCount).toBe(4);
		});

		it('resets count when pattern changes', () => {
			const ctx = createTrackingContext();

			// Iteration 1
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/foo.ts' });
			checkForLoopAndAdvance(ctx);

			// Iteration 2 - same (loop detected)
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/foo.ts' });
			checkForLoopAndAdvance(ctx);
			expect(ctx.loopDetection.repeatCount).toBe(2);

			// Iteration 3 - different pattern
			recordGadgetCallForLoop(ctx, 'WriteFile', { filePath: '/bar.ts' });
			checkForLoopAndAdvance(ctx);
			expect(ctx.loopDetection.repeatCount).toBe(1);
		});

		it('handles empty iterations (no gadget calls)', () => {
			const ctx = createTrackingContext();

			// Iteration 1 - has calls
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/foo.ts' });
			checkForLoopAndAdvance(ctx);

			// Iteration 2 - no calls (e.g., text-only response)
			const loopDetected = checkForLoopAndAdvance(ctx);

			expect(loopDetected).toBe(false);
			expect(ctx.loopDetection.repeatCount).toBe(1);
		});

		it('sets pending warning on loop detection', () => {
			const ctx = createTrackingContext();

			// Iteration 1
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/foo.ts' });
			checkForLoopAndAdvance(ctx);

			// Iteration 2 - same pattern
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/foo.ts' });
			checkForLoopAndAdvance(ctx);

			expect(ctx.loopDetection.pendingWarning).not.toBeNull();
			expect(ctx.loopDetection.pendingWarning).toContain('LOOP DETECTED');
			expect(ctx.loopDetection.pendingWarning).toContain('ReadFile');
		});

		it('clears pending warning when pattern changes', () => {
			const ctx = createTrackingContext();

			// Create a loop
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/foo.ts' });
			checkForLoopAndAdvance(ctx);
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/foo.ts' });
			checkForLoopAndAdvance(ctx);
			expect(ctx.loopDetection.pendingWarning).not.toBeNull();

			// Break the loop
			recordGadgetCallForLoop(ctx, 'WriteFile', { filePath: '/bar.ts' });
			checkForLoopAndAdvance(ctx);
			expect(ctx.loopDetection.pendingWarning).toBeNull();
		});

		it('is order-independent within an iteration', () => {
			const ctx1 = createTrackingContext();
			const ctx2 = createTrackingContext();

			// Context 1: calls in order A, B
			recordGadgetCallForLoop(ctx1, 'ReadFile', { filePath: '/a.ts' });
			recordGadgetCallForLoop(ctx1, 'ReadFile', { filePath: '/b.ts' });
			checkForLoopAndAdvance(ctx1);
			recordGadgetCallForLoop(ctx1, 'ReadFile', { filePath: '/a.ts' });
			recordGadgetCallForLoop(ctx1, 'ReadFile', { filePath: '/b.ts' });

			// Context 2: calls in order B, A
			recordGadgetCallForLoop(ctx2, 'ReadFile', { filePath: '/b.ts' });
			recordGadgetCallForLoop(ctx2, 'ReadFile', { filePath: '/a.ts' });
			checkForLoopAndAdvance(ctx2);
			recordGadgetCallForLoop(ctx2, 'ReadFile', { filePath: '/b.ts' });
			recordGadgetCallForLoop(ctx2, 'ReadFile', { filePath: '/a.ts' });

			const loop1 = checkForLoopAndAdvance(ctx1);
			const loop2 = checkForLoopAndAdvance(ctx2);

			// Both should detect loops
			expect(loop1).toBe(true);
			expect(loop2).toBe(true);
		});
	});

	describe('consumeLoopWarning', () => {
		it('returns null when no warning is pending', () => {
			const ctx = createTrackingContext();
			expect(consumeLoopWarning(ctx)).toBeNull();
		});

		it('returns and clears the pending warning', () => {
			const ctx = createTrackingContext();

			// Create a loop to trigger warning
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/foo.ts' });
			checkForLoopAndAdvance(ctx);
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/foo.ts' });
			checkForLoopAndAdvance(ctx);

			const warning = consumeLoopWarning(ctx);
			expect(warning).not.toBeNull();
			expect(warning).toContain('LOOP DETECTED');

			// Second call should return null (warning was consumed)
			expect(consumeLoopWarning(ctx)).toBeNull();
		});
	});

	describe('warning message format', () => {
		it('includes repeat count in warning', () => {
			const ctx = createTrackingContext();

			// Create a loop with 3 repeats
			for (let i = 0; i < 3; i++) {
				recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/foo.ts' });
				checkForLoopAndAdvance(ctx);
			}

			const warning = consumeLoopWarning(ctx);
			expect(warning).toContain('3');
		});

		it('includes pattern description in warning', () => {
			const ctx = createTrackingContext();

			recordGadgetCallForLoop(ctx, 'FileSearchAndReplace', { filePath: '/foo.ts' });
			checkForLoopAndAdvance(ctx);
			recordGadgetCallForLoop(ctx, 'FileSearchAndReplace', { filePath: '/foo.ts' });
			checkForLoopAndAdvance(ctx);

			const warning = consumeLoopWarning(ctx);
			expect(warning).toContain('FileSearchAndReplace');
		});

		it('shows count for repeated gadgets in pattern', () => {
			const ctx = createTrackingContext();

			// Multiple calls of same gadget in one iteration
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/a.ts' });
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/b.ts' });
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/c.ts' });
			checkForLoopAndAdvance(ctx);

			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/a.ts' });
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/b.ts' });
			recordGadgetCallForLoop(ctx, 'ReadFile', { filePath: '/c.ts' });
			checkForLoopAndAdvance(ctx);

			expect(ctx.loopDetection.repeatedPattern).toContain('ReadFile');
			expect(ctx.loopDetection.repeatedPattern).toContain('3'); // shows count
		});
	});
});
