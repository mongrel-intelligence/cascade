/**
 * Iteration and gadget call tracking for agents.
 *
 * IMPORTANT: In CASCADE, an "iteration" is ONE LLM request-response cycle,
 * NOT a gadget call. An iteration may involve multiple gadget calls.
 */

/**
 * Metrics tracked during agent execution.
 */
export interface IterationMetrics {
	/** Number of LLM request-response cycles (the true "iterations") */
	llmIterations: number;
	/** Number of real (non-synthetic) gadget calls */
	gadgetCalls: number;
}

/**
 * Record of a gadget call for loop detection.
 */
export interface GadgetCallRecord {
	gadgetName: string;
	parametersHash: string; // Deterministic hash of parameters
}

/**
 * Action to take when a name-only loop is detected.
 */
export interface LoopAction {
	type: 'warning' | 'hard_stop';
	message: string;
}

/**
 * Thresholds for name-only loop detection (exported for testing).
 */
export const LOOP_THRESHOLDS = {
	WARNING: 3,
	STRONG_WARNING: 4,
	HARD_STOP: 5,
} as const;

/**
 * Loop detection state.
 */
export interface LoopDetectionState {
	/** Gadget calls from previous iteration */
	previousIterationCalls: GadgetCallRecord[];
	/** Gadget calls from current iteration (being built) */
	currentIterationCalls: GadgetCallRecord[];
	/** Number of consecutive iterations with same pattern */
	repeatCount: number;
	/** Details of the repeated pattern for warning message */
	repeatedPattern: string | null;
	/** Pending warning to be injected as user message */
	pendingWarning: string | null;
	/** Number of consecutive iterations with same gadget name pattern (ignoring params) */
	nameOnlyRepeatCount: number;
	/** Pending action from name-only detection */
	pendingAction: LoopAction | null;
}

/**
 * Context for tracking agent execution metrics.
 */
export interface TrackingContext {
	/** Current metrics */
	metrics: IterationMetrics;
	/** Set of synthetic gadget invocation IDs to exclude from gadget count */
	syntheticInvocationIds: Set<string>;
	/** Loop detection state */
	loopDetection: LoopDetectionState;
	/** Agent type for role-aware loop messages */
	agentType?: string;
	/**
	 * Loop advice profile to use for role-aware messages.
	 * When set, takes precedence over the agentType-based lookup.
	 * Derived from `profile.finishHooks.requiresReview`.
	 */
	loopAdviceProfile?: 'review' | 'default';
}

/**
 * Create initial loop detection state.
 */
export function createLoopDetectionState(): LoopDetectionState {
	return {
		previousIterationCalls: [],
		currentIterationCalls: [],
		repeatCount: 1,
		repeatedPattern: null,
		pendingWarning: null,
		nameOnlyRepeatCount: 1,
		pendingAction: null,
	};
}

/**
 * Create a new tracking context with zero metrics.
 */
export function createTrackingContext(
	agentType?: string,
	loopAdviceProfile?: 'review' | 'default',
): TrackingContext {
	return {
		metrics: { llmIterations: 0, gadgetCalls: 0 },
		syntheticInvocationIds: new Set(),
		loopDetection: createLoopDetectionState(),
		agentType,
		loopAdviceProfile,
	};
}

/**
 * Check if a gadget call is synthetic (injected for context).
 */
export function isSyntheticCall(invocationId: string, context: TrackingContext): boolean {
	return context.syntheticInvocationIds.has(invocationId);
}

/**
 * Increment the LLM iteration counter.
 */
export function incrementLLMIteration(context: TrackingContext): void {
	context.metrics.llmIterations++;
}

/**
 * Increment the gadget call counter (only for non-synthetic calls).
 */
export function incrementGadgetCall(context: TrackingContext): void {
	context.metrics.gadgetCalls++;
}

/**
 * Record a synthetic gadget invocation ID to exclude it from metrics.
 */
export function recordSyntheticInvocationId(context: TrackingContext, id: string): void {
	context.syntheticInvocationIds.add(id);
}

// ============================================================================
// Loop Detection
// ============================================================================

/**
 * Create a deterministic hash of parameters for comparison.
 * Sorts keys to ensure consistent ordering.
 */
function hashParameters(params: Record<string, unknown>): string {
	const sortedParams = Object.keys(params)
		.sort()
		.reduce(
			(acc, key) => {
				acc[key] = params[key];
				return acc;
			},
			{} as Record<string, unknown>,
		);
	return JSON.stringify(sortedParams);
}

