/**
 * Shared agent event loop with interactive mode support.
 *
 * This module centralizes the event processing logic used by all CASCADE agents.
 * Interactive mode handling lives here, making it easy to extend and customize.
 */
import { consumePendingSessionNotices } from '../../gadgets/tmux.js';
import { addBreadcrumb } from '../../sentry.js';
import {
	displayGadgetCall,
	displayGadgetResult,
	displayLLMText,
	waitForEnter,
} from '../../utils/interactive.js';
import type { createAgentLogger } from './logging.js';
import {
	consumeLoopAction,
	consumeLoopWarning,
	incrementGadgetCall,
	isSyntheticCall,
	recordGadgetCallForLoop,
	type TrackingContext,
} from './tracking.js';

// ============================================================================
// Types
// ============================================================================

export interface AgentRunResult {
	output: string;
	iterations: number; // LLM request cycles
	gadgetCalls: number; // Non-synthetic gadget calls
	cost: number;
	loopTerminated?: boolean;
}

interface GadgetCallEvent {
	gadgetName: string;
	invocationId: string;
	parameters?: Record<string, unknown>;
}

interface GadgetResultEvent {
	gadgetName: string;
	executionTimeMs: number;
	error?: string;
	result?: string;
}

interface StreamEvent {
	type: string;
	content?: string;
	call?: GadgetCallEvent;
	result?: GadgetResultEvent;
}

