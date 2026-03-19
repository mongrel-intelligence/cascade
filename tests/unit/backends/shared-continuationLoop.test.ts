import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
	type ContinuationTurnContext,
	decideContinuation,
	runContinuationLoop,
} from '../../../src/backends/shared/continuationLoop.js';
import type { AgentEngineResult } from '../../../src/backends/types.js';

function makeSuccessResult(overrides: Partial<AgentEngineResult> = {}): AgentEngineResult {
	return {
		success: true,
		output: 'Done.',
		cost: 0.05,
		...overrides,
	};
}

function makeFailureResult(overrides: Partial<AgentEngineResult> = {}): AgentEngineResult {
	return {
		success: false,
		output: '',
		error: 'Something went wrong',
		cost: 0.02,
		...overrides,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// decideContinuation
// ─────────────────────────────────────────────────────────────────────────────

describe('decideContinuation', () => {
	it('returns done:true when no completionRequirements are provided', () => {
		const logWriter = vi.fn();
		const result = makeSuccessResult({ cost: 0.1 });
		const decision = decideContinuation(result, undefined, 0, 2, 0.1, logWriter, 3, 'TestEngine');
		expect(decision.done).toBe(true);
		if (decision.done) {
			expect(decision.result.cost).toBe(0.1);
		}
		expect(logWriter).not.toHaveBeenCalled();
	});

	it('returns done:true when completion requirements are satisfied', () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'continuation-test-'));
		const prSidecarPath = join(tempDir, 'pr.json');
		writeFileSync(prSidecarPath, JSON.stringify({ prUrl: 'https://github.com/owner/repo/pull/1' }));

		const logWriter = vi.fn();
		const result = makeSuccessResult({ cost: 0.05 });
		const decision = decideContinuation(
			result,
			{ requiresPR: true, prSidecarPath },
			0,
			2,
			0.05,
			logWriter,
			5,
			'TestEngine',
		);
		rmSync(tempDir, { recursive: true, force: true });

		expect(decision.done).toBe(true);
		if (decision.done) {
			expect(decision.result.cost).toBe(0.05);
		}
		expect(logWriter).not.toHaveBeenCalled();
	});

	it('returns done:false with continuation prompt when requirements not satisfied', () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'continuation-test-'));
		const prSidecarPath = join(tempDir, 'pr.json');
		// No sidecar file written — PR requirement not satisfied

		const logWriter = vi.fn();
		const result = makeSuccessResult();
		const decision = decideContinuation(
			result,
			{ requiresPR: true, prSidecarPath, maxContinuationTurns: 3 },
			0,
			3,
			0.05,
			logWriter,
			2,
			'TestEngine',
		);
		rmSync(tempDir, { recursive: true, force: true });

		expect(decision.done).toBe(false);
		if (!decision.done) {
			expect(decision.promptText).toContain('completion check failed');
		}
		expect(logWriter).toHaveBeenCalledWith(
			'WARN',
			'TestEngine completion check failed; continuing session',
			expect.objectContaining({
				reason: 'Agent completed but no authoritative PR creation was recorded',
				continuationTurn: 1,
				maxContinuationTurns: 3,
				toolCallCount: 2,
			}),
		);
	});

	it('returns done:true with failure when max turns exhausted', () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'continuation-test-'));
		const prSidecarPath = join(tempDir, 'pr.json');
		// No sidecar file written

		const logWriter = vi.fn();
		const result = makeSuccessResult({ cost: 0.1 });
		const decision = decideContinuation(
			result,
			{ requiresPR: true, prSidecarPath, maxContinuationTurns: 2 },
			2, // continuationTurns >= maxContinuationTurns
			2,
			0.25,
			logWriter,
			5,
			'TestEngine',
		);
		rmSync(tempDir, { recursive: true, force: true });

		expect(decision.done).toBe(true);
		if (decision.done) {
			expect(decision.result.success).toBe(false);
			expect(decision.result.error).toBe(
				'Agent completed but no authoritative PR creation was recorded',
			);
			expect(decision.result.cost).toBe(0.25);
		}
		expect(logWriter).not.toHaveBeenCalled();
	});

	it('uses engine label in warning log message', () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'continuation-label-test-'));
		const prSidecarPath = join(tempDir, 'pr.json');
		const logWriter = vi.fn();

		decideContinuation(
			makeSuccessResult(),
			{ requiresPR: true, prSidecarPath, maxContinuationTurns: 2 },
			0,
			2,
			0.05,
			logWriter,
			1,
			'Claude Code',
		);
		rmSync(tempDir, { recursive: true, force: true });

		expect(logWriter).toHaveBeenCalledWith(
			'WARN',
			'Claude Code completion check failed; continuing session',
			expect.any(Object),
		);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// runContinuationLoop