/**
 * Create a deterministic hash for a set of gadget calls.
 * Sorts by gadget name for order-independence within same iteration.
 */
function createHashForCalls(calls: GadgetCallRecord[]): string {
	const sorted = [...calls].sort((a, b) => a.gadgetName.localeCompare(b.gadgetName));
	return sorted.map((c) => `${c.gadgetName}:${c.parametersHash}`).join('|');
}

/**
 * Create a deterministic hash for a set of gadget calls using only names (ignoring parameters).
 * Used for name-only loop detection.
 */
function createHashForCallsNameOnly(calls: GadgetCallRecord[]): string {
	const sorted = [...calls].sort((a, b) => a.gadgetName.localeCompare(b.gadgetName));
	return sorted.map((c) => c.gadgetName).join('|');
}

/**
 * Format gadget calls for human-readable display in warning messages.
 */
function formatCallsForDisplay(calls: GadgetCallRecord[]): string {
	const counts: Record<string, number> = {};
	for (const call of calls) {
		counts[call.gadgetName] = (counts[call.gadgetName] || 0) + 1;
	}
	return Object.entries(counts)
		.map(([name, count]) => (count > 1 ? `${name} (×${count})` : name))
		.join(', ');
}

/**
 * Record a gadget call for loop detection.
 */
export function recordGadgetCallForLoop(
	context: TrackingContext,
	name: string,
	params: Record<string, unknown>,
): void {
	context.loopDetection.currentIterationCalls.push({
		gadgetName: name,
		parametersHash: hashParameters(params),
	});
}

/**
 * Per-agent advice lines for loop messages.
 * Review agents should submit findings; implementation agents should change strategy.
 */
const LOOP_ADVICE = {
	review: {
		exact:
			'STOP. Submit your review NOW with CreatePRReview. Report issues as findings instead of trying to fix them.',
		warning: 'STOP and call CreatePRReview with your findings immediately.',
		strong: 'Submit your review NOW with CreatePRReview. Report all issues as review findings.',
		hard_stop: 'Session terminated. You should have called CreatePRReview with your findings.',
	},
	default: {
		exact: 'STOP. THINK VERY HARD. TRY A COMPLETELY DIFFERENT APPROACH.',
		warning: 'STOP and try a fundamentally different approach, or delete the failing test.',
		strong: 'DELETE the failing test and move on. Partial coverage is better than no PR.',
		hard_stop: 'Session terminated. Ship what works or delete the failing test.',
	},
} as const;

function getAdvice(
	agentType?: string,
	loopAdviceProfile?: 'review' | 'default',
): (typeof LOOP_ADVICE)[keyof typeof LOOP_ADVICE] {
	const isReview =
		loopAdviceProfile !== undefined ? loopAdviceProfile === 'review' : agentType === 'review';
	return isReview ? LOOP_ADVICE.review : LOOP_ADVICE.default;
}

/**
 * Role-specific context line for name-only loop messages.
 */
function getSemanticContext(isReview: boolean, pattern: string, repeatCount: number): string {
	if (isReview) {
		return `You have repeated the same operation types (${pattern}) ${repeatCount} times with different parameters.\nYou are a REVIEW agent — your job is to submit a review, not fix code.`;
	}
	return `You have repeated the same operation types (${pattern}) ${repeatCount} times with different parameters.\nEach attempt produces a different error, but you are cycling between the same failing strategies.`;
}

/**
 * Generate the loop warning message.
 */
function generateLoopWarning(
	repeatCount: number,
	repeatedPattern: string,
	agentType?: string,
	loopAdviceProfile?: 'review' | 'default',
): string {
	const urgency = repeatCount >= 3 ? '🚨' : '⚠️';
	return `[System] ${urgency} LOOP DETECTED (×${repeatCount})

Pattern: ${repeatedPattern}

${getAdvice(agentType, loopAdviceProfile).exact}`;
}

/**
 * Generate the appropriate action for name-only loop detection based on repeat count.
 */
