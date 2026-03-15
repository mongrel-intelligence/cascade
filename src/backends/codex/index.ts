import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { writeProjectCredential } from '../../db/repositories/credentialsRepository.js';
import { extractPRUrl } from '../../utils/prUrl.js';
import { CODEX_ENGINE_DEFINITION } from '../catalog.js';
import { cleanupContextFiles } from '../contextFiles.js';
import { buildSystemPrompt, buildTaskPrompt } from '../nativeTools.js';
import { logLlmCall } from '../shared/llmCallLogger.js';
import type { AgentEngine, AgentEngineResult, AgentExecutionPlan, LogWriter } from '../types.js';
import { buildEnv } from './env.js';
import { CODEX_MODEL_IDS, DEFAULT_CODEX_MODEL } from './models.js';
import {
	CodexSettingsSchema,
	assertHeadlessCodexSettings,
	resolveCodexSettings,
} from './settings.js';

const CODEX_AUTH_DIR = join(homedir(), '.codex');
const CODEX_AUTH_FILE = join(CODEX_AUTH_DIR, 'auth.json');

type JsonRecord = Record<string, unknown>;
type ToolCall = { name: string; input?: Record<string, unknown> };
type ParsedCodexEvent = {
	textParts: string[];
	toolCall: ToolCall | null;
	usage: UsageSummary | null;
	error?: string;
};
type UsageSummary = {
	inputTokens?: number;
	outputTokens?: number;
	cachedTokens?: number;
	costUsd?: number;
};
/**
 * Accumulator for a single Codex turn (bounded by turn.started → turn.completed).
 * Collects text, tool summaries, and usage across multiple JSONL events so that
 * exactly one storeLlmCall row is persisted per completed turn — not one row per
 * intermediate usage-bearing event.
 */
type CodexTurnAccumulator = {
	textSummary: string[];
	toolNames: string[];
	usage: UsageSummary | null;
};

type CodexLineContext = {
	input: AgentExecutionPlan;
	model: string;
	maxIterations: number;
	rawTextParts: string[];
	iterationCount: number;
	llmCallCount: number;
	cost?: number;
	finalError?: string;
	/** Accumulator for the turn currently in progress. Reset on turn.started/thread.started. */
	currentTurn: CodexTurnAccumulator;
};

function appendEngineLog(path: string | undefined, chunk: string): void {
	if (!path || chunk.length === 0) return;
	appendFileSync(path, chunk, 'utf-8');
}

function tomlString(value: string): string {
	return JSON.stringify(value);
}