// ─────────────────────────────────────────────────────────────────────────────

describe('runContinuationLoop', () => {
	it('returns success on first try when requirements are already satisfied', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'loop-test-'));
		const prSidecarPath = join(tempDir, 'pr.json');
		writeFileSync(
			prSidecarPath,
			JSON.stringify({
				prUrl: 'https://github.com/owner/repo/pull/42',
				source: 'cascade-tools scm create-pr',
			}),
		);

		const executeTurn = vi.fn().mockResolvedValue({
			result: makeSuccessResult({ cost: 0.05 }),
			toolCallCount: 3,
		});

		const result = await runContinuationLoop({
			initialPrompt: 'Implement the feature.',
			completionRequirements: { requiresPR: true, prSidecarPath, maxContinuationTurns: 2 },
			logWriter: vi.fn(),
			engineLabel: 'TestEngine',
			executeTurn,
		});
		rmSync(tempDir, { recursive: true, force: true });

		expect(result.success).toBe(true);
		expect(result.prUrl).toBe('https://github.com/owner/repo/pull/42');
		expect(result.prEvidence?.source).toBe('native-tool-sidecar');
		expect(result.prEvidence?.authoritative).toBe(true);
		expect(executeTurn).toHaveBeenCalledTimes(1);
		expect(executeTurn).toHaveBeenCalledWith<[ContinuationTurnContext]>({
			promptText: 'Implement the feature.',
			isContinuation: false,
		});
	});

	it('retries when completion check fails, succeeds on second turn', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'loop-retry-test-'));
		const prSidecarPath = join(tempDir, 'pr.json');
		const logWriter = vi.fn();

		let turnCount = 0;
		const executeTurn = vi.fn().mockImplementation(async () => {
			turnCount++;
			// Write sidecar on the second turn
			if (turnCount === 2) {
				writeFileSync(
					prSidecarPath,
					JSON.stringify({
						prUrl: 'https://github.com/owner/repo/pull/99',
						source: 'cascade-tools scm create-pr',
					}),
				);
			}
			return {
				result: makeSuccessResult({ cost: turnCount === 1 ? 0.1 : 0.05 }),
				toolCallCount: 2,
			};
		});

		const result = await runContinuationLoop({
			initialPrompt: 'Implement the feature.',
			completionRequirements: {
				requiresPR: true,
				prSidecarPath,
				maxContinuationTurns: 2,
			},
			logWriter,
			engineLabel: 'TestEngine',
			executeTurn,
		});
		rmSync(tempDir, { recursive: true, force: true });

		expect(result.success).toBe(true);
		expect(result.prUrl).toBe('https://github.com/owner/repo/pull/99');
		expect(executeTurn).toHaveBeenCalledTimes(2);
		// First call: initial prompt, not a continuation
		expect(executeTurn.mock.calls[0][0]).toEqual({
			promptText: 'Implement the feature.',
			isContinuation: false,
		});
		// Second call: continuation prompt
		expect(executeTurn.mock.calls[1][0]).toEqual(expect.objectContaining({ isContinuation: true }));
		expect(logWriter).toHaveBeenCalledWith(
			'WARN',
			'TestEngine completion check failed; continuing session',
			expect.objectContaining({
				reason: 'Agent completed but no authoritative PR creation was recorded',
				continuationTurn: 1,
				maxContinuationTurns: 2,
			}),
		);
	});

	it('fails after exhausting max continuation turns', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'loop-exhaust-test-'));
		const prSidecarPath = join(tempDir, 'pr.json');
		// Never write the sidecar

		const executeTurn = vi.fn().mockResolvedValue({
			result: makeSuccessResult({ cost: 0.05 }),
			toolCallCount: 1,
		});

		const result = await runContinuationLoop({
			initialPrompt: 'Implement the feature.',
			completionRequirements: {
				requiresPR: true,
				prSidecarPath,
				maxContinuationTurns: 2,
			},
			logWriter: vi.fn(),
			engineLabel: 'TestEngine',
			executeTurn,
		});
		rmSync(tempDir, { recursive: true, force: true });

		expect(result.success).toBe(false);
		expect(result.error).toBe('Agent completed but no authoritative PR creation was recorded');
		// Initial + 2 continuation = 3 total calls
		expect(executeTurn).toHaveBeenCalledTimes(3);
	});

	it('does not continue on non-success turn result', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'loop-fail-test-'));
		const prSidecarPath = join(tempDir, 'pr.json');

		const executeTurn = vi.fn().mockResolvedValue({
			result: makeFailureResult({ error: 'Engine error' }),
			toolCallCount: 0,
		});

		const result = await runContinuationLoop({
			initialPrompt: 'Implement the feature.',
			completionRequirements: {
				requiresPR: true,
				prSidecarPath,
				maxContinuationTurns: 2,
			},
			logWriter: vi.fn(),
			engineLabel: 'TestEngine',
			executeTurn,
		});
		rmSync(tempDir, { recursive: true, force: true });

		expect(result.success).toBe(false);
		expect(result.error).toBe('Engine error');
		// Should NOT have retried
		expect(executeTurn).toHaveBeenCalledTimes(1);
	});

	it('accumulates cost across continuation turns', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'loop-cost-test-'));
		const prSidecarPath = join(tempDir, 'pr.json');

		let turnCount = 0;
		const executeTurn = vi.fn().mockImplementation(async () => {
			turnCount++;
			if (turnCount === 2) {
				writeFileSync(
					prSidecarPath,
					JSON.stringify({ prUrl: 'https://github.com/owner/repo/pull/1' }),
				);
			}
			return {
				result: makeSuccessResult({ cost: 0.1 }),
				toolCallCount: 1,
			};
		});

		const result = await runContinuationLoop({
			initialPrompt: 'Do work.',
			completionRequirements: {
				requiresPR: true,
				prSidecarPath,
				maxContinuationTurns: 2,
			},
			logWriter: vi.fn(),
			engineLabel: 'TestEngine',
			executeTurn,
		});
		rmSync(tempDir, { recursive: true, force: true });

		expect(result.success).toBe(true);
		expect(result.cost).toBeCloseTo(0.2); // 0.1 + 0.1
		expect(executeTurn).toHaveBeenCalledTimes(2);
	});

	it('accumulates cost even when non-success result terminates loop', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'loop-cost-fail-'));
		const prSidecarPath = join(tempDir, 'pr.json');

		const executeTurn = vi.fn().mockResolvedValue({
			result: makeFailureResult({ cost: 0.07 }),
			toolCallCount: 0,
		});

		const result = await runContinuationLoop({
			initialPrompt: 'Do work.',
			completionRequirements: { requiresPR: true, prSidecarPath },
			logWriter: vi.fn(),
			engineLabel: 'TestEngine',
			executeTurn,
		});
		rmSync(tempDir, { recursive: true, force: true });

		expect(result.success).toBe(false);
		expect(result.cost).toBeCloseTo(0.07);
	});

	it('works without completionRequirements (single-turn pass-through)', async () => {
		const executeTurn = vi.fn().mockResolvedValue({
			result: makeSuccessResult({ cost: 0.03 }),
			toolCallCount: 5,
		});

		const result = await runContinuationLoop({
			initialPrompt: 'Just do it.',
			completionRequirements: undefined,
			logWriter: vi.fn(),
			engineLabel: 'TestEngine',
			executeTurn,
		});

		expect(result.success).toBe(true);
		expect(result.cost).toBeCloseTo(0.03);
		expect(executeTurn).toHaveBeenCalledTimes(1);
	});

	it('passes the continuation prompt text on subsequent turns', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'loop-prompt-test-'));
		const prSidecarPath = join(tempDir, 'pr.json');
		const capturedContexts: ContinuationTurnContext[] = [];

		let turnCount = 0;
		const executeTurn = vi.fn().mockImplementation(async (ctx: ContinuationTurnContext) => {
			capturedContexts.push({ ...ctx });
			turnCount++;
			if (turnCount === 2) {
				writeFileSync(
					prSidecarPath,
					JSON.stringify({ prUrl: 'https://github.com/owner/repo/pull/5' }),
				);
			}
			return {
				result: makeSuccessResult({ cost: 0.05 }),
				toolCallCount: 1,
			};
		});

		await runContinuationLoop({
			initialPrompt: 'Initial task',
			completionRequirements: {
				requiresPR: true,
				prSidecarPath,
				maxContinuationTurns: 2,
			},
			logWriter: vi.fn(),
			engineLabel: 'TestEngine',
			executeTurn,
		});
		rmSync(tempDir, { recursive: true, force: true });

		expect(capturedContexts).toHaveLength(2);
		expect(capturedContexts[0].promptText).toBe('Initial task');
		expect(capturedContexts[0].isContinuation).toBe(false);
		expect(capturedContexts[1].promptText).toContain('completion check failed');
		expect(capturedContexts[1].isContinuation).toBe(true);
	});
});
