import { randomUUID } from 'node:crypto';
import type {
	query,
	SDKAssistantMessage,
	SDKResultMessage,
	SDKResultSuccess,
	SDKStatusMessage,
	SDKSystemMessage,
	SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { calculateCost } from '../../utils/llmMetrics.js';
import { extractPRUrl } from '../../utils/prUrl.js';
import { buildEngineResult } from '../shared/engineResult.js';
import { logLlmCall } from '../shared/llmCallLogger.js';
import { buildTextPrEvidence } from '../shared/resultBuilder.js';
import type { AgentEngineResult, AgentExecutionPlan, ContextImage } from '../types.js';

export const CLAUDE_SUPPORTED_IMAGE_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
]);

/**
 * Build an AsyncIterable of SDKUserMessages that delivers the task prompt text along
 * with any work-item images as native SDK image content blocks.
 *
 * Used by the Claude Code engine to inject images directly into the first conversation
 * turn rather than writing them to disk and hoping the agent reads the files.
 */
export async function* buildPromptWithImages(
	text: string,
	images: ContextImage[],
): AsyncIterable<SDKUserMessage> {
	const imageBlocks = images
		.filter((img) => CLAUDE_SUPPORTED_IMAGE_TYPES.has(img.mimeType))
		.map((img) => ({
			type: 'image' as const,
			source: {
				type: 'base64' as const,
				media_type: img.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
				data: img.base64Data,
			},
		}));

	yield {
		type: 'user',
		message: { role: 'user', content: [{ type: 'text', text }, ...imageBlocks] },
		parent_tool_use_id: null,
		session_id: randomUUID(),
	};
}

/**
 * Filter context images to those supported by the Claude SDK.
 * Logs an INFO message when images will be injected, and a WARN for any skipped MIME types.
 */
export function filterContextImages(
	contextInjections: AgentExecutionPlan['contextInjections'],
	logWriter: AgentExecutionPlan['logWriter'],
): ContextImage[] {
	const allImages = contextInjections.flatMap((inj) => inj.images ?? []);
	const supported = allImages.filter((img) => CLAUDE_SUPPORTED_IMAGE_TYPES.has(img.mimeType));
	const skipped = allImages.length - supported.length;
	if (supported.length > 0) {
		logWriter('INFO', 'Injecting work item images as SDK content blocks', {
			count: supported.length,
		});
	}
	if (skipped > 0) {
		logWriter('WARN', 'Skipped unsupported image MIME types', {
			skipped,
			types: [
				...new Set(
					allImages
						.filter((img) => !CLAUDE_SUPPORTED_IMAGE_TYPES.has(img.mimeType))
						.map((img) => img.mimeType),
				),
			],
		});
	}
	return supported;
}

/**
 * Extract a GitHub PR URL from assistant messages (tool results containing create-pr output).
 */
export function extractPRUrlFromMessages(
	assistantMessages: SDKAssistantMessage[],
): string | undefined {
	for (const msg of assistantMessages) {
		if (!msg.message?.content) continue;
		for (const block of msg.message.content) {
			if (block.type === 'text') {
				const url = extractPRUrl(block.text);
				if (url) return url;
			}
		}
	}
	return undefined;
}

/**
 * Try to extract a finish comment from a single content block.
 */