/** Minimal agent interface for the loop - works with any llmist agent. */
interface RunnableAgent {
	run(): AsyncIterable<StreamEvent>;
	getTree(): { getTotalCost(): number } | null;
	injectUserMessage(message: string): void;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Truncate content to first half + last half chars if it exceeds maxLen.
 */
export function truncateContent(content: string, maxLen = 400): string {
	if (content.length <= maxLen) return content;
	const halfLen = maxLen / 2;
	return `${content.slice(0, halfLen)}...[${content.length - maxLen} truncated]...${content.slice(-halfLen)}`;
}

/**
 * Add gadget-specific fields to log context for better observability.
 */
function addGadgetSpecificLogContext(
	logContext: Record<string, unknown>,
	gadgetName: string,
	parameters: Record<string, unknown> | undefined,
): void {
	if (!parameters) return;

	if (gadgetName === 'Tmux') {
		logContext.params = parameters;
		return;
	}

	if (parameters.filePath) {
		logContext.path = parameters.filePath;
	}

	if (gadgetName === 'WriteFile' && parameters.content) {
		logContext.content = truncateContent(String(parameters.content));
	}

	if (gadgetName === 'TodoUpsert') {
		if (parameters.id) logContext.id = parameters.id;
		if (parameters.content) logContext.todo = truncateContent(String(parameters.content), 80);
	}

	if (gadgetName === 'TodoUpdateStatus') {
		logContext.id = parameters.id;
		logContext.status = parameters.status;
	}
}

// ============================================================================
// Session Completion Injection
// ============================================================================

/**
 * Check for tmux session completions and inject as user messages.
 * Called during agent loop to notify the agent when sessions complete.
 */
function injectSessionCompletionNotices(agent: RunnableAgent): void {
	const notices = consumePendingSessionNotices();
	for (const [session, notice] of notices) {
		const message =
			`[System] Tmux session '${session}' completed with exit code ${notice.exitCode}.\n\n` +
			`Last 100 lines of output:\n\`\`\`\n${notice.tailOutput}\n\`\`\``;
		agent.injectUserMessage(message);
	}
}

/**
 * Check for pending loop warnings and inject as user messages.
 * Called during agent loop to warn the agent about detected loops.
 * Returns 'hard_stop' if the agent should be terminated.
 */
function injectLoopWarnings(
	agent: RunnableAgent,
	trackingContext: TrackingContext,
	log: ReturnType<typeof createAgentLogger>,
): 'hard_stop' | undefined {
	// Exact-match loop warnings
	const warning = consumeLoopWarning(trackingContext);
	if (warning) {
		log.warn('[Loop Warning Injected]', {
			repeatCount: trackingContext.loopDetection.repeatCount,
		});
		agent.injectUserMessage(warning);
	}

	// Name-only loop actions (secondary defense)
	const action = consumeLoopAction(trackingContext);
	if (action) {
		log.warn('[Name-Only Loop Action]', {
			type: action.type,
			nameOnlyRepeatCount: trackingContext.loopDetection.nameOnlyRepeatCount,
		});
		agent.injectUserMessage(action.message);
		if (action.type === 'hard_stop') {
			return 'hard_stop';
		}
	}
	return undefined;
}

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle gadget_call event: display in interactive mode, log, track metrics.
 */
async function handleGadgetCallEvent(
	event: GadgetCallEvent,
	log: ReturnType<typeof createAgentLogger>,
	trackingContext: TrackingContext,
	interactive: boolean,
	autoAccept: boolean,
): Promise<void> {
	const { gadgetName, invocationId, parameters } = event;
	const isSynthetic = isSyntheticCall(invocationId, trackingContext);

	if (!isSynthetic) {
		incrementGadgetCall(trackingContext);
		// Record for loop detection
		recordGadgetCallForLoop(trackingContext, gadgetName, parameters ?? {});
	}

	if (interactive) {
		displayGadgetCall(gadgetName, parameters ?? {}, isSynthetic);
		if (!isSynthetic && !autoAccept) {
			await waitForEnter();
		}
	}

	const logContext: Record<string, unknown> = {
		iteration: trackingContext.metrics.llmIterations,
		gadget: trackingContext.metrics.gadgetCalls,
		name: gadgetName,
		invocationId,
	};

	if (isSynthetic) {
		logContext.isSynthetic = true;
	}

	// Include the comment field (unabbreviated) for observability
	if (parameters?.comment) {
		logContext.comment = parameters.comment;
	}

	addGadgetSpecificLogContext(logContext, gadgetName, parameters);
	log.info('[Gadget]', logContext);
}

/**
 * Handle gadget_result event: display in interactive mode, log result/error.
 */
function handleGadgetResultEvent(
	event: GadgetResultEvent,
	log: ReturnType<typeof createAgentLogger>,
	interactive: boolean,
): void {
	const { gadgetName, executionTimeMs, error, result } = event;

	if (interactive) {
		displayGadgetResult(gadgetName, result, error, executionTimeMs);
	}

	const logContext: Record<string, unknown> = {
		name: gadgetName,
		ms: executionTimeMs,
		error,
	};

	if ((gadgetName === 'Tmux' || gadgetName === 'ReadFile') && result) {
		logContext.output = truncateContent(result);
	}

	log[error ? 'error' : 'info']('[Gadget result]', logContext);

	addBreadcrumb({
		category: 'gadget',
		message: `${gadgetName} ${error ? 'error' : 'ok'} (${executionTimeMs}ms)`,
		level: error ? 'error' : 'info',
		data: {
			gadgetName,
			executionTimeMs,
			...(error ? { error } : {}),
			...(result ? { resultPreview: result.slice(0, 200) } : {}),
		},
	});
}

// ============================================================================
// Main Loop
// ============================================================================

/**
 * Handle a single stream event from the agent.
 */
async function handleStreamEvent(
	event: StreamEvent,
	outputLines: string[],
	log: ReturnType<typeof createAgentLogger>,
	trackingContext: TrackingContext,
	interactive: boolean,
	autoAccept: boolean,
): Promise<void> {
	switch (event.type) {
		case 'text':
			log.debug('[Text]', { content: event.content?.slice(0, 100) });
			if (event.content) {
				outputLines.push(event.content);
				if (interactive) {
					displayLLMText(event.content);
				}
			}
			break;
		case 'gadget_call':
			if (event.call) {
				await handleGadgetCallEvent(event.call, log, trackingContext, interactive, autoAccept);
			}
			break;
		case 'gadget_result':
			if (event.result) {
				handleGadgetResultEvent(event.result, log, interactive);
			}
			break;
		case 'stream_complete':
			log.info('Stream complete', {
				iterations: trackingContext.metrics.llmIterations,
				gadgetCalls: trackingContext.metrics.gadgetCalls,
			});
			break;
	}
}

/**
 * Run the agent event loop, processing all stream events.
 *
 * This is the shared loop used by all CASCADE agents. Interactive mode
 * handling is centralized here.
 *
 * @param agent - The llmist agent to run
 * @param log - Agent logger for structured logging
 * @param trackingContext - Metrics tracking context
 * @param interactive - Whether to display gadget calls and wait for user input
 * @param autoAccept - Whether to skip waiting for Enter (auto-accept prompts)
 */
export async function runAgentLoop(
	agent: RunnableAgent,
	log: ReturnType<typeof createAgentLogger>,
	trackingContext: TrackingContext,
	interactive = false,
	autoAccept = false,
): Promise<AgentRunResult> {
	const outputLines: string[] = [];
	let loopTerminated = false;

	for await (const event of agent.run()) {
		// Check for session completions after each event
		injectSessionCompletionNotices(agent);
		// Check for loop warnings (set by hooks at iteration start)
		const loopResult = injectLoopWarnings(agent, trackingContext, log);
		if (loopResult === 'hard_stop') {
			log.error('[Loop Hard Stop] Agent terminated due to persistent semantic loop', {
				iterations: trackingContext.metrics.llmIterations,
				nameOnlyRepeatCount: trackingContext.loopDetection.nameOnlyRepeatCount,
			});
			loopTerminated = true;
			break;
		}
		await handleStreamEvent(event, outputLines, log, trackingContext, interactive, autoAccept);
	}

	if (!loopTerminated) {
		// Final check for any completions that occurred during the last event
		injectSessionCompletionNotices(agent);
		// Final check for any pending loop warnings
		injectLoopWarnings(agent, trackingContext, log);
	}

	const cost = agent.getTree()?.getTotalCost() ?? 0;

	return {
		output: outputLines.join('\n'),
		iterations: trackingContext.metrics.llmIterations,
		gadgetCalls: trackingContext.metrics.gadgetCalls,
		cost,
		loopTerminated,
	};
}
