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
 * Context for tracking agent execution metrics.
 */
export interface TrackingContext {
	/** Current metrics */
	metrics: IterationMetrics;
	/** Set of synthetic gadget invocation IDs to exclude from gadget count */
	syntheticInvocationIds: Set<string>;
}

/**
 * Create a new tracking context with zero metrics.
 */
export function createTrackingContext(): TrackingContext {
	return {
		metrics: { llmIterations: 0, gadgetCalls: 0 },
		syntheticInvocationIds: new Set(),
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