export function extractCommentFromBlock(block: {
	type: string;
	name?: string;
	input?: unknown;
}): string | undefined {
	if (block.type !== 'tool_use' || block.name !== 'Bash') return undefined;
	const { command } = block.input as { command?: string };
	if (!command?.includes('cascade-tools') || !command?.includes('session finish')) return undefined;
	const match = command.match(/--comment\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
	return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

/**
 * Extract finish comment from assistant messages that invoked cascade-tools session finish.
 */
export function extractFinishComment(assistantMessages: SDKAssistantMessage[]): string | undefined {
	for (const msg of assistantMessages) {
		if (!msg.message?.content) continue;
		for (const block of msg.message.content) {
			const comment = extractCommentFromBlock(block);
			if (comment) return comment;
		}
	}
	return undefined;
}

/** Report progress and log a single content block from an assistant message. */
function processContentBlock(
	block: { type: string; name?: string; input?: unknown; text?: string },
	input: AgentExecutionPlan,
): void {
	if (block.type === 'tool_use' && block.name) {
		input.progressReporter.onToolCall(block.name, block.input as Record<string, unknown>);
	}
	if (block.type === 'text' && block.text !== undefined) {
		const truncated = block.text.length > 300 ? `${block.text.slice(0, 300)}...` : block.text;
		input.logWriter('INFO', 'Agent text', { text: truncated });
		input.progressReporter.onText(block.text);
	}
}

/**
 * Process an assistant message: report progress, log text/errors/usage.
 */
export function processAssistantMessage(
	assistantMsg: SDKAssistantMessage,
	turnCount: number,
	input: AgentExecutionPlan,
): void {
	for (const block of assistantMsg.message?.content ?? []) {
		processContentBlock(block, input);
	}

	if (assistantMsg.error) {
		input.logWriter('ERROR', 'Assistant message error', {
			error: assistantMsg.error,
			turn: turnCount,
		});
	}

	const usage = assistantMsg.message?.usage;
	if (usage) {
		input.logWriter('DEBUG', 'Token usage', {
			turn: turnCount,
			inputTokens: usage.input_tokens,
			outputTokens: usage.output_tokens,
			cacheReadTokens: usage.cache_read_input_tokens ?? 0,
			cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
		});
	}
}

/**
 * Process a system message: log init and status events.
 */
export function processSystemMessage(
	message: { subtype: string; [key: string]: unknown },
	logWriter: AgentExecutionPlan['logWriter'],
): void {
	if (message.subtype === 'init') {
		const initMsg = message as unknown as SDKSystemMessage;
		logWriter('INFO', 'Claude Code session initialized', {
			model: initMsg.model,
			claudeCodeVersion: initMsg.claude_code_version,
			tools: initMsg.tools,
		});
	} else if (message.subtype === 'status') {
		const statusMsg = message as unknown as SDKStatusMessage;
		logWriter('INFO', 'Session status change', { status: statusMsg.status });
	}
}

/**
 * Process a task_notification system message: log and report completed tasks.
 */
export function processTaskNotification(
	sysMsg: { [key: string]: unknown },
	input: AgentExecutionPlan,
): void {
	const taskMsg = sysMsg as unknown as {
		task_id: string;
		status: string;
		summary: string;
	};
	if (taskMsg.status === 'completed' && input.progressReporter.onTaskCompleted) {
		input.progressReporter.onTaskCompleted(taskMsg.task_id, '', taskMsg.summary);
	}
	input.logWriter('INFO', 'Task notification', {
		taskId: taskMsg.task_id,
		status: taskMsg.status,
		summary: taskMsg.summary,
	});
}

/**
 * Count the number of tool_use blocks in an assistant message.
 */
export function countToolCalls(assistantMsg: SDKAssistantMessage): number {
	return (assistantMsg.message?.content ?? []).filter((b) => b.type === 'tool_use').length;
}

/**
 * Convert a raw Anthropic model ID (e.g. 'claude-sonnet-4-5-20250929') to the
 * pricing key format used by calculateCost() (e.g. 'anthropic:claude-sonnet-4-5').
 */
function toPricingKey(model: string): string {
	return `anthropic:${model}`.replace(/-\d{8}$/, '');
}

/**
 * Log an LLM call for a single assistant message turn.
 */
export function logClaudeCodeLlmCall(
	input: AgentExecutionPlan,
	assistantMsg: SDKAssistantMessage,
	turnCount: number,
	model: string,
): void {
	if (!assistantMsg.message?.usage) return;

	const usage = assistantMsg.message.usage;
	const cacheRead = usage.cache_read_input_tokens ?? 0;
	const cacheWrite = usage.cache_creation_input_tokens ?? 0;
	const totalInput = usage.input_tokens + cacheRead + cacheWrite;
	const cost = calculateCost(toPricingKey(model), {
		inputTokens: totalInput,
		outputTokens: usage.output_tokens,
		totalTokens: totalInput + usage.output_tokens,
		cachedInputTokens: cacheRead,
	});

	let response: string | undefined;
	try {
		response = JSON.stringify(assistantMsg.message.content ?? []);
	} catch {
		// Ignore serialization errors
	}

	logLlmCall({
		runId: input.runId,
		callNumber: turnCount,
		model,
		inputTokens: totalInput,
		outputTokens: usage.output_tokens,
		cachedTokens: cacheRead,
		costUsd: cost > 0 ? cost : undefined,
		response,
		engineLabel: 'Claude Code',
	});
}

/**
 * Consume the Claude Code SDK stream and collect assistant messages, result, and counters.
 * Returns the updated turn count and tool call count accumulated during this stream.
 */
export async function consumeStream(
	stream: ReturnType<typeof query>,
	input: AgentExecutionPlan,
	model: string,
	startTurnCount: number,
): Promise<{
	assistantMessages: SDKAssistantMessage[];
	resultMessage: SDKResultMessage | undefined;
	turnCount: number;
	toolCallCount: number;
}> {
	const assistantMessages: SDKAssistantMessage[] = [];
	let resultMessage: SDKResultMessage | undefined;
	let turnCount = startTurnCount;
	let toolCallCount = 0;

	for await (const message of stream) {
		if (message.type === 'assistant') {
			const assistantMsg = message as SDKAssistantMessage;
			assistantMessages.push(assistantMsg);
			turnCount++;
			await input.progressReporter.onIteration(turnCount, input.maxIterations);
			processAssistantMessage(assistantMsg, turnCount, input);
			toolCallCount += countToolCalls(assistantMsg);
			logClaudeCodeLlmCall(input, assistantMsg, turnCount, model);
		} else if (message.type === 'system') {
			const sysMsg = message as { subtype: string; [key: string]: unknown };
			if (sysMsg.subtype === 'task_notification') {
				processTaskNotification(sysMsg, input);
			} else {
				processSystemMessage(sysMsg, input.logWriter);
			}
		} else if (message.type === 'result') {
			resultMessage = message as SDKResultMessage;
		}
	}

	return { assistantMessages, resultMessage, turnCount, toolCallCount };
}

/**
 * Format a human-readable error message from a non-success SDK result.
 */
export function formatErrorMessage(
	errorResult: Exclude<SDKResultMessage, SDKResultSuccess>,
	budgetUsd?: number,
): string {
	if (errorResult.subtype === 'error_max_budget_usd') {
		const spent = errorResult.total_cost_usd?.toFixed(2) ?? '?';
		const limit = budgetUsd?.toFixed(2) ?? '?';
		return `Budget limit reached: spent $${spent} of $${limit} allowed for this run. Increase the project work-item budget or retry with a higher limit.`;
	}
	return errorResult.errors?.join('; ') ?? errorResult.subtype;
}

/**
 * Build the result from collected stream data.
 */
export function buildResult(
	assistantMessages: SDKAssistantMessage[],
	resultMessage: SDKResultMessage | undefined,
	stderrChunks: string[],
	input: AgentExecutionPlan,
	startTime: number,
): AgentEngineResult {
	const finishComment = extractFinishComment(assistantMessages);
	const success = resultMessage?.subtype === 'success';
	const cost = resultMessage?.total_cost_usd;

	let output = finishComment ?? '';
	if (!output && resultMessage?.subtype === 'success') {
		output = (resultMessage as SDKResultSuccess).result ?? '';
	}

	let error: string | undefined;
	if (resultMessage && resultMessage.subtype !== 'success') {
		const errorResult = resultMessage as Exclude<SDKResultMessage, SDKResultSuccess>;
		error = formatErrorMessage(errorResult, input.budgetUsd);
	}

	const stderrOutput = stderrChunks.join('').trim();
	if (stderrOutput) {
		input.logWriter('WARN', 'Claude Code stderr output', { stderr: stderrOutput });
		if (error) {
			error += ` | stderr: ${stderrOutput}`;
		}
	}

	const prUrl = extractPRUrl(output) ?? extractPRUrlFromMessages(assistantMessages);
	const prEvidence = buildTextPrEvidence(prUrl);

	input.logWriter('INFO', 'Claude Code SDK turn completed', {
		success,
		subtype: resultMessage?.subtype,
		turns: resultMessage?.num_turns,
		cost,
		prUrl: prUrl ?? null,
		durationMs: Date.now() - startTime,
	});

	return buildEngineResult({ success, output, cost, error, prUrl, prEvidence });
}
