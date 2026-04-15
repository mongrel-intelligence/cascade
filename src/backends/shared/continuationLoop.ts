/**
 * Shared continuation loop for agent engine backends.
 *
 * Extracts the common for(;;) loop pattern shared by Claude Code and OpenCode engines:
 * - Execute a turn using the engine-specific callback
 * - Apply completion evidence from sidecar files
 * - Check for completion failures
 * - Decide whether to continue with a follow-up prompt or return the final result
 * - Accumulate cost across continuation turns
 *
 * This module orchestrates `applyCompletionEvidence()`, `getCompletionFailure()`, and
 * `readCompletionEvidence()` from `../completion.ts`.
 */

import {
	type CompletionRequirements,
	applyCompletionEvidence,
	getCompletionFailure,
	readCompletionEvidence,
} from '../completion.js';
import type { AgentEngineResult, LogWriter } from '../types.js';

export type ContinuationDecision =
	| { done: true; result: AgentEngineResult }
	| { done: false; promptText: string };

/**
 * Check completion requirements and decide whether to continue or return a final result.
 * Logs the continuation warning when a new turn is needed.
 *
 * Extracted from claude-code/index.ts so both Claude Code and OpenCode can share
 * the same decision logic.
 */
export function decideContinuation(
	result: AgentEngineResult,
	completionRequirements: CompletionRequirements | undefined,
	continuationTurns: number,
	maxContinuationTurns: number,
	totalCost: number | undefined,
	logWriter: LogWriter,
	toolCallCount: number,
	engineLabel: string,
): ContinuationDecision {
	const completionFailure = getCompletionFailure(
		completionRequirements,
		readCompletionEvidence(completionRequirements),
	);
	if (!completionFailure) {
		return { done: true, result: { ...result, cost: totalCost } };
	}
	if (continuationTurns >= maxContinuationTurns) {
		return {
			done: true,
			result: { ...result, success: false, error: completionFailure.error, cost: totalCost },
		};
	}
	logWriter('WARN', `${engineLabel} completion check failed; continuing session`, {
		reason: completionFailure.error,
		continuationTurn: continuationTurns + 1,
		maxContinuationTurns,
		toolCallCount,
	});
	return { done: false, promptText: completionFailure.continuationPrompt };
}

/**
 * Parameters for a single turn execution within the continuation loop.
 */
export interface ContinuationTurnContext {
	/** The text prompt to send for this turn (either the initial task prompt or a continuation prompt) */
	promptText: string;
	/** Whether this is a continuation turn (true) or the initial turn (false) */
	isContinuation: boolean;
}

/**
 * Result returned by the engine-specific turn executor.
 */
export interface TurnExecutorResult {
	/** The raw engine result from this turn */
	result: AgentEngineResult;
	/** Number of tool calls made during this turn */
	toolCallCount: number;
}

/**
 * Engine-specific turn execution function type.
 * Each engine provides its own implementation of how to run a single turn.
 */
export type TurnExecutor = (context: ContinuationTurnContext) => Promise<TurnExecutorResult>;

/**
 * Options for the shared continuation loop.
 */
export interface RunContinuationLoopOptions {
	/** The initial prompt text for the first turn */
	initialPrompt: string;
	/** Completion requirements to check after each turn */
	completionRequirements: CompletionRequirements | undefined;
	/** Log writer for continuation warnings */
	logWriter: LogWriter;
	/** Label used in log messages to identify the engine (e.g. "Claude Code", "OpenCode") */
	engineLabel: string;
	/** Engine-specific turn executor callback */
	executeTurn: TurnExecutor;
}

/**
 * Run a generic continuation loop that handles completion checking and cost accumulation.
 *
 * Both Claude Code and OpenCode follow the same pattern:
 * 1. Execute a turn via the engine-specific callback
 * 2. Apply completion evidence from sidecar files
 * 3. If the turn failed (non-success), return immediately
 * 4. Check completion requirements; if satisfied, return the result
 * 5. If not satisfied and continuation turns remain, re-prompt with the continuation message
 * 6. If continuation turns are exhausted, return failure
 *
 * Cost is accumulated across all continuation turns and set on the final result.
 *
 * @example
 * return runContinuationLoop({
 *   initialPrompt: taskPrompt,
 *   completionRequirements: input.completionRequirements,
 *   logWriter: input.logWriter,
 *   engineLabel: 'Claude Code',
 *   executeTurn: async ({ promptText, isContinuation }) => {
 *     const rawResult = await callEngineOnce(promptText, isContinuation);
 *     return { result: rawResult, toolCallCount: rawResult.toolCallCount };
 *   },
 * });
 */
export async function runContinuationLoop(
	options: RunContinuationLoopOptions,
): Promise<AgentEngineResult> {
	const { initialPrompt, completionRequirements, logWriter, engineLabel, executeTurn } = options;
	const maxContinuationTurns = completionRequirements?.maxContinuationTurns ?? 0;
	let continuationTurns = 0;
	let promptText = initialPrompt;
	let isContinuation = false;
	let totalCost: number | undefined;

	for (;;) {
		const { result: rawTurnResult, toolCallCount } = await executeTurn({
			promptText,
			isContinuation,
		});

		// Accumulate cost across continuation turns
		if (rawTurnResult.cost !== undefined) {
			totalCost = (totalCost ?? 0) + rawTurnResult.cost;
		}

		const result = applyCompletionEvidence(rawTurnResult, completionRequirements);

		// Don't continue on non-success results
		if (!result.success) {
			return { ...result, cost: totalCost };
		}

		const decision = decideContinuation(
			result,
			completionRequirements,
			continuationTurns,
			maxContinuationTurns,
			totalCost,
			logWriter,
			toolCallCount,
			engineLabel,
		);
		if (decision.done) return decision.result;

		continuationTurns++;
		promptText = decision.promptText;
		isContinuation = true;
	}
}
