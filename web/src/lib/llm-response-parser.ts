/**
 * Normalizes LLM call response payloads from different engines into a canonical structure.
 *
 * Engine formats:
 * - Claude Code / OpenCode: JSON array of content blocks [{type, ...}]
 * - Codex: JSON object {turn, text?, tools?: string[], usage?}
 * - LLMist: raw text with !!!GADGET_START:ToolName / !!!GADGET_END markup
 *
 * NOTE: This file is mirrored at src/utils/llmResponseParser.ts. Keep both in sync.
 */

export type ParsedBlock =
	| { kind: 'text'; text: string }
	| { kind: 'tool_use'; name: string; inputSummary: string }
	| { kind: 'thinking'; text: string };

export interface ParsedLlmResponse {
	blocks: ParsedBlock[];
	/**
	 * Tool names in invocation order, one entry per call (NOT deduplicated).
	 * Callers that need unique names should use `new Set(toolNames)`.
	 * Includes duplicates so that ×N badge counts reflect actual call frequency.
	 */
	toolNames: string[];
	/** First text block truncated to ~120 chars, empty string if none */
	textPreview: string;
}

const GADGET_START = '!!!GADGET_START:';
const GADGET_END = '!!!GADGET_END';
const GADGET_ARG = '!!!ARG:';

// Args to prefer when building an inputSummary for LLMist gadget calls
const PRIORITY_ARGS = [
	'command',
	'filename',
	'path',
	'file_path',
	'workItemId',
	'query',
	'comment',
];

/** Accumulator for one in-progress LLMist gadget call */
interface GadgetAccum {
	name: string;
	args: Record<string, string>;
	currentArgKey: string | null;
	currentArgLines: string[];
}

/** Mutable state threaded through the LLMist line-by-line parser */
interface LlmistState {
	blocks: ParsedBlock[];
	toolNames: string[];
	current: GadgetAccum | null;
	preGadgetLines: string[];
	foundFirstGadget: boolean;
	textPreview: string;
}

/** Truncate a string to maxLen chars, appending `…` if truncated */
function truncate(s: string, maxLen: number): string {
	return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}

/** Flush the current in-progress arg value into accum.args */
function flushGadgetArg(accum: GadgetAccum): void {
	if (accum.currentArgKey !== null) {
		accum.args[accum.currentArgKey] = accum.currentArgLines.join('\n').trim();
		accum.currentArgKey = null;
		accum.currentArgLines = [];
	}
}

/** Finalize a completed gadget call and push it onto the output arrays */
function finalizeGadget(accum: GadgetAccum, blocks: ParsedBlock[], toolNames: string[]): void {
	flushGadgetArg(accum);
	const { name, args } = accum;

	// Build inputSummary: scan priority args first, then fall back to first arg
	let inputSummary = '';
	for (const key of PRIORITY_ARGS) {
		const val = args[key];
		if (typeof val === 'string' && val) {
			inputSummary = truncate(val.replace(/\n/g, ' ').trim(), 100);
			break;
		}
	}
	if (!inputSummary) {
		const firstVal = Object.values(args)[0];
		if (firstVal) inputSummary = truncate(firstVal.replace(/\n/g, ' ').trim(), 80);
	}

	blocks.push({ kind: 'tool_use', name, inputSummary });
	toolNames.push(name); // one entry per invocation, not deduplicated
}

function handleGadgetStart(line: string, s: LlmistState): void {
	if (!s.foundFirstGadget) {
		s.foundFirstGadget = true;
		const pre = s.preGadgetLines.join('\n').trim();
		if (pre) {
			s.blocks.push({ kind: 'text', text: pre });
			s.textPreview = truncate(pre, 120);
		}
	}
	if (s.current) finalizeGadget(s.current, s.blocks, s.toolNames);
	const name = line.slice(GADGET_START.length).split(':')[0].trim();
	s.current = { name, args: {}, currentArgKey: null, currentArgLines: [] };
}

function handleGadgetEnd(s: LlmistState): void {
	if (s.current) finalizeGadget(s.current, s.blocks, s.toolNames);
	s.current = null;
}

function handleGadgetArg(line: string, s: LlmistState): void {
	if (!s.current) return;
	flushGadgetArg(s.current);
	s.current.currentArgKey = line.slice(GADGET_ARG.length).trim();
	s.current.currentArgLines = [];
}

function processLlmistLine(line: string, s: LlmistState): void {
	if (line.startsWith(GADGET_START)) {
		handleGadgetStart(line, s);
	} else if (line.startsWith(GADGET_END)) {
		handleGadgetEnd(s);
	} else if (line.startsWith(GADGET_ARG)) {
		handleGadgetArg(line, s);
	} else if (s.current !== null && s.current.currentArgKey !== null) {
		s.current.currentArgLines.push(line);
	} else if (!s.foundFirstGadget) {
		s.preGadgetLines.push(line);
	}
}

