/**
 * Shared agent event loop with interactive mode support.
 *
 * This module centralizes the event processing logic used by all CASCADE agents.
 * Interactive mode handling lives here, making it easy to extend and customize.
 */
import { consumePendingSessionNotices } from '../../gadgets/tmux.js';
import {
	displayGadgetCall,
	displayGadgetResult,
	displayLLMText,
	waitForEnter,
} from '../../utils/interactive.js';
import type { createAgentLogger } from './logging.js';
import { type TrackingContext, incrementGadgetCall, isSyntheticCall } from './tracking.js';

// ============================================================================
// Types
// ============================================================================

export interface AgentRunResult {
	output: string;
	iterations: number; // LLM request cycles
	gadgetCalls: number; // Non-synthetic gadget calls
	cost: number;
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
		if (parameters.status) logContext.status = parameters.status;
		if (parameters.content) logContext.todo = truncateContent(String(parameters.content), 80);
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
): Promise<void> {
	const { gadgetName, invocationId, parameters } = event;
	const isSynthetic = isSyntheticCall(invocationId, trackingContext);

	if (!isSynthetic) {
		incrementGadgetCall(trackingContext);
	}

	if (interactive) {
		displayGadgetCall(gadgetName, parameters ?? {}, isSynthetic);
		if (!isSynthetic) {
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
				await handleGadgetCallEvent(event.call, log, trackingContext, interactive);
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
 */
export async function runAgentLoop(
	agent: RunnableAgent,
	log: ReturnType<typeof createAgentLogger>,
	trackingContext: TrackingContext,
	interactive = false,
): Promise<AgentRunResult> {
	const outputLines: string[] = [];

	for await (const event of agent.run()) {
		// Check for session completions after each event
		injectSessionCompletionNotices(agent);
		await handleStreamEvent(event, outputLines, log, trackingContext, interactive);
	}

	// Final check for any completions that occurred during the last event
	injectSessionCompletionNotices(agent);

	const cost = agent.getTree()?.getTotalCost() ?? 0;

	return {
		output: outputLines.join('\n'),
		iterations: trackingContext.metrics.llmIterations,
		gadgetCalls: trackingContext.metrics.gadgetCalls,
		cost,
	};
}