function generateNameOnlyLoopAction(
	repeatCount: number,
	pattern: string,
	agentType?: string,
	loopAdviceProfile?: 'review' | 'default',
): LoopAction | null {
	const isReview =
		loopAdviceProfile !== undefined ? loopAdviceProfile === 'review' : agentType === 'review';
	const advice = getAdvice(agentType, loopAdviceProfile);

	if (repeatCount >= LOOP_THRESHOLDS.HARD_STOP) {
		return {
			type: 'hard_stop',
			message: `[System] 🛑 SEMANTIC LOOP — FORCED TERMINATION

${getSemanticContext(isReview, pattern, repeatCount)}

${advice.hard_stop}`,
		};
	}
	if (repeatCount >= LOOP_THRESHOLDS.STRONG_WARNING) {
		return {
			type: 'warning',
			message: `[System] 🚨 SEMANTIC LOOP — 1 iteration before forced termination

You are repeating the same operation types (${pattern}) with different parameters — ${repeatCount} times now.
You have ONE more iteration before this session is forcefully terminated.

${advice.strong}`,
		};
	}
	if (repeatCount >= LOOP_THRESHOLDS.WARNING) {
		const context = isReview
			? 'You are a REVIEW agent — you should not be editing code or fixing issues.'
			: "This suggests you're cycling between approaches that don't work.";
		return {
			type: 'warning',
			message: `[System] ⚠️ SEMANTIC LOOP DETECTED (×${repeatCount})

You are repeating the same operation types (${pattern}) with different parameters each time.
${context}

${advice.warning}`,
		};
	}
	return null;
}

/**
 * Check for loop pattern and advance to next iteration.
 * Should be called at the START of each new LLM iteration.
 * Returns true if a loop was detected.
 */
export function checkForLoopAndAdvance(context: TrackingContext): boolean {
	const state = context.loopDetection;

	// If no gadget calls were made in the current iteration, nothing to compare
	// (This handles the first iteration case too)
	if (state.currentIterationCalls.length === 0) {
		// Advance: current becomes previous, reset current
		state.previousIterationCalls = [];
		return false;
	}

	// Compare current with previous
	const prevHash = createHashForCalls(state.previousIterationCalls);
	const currHash = createHashForCalls(state.currentIterationCalls);

	const isLoop = prevHash === currHash && prevHash !== '';

	if (isLoop) {
		state.repeatCount++;
		state.repeatedPattern = formatCallsForDisplay(state.currentIterationCalls);
		// Set pending warning to be injected as user message
		state.pendingWarning = generateLoopWarning(
			state.repeatCount,
			state.repeatedPattern,
			context.agentType,
			context.loopAdviceProfile,
		);
	} else {
		state.repeatCount = 1;
		state.repeatedPattern = null;
		state.pendingWarning = null;
	}

	const exactMatchFired = isLoop && state.repeatCount >= 2;

	// Name-only loop detection (secondary defense — catches same gadget types with different params)
	// Only fire when exact-match detection did NOT already fire
	if (!exactMatchFired) {
		const prevNameHash = createHashForCallsNameOnly(state.previousIterationCalls);
		const currNameHash = createHashForCallsNameOnly(state.currentIterationCalls);
		const isNameOnlyLoop = prevNameHash === currNameHash && prevNameHash !== '';

		if (isNameOnlyLoop) {
			state.nameOnlyRepeatCount++;
			state.pendingAction = generateNameOnlyLoopAction(
				state.nameOnlyRepeatCount,
				formatCallsForDisplay(state.currentIterationCalls),
				context.agentType,
				context.loopAdviceProfile,
			);
		} else {
			state.nameOnlyRepeatCount = 1;
			state.pendingAction = null;
		}
	} else {
		// Reset name-only tracking when exact-match is active
		state.nameOnlyRepeatCount = 1;
		state.pendingAction = null;
	}

	// Advance: current becomes previous, reset current for next iteration
	state.previousIterationCalls = state.currentIterationCalls;
	state.currentIterationCalls = [];

	return exactMatchFired;
}

/**
 * Consume and return any pending loop warning.
 * Returns the warning message and clears it, or null if none.
 */
export function consumeLoopWarning(context: TrackingContext): string | null {
	const warning = context.loopDetection.pendingWarning;
	context.loopDetection.pendingWarning = null;
	return warning;
}

/**
 * Consume and return any pending name-only loop action.
 * Returns the action and clears it, or null if none.
 */
export function consumeLoopAction(context: TrackingContext): LoopAction | null {
	const action = context.loopDetection.pendingAction;
	context.loopDetection.pendingAction = null;
	return action;
}