/**
 * Build a human-readable summary of a tool's input object.
 * Prefers well-known field names over raw JSON stringification.
 */
function summarizeInput(name: string, input: unknown): string {
	if (!input || typeof input !== 'object') return '';
	const obj = input as Record<string, unknown>;

	switch (name) {
		case 'Read':
		case 'Write':
		case 'Edit':
			if (typeof obj.file_path === 'string') return truncate(obj.file_path, 100);
			break;
		case 'Glob':
		case 'Grep':
			if (typeof obj.pattern === 'string') return truncate(obj.pattern, 100);
			break;
		case 'Bash':
			if (typeof obj.command === 'string')
				return truncate(obj.command.replace(/\n/g, ' ').trim(), 100);
			break;
		case 'WebFetch':
			if (typeof obj.url === 'string') return truncate(obj.url, 100);
			break;
		case 'WebSearch':
			if (typeof obj.query === 'string') return truncate(obj.query, 100);
			break;
	}

	try {
		return truncate(JSON.stringify(input), 80);
	} catch {
		return '';
	}
}

/** Process one Claude Code content block; returns a textPreview candidate or null */
function processClaudeBlock(
	block: Record<string, unknown>,
	blocks: ParsedBlock[],
	toolNames: string[],
): string | null {
	if (block.type === 'text' && typeof block.text === 'string') {
		blocks.push({ kind: 'text', text: block.text });
		return block.text;
	}
	if (block.type === 'tool_use' && typeof block.name === 'string') {
		const name = block.name;
		blocks.push({ kind: 'tool_use', name, inputSummary: summarizeInput(name, block.input) });
		toolNames.push(name); // one entry per invocation, not deduplicated
	} else if (block.type === 'thinking' && typeof block.thinking === 'string') {
		blocks.push({ kind: 'thinking', text: block.thinking });
	}
	return null;
}

/** Parse LLMist format: raw text with !!!GADGET_START:Name / !!!ARG:key / !!!GADGET_END markers */
function parseLlmistResponse(rawResponse: string): ParsedLlmResponse {
	const s: LlmistState = {
		blocks: [],
		toolNames: [],
		current: null,
		preGadgetLines: [],
		foundFirstGadget: false,
		textPreview: '',
	};

	for (const line of rawResponse.split('\n')) {
		processLlmistLine(line, s);
	}
	if (s.current) finalizeGadget(s.current, s.blocks, s.toolNames);

	return { blocks: s.blocks, toolNames: s.toolNames, textPreview: s.textPreview };
}

/** Parse Claude Code / OpenCode format: JSON array of typed content blocks */
function parseClaudeCodeBlocks(parsed: unknown[]): ParsedLlmResponse {
	const blocks: ParsedBlock[] = [];
	const toolNames: string[] = [];
	let textPreview = '';

	for (const item of parsed) {
		if (!item || typeof item !== 'object') continue;
		const candidate = processClaudeBlock(item as Record<string, unknown>, blocks, toolNames);
		if (candidate !== null && !textPreview) {
			textPreview = truncate(candidate, 120);
		}
	}

	return { blocks, toolNames, textPreview };
}

/** Parse Codex format: {turn, text?, tools?: string[], usage?} */
function parseCodexPayload(parsed: Record<string, unknown>): ParsedLlmResponse {
	const blocks: ParsedBlock[] = [];
	const toolNames: string[] = [];
	let textPreview = '';

	if (typeof parsed.text === 'string' && parsed.text) {
		blocks.push({ kind: 'text', text: parsed.text });
		textPreview = truncate(parsed.text, 120);
	}

	if (Array.isArray(parsed.tools)) {
		for (const name of parsed.tools) {
			if (typeof name === 'string') {
				blocks.push({ kind: 'tool_use', name, inputSummary: '' });
				toolNames.push(name);
			}
		}
	}

	return { blocks, toolNames, textPreview };
}

export function parseLlmResponse(rawResponse: string | null | undefined): ParsedLlmResponse {
	if (!rawResponse) return { blocks: [], toolNames: [], textPreview: '' };

	// LLMist: raw text with gadget call markup
	if (rawResponse.includes(GADGET_START)) {
		return parseLlmistResponse(rawResponse);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawResponse);
	} catch {
		// Unparseable — treat as raw text
		return {
			blocks: [{ kind: 'text', text: rawResponse }],
			toolNames: [],
			textPreview: truncate(rawResponse, 120),
		};
	}

	// Claude Code / OpenCode: array of content blocks
	if (Array.isArray(parsed)) {
		return parseClaudeCodeBlocks(parsed);
	}

	// Codex: object with tools array and/or text
	if (
		parsed !== null &&
		typeof parsed === 'object' &&
		('tools' in (parsed as object) || 'text' in (parsed as object))
	) {
		return parseCodexPayload(parsed as Record<string, unknown>);
	}

	return { blocks: [], toolNames: [], textPreview: '' };
}
