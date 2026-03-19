/**
 * JSONL event parsing for the Codex engine.
 *
 * Contains all functions responsible for interpreting individual JSONL events
 * emitted by `codex exec --json`. The CodexEngine class (index.ts) delegates
 * all event-level parsing to this module so that index.ts can focus on spawn
 * lifecycle, turn handling, and result assembly.
 */

type JsonRecord = Record<string, unknown>;
type ToolCall = { name: string; input?: Record<string, unknown> };
export type ParsedCodexEvent = {
	textParts: string[];
	toolCall: ToolCall | null;
	usage: UsageSummary | null;
	error?: string;
};
export type UsageSummary = {
	inputTokens?: number;
	outputTokens?: number;
	cachedTokens?: number;
	costUsd?: number;
};

export function extractTextFromContentParts(candidate: unknown): string[] {
	const parts: string[] = [];
	if (!Array.isArray(candidate)) return parts;

	for (const item of candidate) {
		if (typeof item === 'string' && item.trim()) {
			parts.push(item);
			continue;
		}
		if (!item || typeof item !== 'object') continue;
		if ('type' in item && item.type !== 'text') continue;
		if ('text' in item && typeof item.text === 'string' && item.text.trim()) {
			parts.push(item.text);
		}
	}

	return parts;
}

/** Extracts text from an item.completed message item (Responses API). */
export function extractItemText(item: unknown): string[] {
	if (!item || typeof item !== 'object') return [];
	const rec = item as JsonRecord;
	// agent_message items carry text directly
	if (rec.type === 'agent_message' && typeof rec.text === 'string' && rec.text.trim()) {
		return [rec.text];
	}
	return 'content' in rec ? extractTextFromContentParts(rec.content) : [];
}

/** Extracts text from a delta field (either a plain string or a text_delta object). */
export function extractDeltaText(delta: unknown): string[] {
	if (typeof delta === 'string' && delta.trim()) return [delta];
	if (delta && typeof delta === 'object' && !Array.isArray(delta)) {
		const rec = delta as JsonRecord;
		if (typeof rec.text === 'string' && rec.text.trim()) return [rec.text];
	}
	return [];
}

export function extractTextParts(event: JsonRecord): string[] {
	const parts: string[] = [];

	if (typeof event.text === 'string' && event.text.trim()) {
		parts.push(event.text);
	}

	parts.push(...extractTextFromContentParts(event.content));
	parts.push(...extractTextFromContentParts(event.last_message));

	const message = event.message;
	if (message && typeof message === 'object' && 'content' in message) {
		parts.push(...extractTextFromContentParts((message as JsonRecord).content));
	}

	// Case: item.completed → { item: { type: 'message', content: [...] } }
	parts.push(...extractItemText(event.item));

	// Case: item.delta → { delta: { type: 'text_delta', text: '...' } }
	parts.push(...extractDeltaText(event.delta));

	return parts;
}

/** Parses a Responses API function_call or command_execution item into a ToolCall. */
export function parseFunctionCallItem(item: unknown): ToolCall | null {
	if (!item || typeof item !== 'object') return null;
	const rec = item as JsonRecord;
	// command_execution items are bash tool calls
	if (rec.type === 'command_execution' && typeof rec.command === 'string') {
		return { name: 'bash', input: { command: rec.command } };
	}
	if (rec.type !== 'function_call' || typeof rec.name !== 'string' || !rec.name) return null;
	let input: Record<string, unknown> | undefined;
	if (typeof rec.arguments === 'string') {
		try {
			input = JSON.parse(rec.arguments) as Record<string, unknown>;
		} catch {
			/* ignore malformed JSON arguments */
		}
	} else if (rec.arguments && typeof rec.arguments === 'object') {
		input = rec.arguments as Record<string, unknown>;
	}
	return { name: rec.name, input };
}

export function extractToolCall(event: JsonRecord): ToolCall | null {
	if (typeof event.tool_name === 'string' && event.tool_name) {
		return {
			name: event.tool_name,
			input: (event.tool_input as Record<string, unknown> | undefined) ?? undefined,
		};
	}

	if (
		(event.type === 'tool_call' || event.type === 'tool_use') &&
		typeof event.name === 'string' &&
		event.name &&
		(event.input === undefined || (event.input && typeof event.input === 'object'))
	) {
		return {
			name: event.name,
			input: event.input as Record<string, unknown> | undefined,
		};
	}

	// Case: item.completed → { item: { type: 'function_call', name: '...', arguments: '...' } }
	return parseFunctionCallItem(event.item);
}

/** Resolves the usage record from flat event fields or nested response.usage (Responses API). */
export function resolveUsageRecord(event: JsonRecord): JsonRecord | undefined {
	if (event.usage && typeof event.usage === 'object') return event.usage as JsonRecord;
	if (event.token_usage && typeof event.token_usage === 'object')
		return event.token_usage as JsonRecord;
	const response = event.response;
	if (response && typeof response === 'object') {
		const r = response as JsonRecord;
		if (r.usage && typeof r.usage === 'object') return r.usage as JsonRecord;
	}
	return undefined;
}

export function extractUsage(event: JsonRecord): UsageSummary | null {
	const usage = resolveUsageRecord(event);
	const inputTokens =
		typeof usage?.input_tokens === 'number'
			? usage.input_tokens
			: typeof usage?.inputTokens === 'number'
				? usage.inputTokens
				: undefined;
	const outputTokens =
		typeof usage?.output_tokens === 'number'
			? usage.output_tokens
			: typeof usage?.outputTokens === 'number'
				? usage.outputTokens
				: undefined;
	const cachedTokens =
		typeof usage?.cached_input_tokens === 'number' ? usage.cached_input_tokens : undefined;
	const costUsd =
		typeof event.total_cost_usd === 'number'
			? event.total_cost_usd
			: typeof event.cost_usd === 'number'
				? event.cost_usd
				: typeof usage?.cost_usd === 'number'
					? usage.cost_usd
					: undefined;

	return inputTokens !== undefined || outputTokens !== undefined || costUsd !== undefined
		? { inputTokens, outputTokens, cachedTokens, costUsd }
		: null;
}

export function extractErrorMessage(event: JsonRecord): string | undefined {
	// Case 1: event.error is a string (existing shape)
	if (typeof event.error === 'string' && event.error) return event.error;
	// Case 2: event.error is an object {message:"..."} — turn.failed shape
	if (event.error && typeof event.error === 'object') {
		const msg = (event.error as JsonRecord).message;
		if (typeof msg === 'string' && msg) return msg;
	}
	// Case 3: {type:"error", message:"Reconnecting…"} — top-level message field
	if (event.type === 'error' && typeof event.message === 'string' && event.message) {
		return event.message;
	}
	return undefined;
}

export function parseCodexEvent(event: JsonRecord): ParsedCodexEvent {
	return {
		textParts: extractTextParts(event),
		toolCall: extractToolCall(event),
		usage: extractUsage(event),
		error: extractErrorMessage(event),
	};
}