function extractTextFromContentParts(candidate: unknown): string[] {
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
function extractItemText(item: unknown): string[] {
	if (!item || typeof item !== 'object') return [];
	const rec = item as JsonRecord;
	// agent_message items carry text directly
	if (rec.type === 'agent_message' && typeof rec.text === 'string' && rec.text.trim()) {
		return [rec.text];
	}
	return 'content' in rec ? extractTextFromContentParts(rec.content) : [];
}

/** Extracts text from a delta field (either a plain string or a text_delta object). */
function extractDeltaText(delta: unknown): string[] {
	if (typeof delta === 'string' && delta.trim()) return [delta];
	if (delta && typeof delta === 'object' && !Array.isArray(delta)) {
		const rec = delta as JsonRecord;
		if (typeof rec.text === 'string' && rec.text.trim()) return [rec.text];
	}
	return [];
}

function extractTextParts(event: JsonRecord): string[] {
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
function parseFunctionCallItem(item: unknown): ToolCall | null {
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

function extractToolCall(event: JsonRecord): ToolCall | null {
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
function resolveUsageRecord(event: JsonRecord): JsonRecord | undefined {
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

function extractUsage(event: JsonRecord): UsageSummary | null {
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

function extractErrorMessage(event: JsonRecord): string | undefined {
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

function parseCodexEvent(event: JsonRecord): ParsedCodexEvent {
	return {
		textParts: extractTextParts(event),
		toolCall: extractToolCall(event),
		usage: extractUsage(event),
		error: extractErrorMessage(event),
	};
}

function trackIteration(context: CodexLineContext): Promise<void> {
	context.iterationCount += 1;
	return context.input.progressReporter.onIteration(context.iterationCount, context.maxIterations);
}

function logText(context: CodexLineContext, text: string): void {
	context.rawTextParts.push(text);
	context.input.logWriter('INFO', 'Codex text', {
		text: text.length > 300 ? `${text.slice(0, 300)}...` : text,
	});
	context.input.progressReporter.onText(text);
}

/**
 * Merge new usage data into the current turn accumulator.
 * Intermediate events (e.g. response.completed) may carry usage before turn.completed
 * fires. We accumulate here rather than persisting immediately to avoid duplicate rows.
 * The last non-null value wins for each field, matching the pattern where response.completed
 * carries per-response totals and turn.completed carries aggregate turn totals.
 */
function accumulateTurnUsage(context: CodexLineContext, usage: UsageSummary): void {
	const acc = context.currentTurn;
	if (!acc.usage) {
		acc.usage = { ...usage };
	} else {
		// Override with new values where present — turn.completed totals supersede response.completed
		if (usage.inputTokens !== undefined) acc.usage.inputTokens = usage.inputTokens;
		if (usage.outputTokens !== undefined) acc.usage.outputTokens = usage.outputTokens;
		if (usage.cachedTokens !== undefined) acc.usage.cachedTokens = usage.cachedTokens;
		if (usage.costUsd !== undefined) acc.usage.costUsd = usage.costUsd;
	}
}

/**
 * Persist exactly one storeLlmCall row for the completed turn, then reset the accumulator.
 * Called only from turn.completed to guarantee one row per turn, never from intermediate events.
 */
function persistTurnLlmCall(context: CodexLineContext): void {
	const acc = context.currentTurn;
	const usage = acc.usage;
	if (usage) {
		context.cost = usage.costUsd ?? context.cost;
	}
	context.llmCallCount += 1;

	// Build a compact turn-scoped payload: text summary + tool names + usage.
	// Storing this instead of the raw event JSONL keeps the payload small and readable.
	const turnPayload = JSON.stringify({
		turn: context.llmCallCount,
		text: acc.textSummary.join(' ').slice(0, 500) || undefined,
		tools: acc.toolNames.length > 0 ? acc.toolNames : undefined,
		usage: usage ?? undefined,
	});

	logLlmCall({
		runId: context.input.runId,
		callNumber: context.llmCallCount,
		model: context.model,
		inputTokens: usage?.inputTokens,
		outputTokens: usage?.outputTokens,
		cachedTokens: usage?.cachedTokens,
		costUsd: usage?.costUsd,
		response: turnPayload,
		engineLabel: 'Codex',
	});

	// Reset the accumulator for the next turn
	context.currentTurn = { textSummary: [], toolNames: [], usage: null };
}

/**
 * Handles structural turn/thread/item lifecycle events.
 * Returns true if the event was fully handled and no further processing is needed.
 *
 * Persistence boundary: ONE storeLlmCall row is written exactly when turn.completed fires,
 * using data accumulated across all events in the turn. Intermediate usage-bearing events
 * (e.g. response.completed) update the accumulator only; they do NOT persist a row.
 */
async function handleStructuralEvent(
	context: CodexLineContext,
	parsed: JsonRecord,
	eventType: string,
): Promise<boolean> {
	if (eventType === 'turn.completed') {
		await trackIteration(context);
		// Merge any usage attached to turn.completed into the accumulator, then persist.
		const usage = extractUsage(parsed);
		if (usage) accumulateTurnUsage(context, usage);
		persistTurnLlmCall(context);
		return true;
	}
	if (eventType === 'turn.started' || eventType === 'thread.started') {
		// Reset turn accumulator at the start of each new turn
		context.currentTurn = { textSummary: [], toolNames: [], usage: null };
		return true;
	}
	if (eventType === 'item.started') {
		context.input.logWriter('DEBUG', 'Codex item started', {
			itemType: (parsed.item as JsonRecord | undefined)?.type ?? '(unknown)',
		});
		return true;
	}
	return false;
}

async function handleParsedLine(context: CodexLineContext, parsed: JsonRecord): Promise<void> {
	const eventType = typeof parsed.type === 'string' ? parsed.type : '';

	if (await handleStructuralEvent(context, parsed, eventType)) return;

	const { textParts, toolCall, usage, error } = parseCodexEvent(parsed);

	if (textParts.length > 0 || toolCall) {
		await trackIteration(context);
	}

	for (const text of textParts) {
		logText(context, text);
		// Accumulate text into the turn buffer for compact per-call payload
		context.currentTurn.textSummary.push(text.slice(0, 200));
	}

	if (toolCall) {
		context.input.logWriter('DEBUG', 'Codex tool call', {
			name: toolCall.name,
			input: toolCall.input,
		});
		context.input.progressReporter.onToolCall(toolCall.name, toolCall.input);
		// Track tool name in turn buffer for the compact payload
		context.currentTurn.toolNames.push(toolCall.name);
	}

	if (usage) {
		context.input.logWriter('DEBUG', 'Codex usage', { usage });
		// Accumulate usage into the turn buffer; do NOT persist here.
		// Persistence happens exactly once on turn.completed to avoid duplicate rows.
		accumulateTurnUsage(context, usage);
	}

	if (error) {
		context.finalError = error;
		context.input.logWriter('WARN', 'Codex error event', { error });
	}

	if (textParts.length === 0 && !toolCall && !usage && !error) {
		context.input.logWriter('DEBUG', 'Unrecognized Codex event type — no fields extracted', {
			type: typeof parsed.type === 'string' ? parsed.type : '(none)',
			item: parsed.item ?? null,
			delta: parsed.delta ?? null,
			event: parsed,
		});
	}
}

async function processStdoutLine(context: CodexLineContext, line: string): Promise<void> {
	appendEngineLog(context.input.engineLogPath, `${line}\n`);
	if (!line.trim()) return;

	let parsed: JsonRecord | undefined;
	try {
		parsed = JSON.parse(line) as JsonRecord;
	} catch {
		context.rawTextParts.push(line);
		context.input.progressReporter.onText(line);
		return;
	}

	await handleParsedLine(context, parsed);
}

function resolveCodexModel(cascadeModel: string): string {
	if (CODEX_MODEL_IDS.includes(cascadeModel)) return cascadeModel;
	if (cascadeModel.startsWith('openai:')) return cascadeModel.replace('openai:', '');
	if (cascadeModel.startsWith('gpt-') && cascadeModel.includes('codex')) return cascadeModel;

	throw new Error(
		`Model "${cascadeModel}" is not compatible with the Codex engine. Configure a Codex-compatible model (e.g. "${DEFAULT_CODEX_MODEL}") or switch to a different engine.`,
	);
}

function buildPrompt(systemPrompt: string, taskPrompt: string): string {
	return `## System Instructions\n${systemPrompt}\n\n## Task\n${taskPrompt}`;
}

export function buildArgs(
	input: AgentExecutionPlan,
	settings: ReturnType<typeof resolveCodexSettings>,
	model: string,
	lastMessagePath: string,
): string[] {
	const args = [
		'exec',
		'--json',
		'--ephemeral',
		'--skip-git-repo-check',
		'-C',
		input.repoDir,
		'-m',
		model,
		'-s',
		settings.sandboxMode,
		'-o',
		lastMessagePath,
		'-c',
		`approval_policy=${tomlString(settings.approvalPolicy)}`,
	];

	if (settings.reasoningEffort) {
		args.push('-c', `model_reasoning_effort=${tomlString(settings.reasoningEffort)}`);
	}
	if (settings.webSearch) {
		args.push('--enable', 'web_search');
	}
	args.push('-');

	return args;
}

/**
 * Write ~/.codex/auth.json for Codex subscription auth (ChatGPT Plus/Pro).
 * Returns the written JSON string so callers can detect post-run token refreshes.
 * Returns undefined if CODEX_AUTH_JSON is not present (API key auth path — no-op).
 */
async function writeCodexAuthFile(
	projectSecrets: Record<string, string> | undefined,
	logWriter: LogWriter,
): Promise<string | undefined> {
	const authJson = projectSecrets?.CODEX_AUTH_JSON;
	if (!authJson) {
		logWriter('DEBUG', 'No CODEX_AUTH_JSON credential — using API key auth', {});
		return undefined;
	}

	try {
		JSON.parse(authJson);
	} catch {
		logWriter('WARN', 'CODEX_AUTH_JSON is not valid JSON — skipping subscription auth', {});
		return undefined;
	}

	await mkdir(CODEX_AUTH_DIR, { recursive: true });
	await writeFile(CODEX_AUTH_FILE, authJson, { mode: 0o600 });
	logWriter('INFO', 'Writing ~/.codex/auth.json for subscription auth', {});
	return authJson;
}

/**
 * After a Codex run, read ~/.codex/auth.json and update the project credential if
 * the Codex CLI refreshed the access token during the run.
 */
async function captureRefreshedToken(
	projectId: string,
	originalJson: string | undefined,
	logWriter: LogWriter,
): Promise<void> {
	if (!originalJson) return;

	let newJson: string;
	try {
		newJson = await readFile(CODEX_AUTH_FILE, 'utf-8');
	} catch {
		return; // Unreadable — nothing to capture
	}

	if (newJson === originalJson) return;

	try {
		await writeProjectCredential(projectId, 'CODEX_AUTH_JSON', newJson);
		logWriter('INFO', 'Captured refreshed Codex auth token and updated project credential', {});
	} catch (error) {
		logWriter('WARN', 'Failed to capture refreshed Codex auth token', { error: String(error) });
	}
}

/**
 * Codex CLI backend for CASCADE.
 *
 * Uses `codex exec` in JSONL mode and a conservative event parser so the engine
 * remains robust across Codex CLI upgrades. The product surface is intentionally
 * stable even though the runtime transport can evolve later.
 */
export class CodexEngine implements AgentEngine {
	readonly definition = CODEX_ENGINE_DEFINITION;

	/** Stores the original auth JSON so afterExecute can detect token refreshes. */
	private _originalAuthJson: string | undefined;
	/** True when beforeExecute has been called (adapter lifecycle is active). */
	private _adapterLifecycleActive = false;

	supportsAgentType(_agentType: string): boolean {
		return true;
	}

	resolveModel(cascadeModel: string): string {
		return resolveCodexModel(cascadeModel);
	}

	getSettingsSchema() {
		return CodexSettingsSchema;
	}

	async beforeExecute(plan: AgentExecutionPlan): Promise<void> {
		this._adapterLifecycleActive = true;
		this._originalAuthJson = await writeCodexAuthFile(plan.projectSecrets, plan.logWriter);
	}

	async afterExecute(plan: AgentExecutionPlan, _result: AgentEngineResult): Promise<void> {
		await captureRefreshedToken(plan.project.id, this._originalAuthJson, plan.logWriter);
		await cleanupContextFiles(plan.repoDir);
		this._originalAuthJson = undefined;
		this._adapterLifecycleActive = false;
	}

	/** Remove temp file created by execute() — best-effort, ignores errors. */
	private static _cleanupLastMessagePath(path: string): void {
		if (existsSync(path)) {
			try {
				unlinkSync(path);
			} catch {
				// Best-effort cleanup
			}
		}
	}

	/** Cleanup called from execute() finally block when adapter lifecycle is not active. */
	private async _directCallCleanup(
		repoDir: string,
		projectId: string | undefined,
		originalAuthJson: string | undefined,
		logWriter: AgentExecutionPlan['logWriter'],
		hasOffloadedContext: boolean,
	): Promise<void> {
		if (hasOffloadedContext) {
			await cleanupContextFiles(repoDir);
		}
		if (projectId) {
			await captureRefreshedToken(projectId, originalAuthJson, logWriter);
		}
	}

	async execute(input: AgentExecutionPlan): Promise<AgentEngineResult> {
		const startTime = Date.now();
		const systemPrompt = buildSystemPrompt(input.systemPrompt, input.availableTools);
		const { prompt: taskPrompt, hasOffloadedContext } = await buildTaskPrompt(
			input.taskPrompt,
			input.contextInjections,
			input.repoDir,
		);
		// Resolve model again here for backward compatibility: execute() may be called
		// directly (e.g. in tests) without going through the adapter, so we cannot rely
		// solely on the adapter's engine.resolveModel() pre-resolution. Since
		// resolveCodexModel() is idempotent, calling it twice via the normal adapter path
		// is safe.
		const model = resolveCodexModel(input.model);
		const settings = resolveCodexSettings(input.project, input.nativeToolCapabilities);
		assertHeadlessCodexSettings(settings);

		// When called via adapter, beforeExecute already wrote the auth file.
		// When called directly (e.g. tests), write it here for backward compatibility.
		const originalAuthJson = this._adapterLifecycleActive
			? this._originalAuthJson
			: await writeCodexAuthFile(input.projectSecrets, input.logWriter);

		// Strip CODEX_AUTH_JSON from env — it's written to disk, not passed to the subprocess
		const strippedSecrets: Record<string, string> | undefined = input.projectSecrets
			? Object.fromEntries(
					Object.entries(input.projectSecrets).filter(([k]) => k !== 'CODEX_AUTH_JSON'),
				)
			: undefined;

		const lastMessagePath = join(
			tmpdir(),
			`cascade-codex-last-message-${process.pid}-${Date.now()}.txt`,
		);
		const prompt = buildPrompt(systemPrompt, taskPrompt);
		const env = buildEnv(strippedSecrets, input.cliToolsDir, input.nativeToolShimDir);
		const args = buildArgs(input, settings, model, lastMessagePath);

		input.logWriter('INFO', 'Starting Codex execution', {
			agentType: input.agentType,
			model,
			repoDir: input.repoDir,
			maxIterations: input.maxIterations,
			sandboxMode: settings.sandboxMode,
			approvalPolicy: settings.approvalPolicy,
			hasOffloadedContext,
		});

		appendEngineLog(
			input.engineLogPath,
			`$ codex ${args.map((arg) => JSON.stringify(arg)).join(' ')}\n`,
		);

		let iterationCount = 0;
		let llmCallCount = 0;
		let cost: number | undefined;
		const rawTextParts: string[] = [];
		const stderrChunks: string[] = [];
		let finalError: string | undefined;

		try {
			const exitCode = await new Promise<number>((resolve, reject) => {
				const child = spawn('codex', args, {
					cwd: input.repoDir,
					env,
					stdio: ['pipe', 'pipe', 'pipe'],
				});
				let lineQueue = Promise.resolve();
				let streamFailed = false;
				const lineContext: CodexLineContext = {
					input,
					model,
					maxIterations: input.maxIterations,
					rawTextParts,
					iterationCount,
					llmCallCount,
					cost,
					finalError,
					currentTurn: { textSummary: [], toolNames: [], usage: null },
				};

				child.once('error', (error) => {
					reject(
						error instanceof Error && 'code' in error && error.code === 'ENOENT'
							? new Error(
									'Codex CLI not found in PATH. Install `@openai/codex` in the worker image.',
								)
							: error,
					);
				});

				const stdout = createInterface({ input: child.stdout });
				stdout.on('line', (line) => {
					lineQueue = lineQueue
						.then(() => processStdoutLine(lineContext, line))
						.catch((error) => {
							streamFailed = true;
							reject(error);
						});
				});

				child.stderr.on('data', (chunk: Buffer | string) => {
					const text = chunk.toString();
					stderrChunks.push(text);
					appendEngineLog(input.engineLogPath, text);
					const trimmed = text.trim();
					if (trimmed) input.logWriter('DEBUG', 'Codex stderr', { stderr: trimmed });
				});

				child.stdin.write(prompt);
				child.stdin.end();

				child.once('close', (code) => {
					void lineQueue
						.then(() => {
							iterationCount = lineContext.iterationCount;
							llmCallCount = lineContext.llmCallCount;
							cost = lineContext.cost;
							finalError = lineContext.finalError;
							if (!streamFailed) {
								resolve(code ?? 1);
							}
						})
						.catch(reject);
				});
			});

			const finalOutput =
				existsSync(lastMessagePath) && readFileSync(lastMessagePath, 'utf-8').trim()
					? readFileSync(lastMessagePath, 'utf-8').trim()
					: rawTextParts.join('\n').trim();
			const stderrOutput = stderrChunks.join('').trim();
			const prUrl = extractPRUrl(finalOutput) ?? extractPRUrl(rawTextParts.join('\n'));
			const prEvidence = prUrl
				? {
						source: 'text' as const,
						authoritative: false,
					}
				: undefined;

			input.logWriter('DEBUG', 'Codex process exited', {
				exitCode,
				iterationCount,
				llmCallCount,
				finalOutputLength: finalOutput.length,
			});

			if (stderrOutput) {
				input.logWriter('WARN', 'Codex stderr output', { stderr: stderrOutput });
			}

			if (exitCode !== 0) {
				return {
					success: false,
					output: finalOutput,
					error: finalError ?? stderrOutput ?? `Codex exited with code ${exitCode}`,
					cost,
					prUrl,
					prEvidence,
				};
			}

			input.logWriter('INFO', 'Codex execution completed', {
				turns: iterationCount,
				cost: cost ?? null,
				prUrl: prUrl ?? null,
				durationMs: Date.now() - startTime,
			});

			return {
				success: true,
				output: finalOutput,
				cost,
				prUrl,
				prEvidence,
			};
		} finally {
			CodexEngine._cleanupLastMessagePath(lastMessagePath);
			// When called directly (not via adapter), afterExecute won't be invoked.
			// Perform cleanup here so direct callers (e.g. tests) still behave correctly.
			if (!this._adapterLifecycleActive) {
				await this._directCallCleanup(
					input.repoDir,
					input.project.id,
					originalAuthJson,
					input.logWriter,
					hasOffloadedContext,
				);
			}
		}
	}
}

export { resolveCodexModel, extractErrorMessage, extractToolCall, extractTextParts, extractUsage };
