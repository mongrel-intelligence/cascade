import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { writeProjectCredential } from '../../db/repositories/credentialsRepository.js';
import { calculateCost } from '../../utils/llmMetrics.js';
import { CODEX_ENGINE_DEFINITION } from '../catalog.js';
import { cleanupContextFiles } from '../shared/contextFiles.js';
import { appendEngineLog } from '../shared/engineLog.js';
import { buildEngineResult, extractAndBuildPrEvidence } from '../shared/engineResult.js';
import { SHARED_ALLOWED_ENV_EXACT } from '../shared/envFilter.js';
import { logLlmCall } from '../shared/llmCallLogger.js';
import { NativeToolEngine } from '../shared/NativeToolEngine.js';
import { buildSystemPrompt, buildTaskPrompt } from '../shared/nativeToolPrompts.js';
import type { AgentEngineResult, AgentExecutionPlan, LogWriter } from '../types.js';
import type { UsageSummary } from './jsonlParser.js';
import { extractUsage, parseCodexEvent } from './jsonlParser.js';
import { CODEX_MODEL_IDS, DEFAULT_CODEX_MODEL } from './models.js';
import {
	assertHeadlessCodexSettings,
	CodexSettingsSchema,
	resolveCodexSettings,
} from './settings.js';

const CODEX_AUTH_DIR = join(homedir(), '.codex');
const CODEX_AUTH_FILE = join(CODEX_AUTH_DIR, 'auth.json');

/**
 * Codex's persistent-bash-session corruption signal. When this stderr message
 * appears, codex's `tools::router` has lost its long-lived bash session, and
 * every subsequent command in the run inherits a stale stdout buffer. Treat
 * any presence of this signal as a fatal run-level error so ops retry
 * against a fresh session instead of trusting potentially-corrupted state.
 *
 * Source: prod runs 8b000cd6 + d8e31665 (cascade/implementation/codex,
 * 2026-05-09). Both runs continued executing after the signal and produced
 * silent failures with missing sidecars and bled-over command output.
 */
const SHELL_CORRUPTED_RE = /codex_core::tools::router:\s*error=write_stdin failed: stdin is closed/;

type JsonRecord = Record<string, unknown>;
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

/**
 * Run-level cumulative usage high-water mark.
 *
 * `codex exec --json` emits `usage` on every `turn.completed` as the CUMULATIVE
 * session total — NOT a per-turn delta (upstream openai/codex#17539). We track
 * the previous cumulative here so each turn persists its DELTA, not the running
 * total. Without this, a 10-turn run with 100k tokens each would persist
 * {100k, 200k, 300k, ...} = 5.5M summed instead of the true 1M.
 *
 * Reset/init: all zeros at the start of a run. Never reset per-turn.
 */
type CodexCumulativeUsage = {
	inputTokens: number;
	outputTokens: number;
	cachedTokens: number;
	reasoningTokens: number;
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
	/** Previous turn's cumulative usage — used to compute per-turn deltas. */
	cumulativeUsage: CodexCumulativeUsage;
};

function tomlString(value: string): string {
	return JSON.stringify(value);
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
		if (usage.reasoningTokens !== undefined) acc.usage.reasoningTokens = usage.reasoningTokens;
	}
}

/**
 * Compute the per-turn delta against the run-level cumulative high-water mark,
 * then advance the high-water mark. Returns the delta. Clamps to 0 on out-of-order
 * events (cumulative goes backwards) and logs a WARN.
 *
 * Upstream codex emits the SESSION-WIDE cumulative on every turn.completed (see
 * openai/codex#17539). The delta is what we want to persist per-turn-row so that
 * dashboard aggregations sum correctly.
 */
function computeTurnDelta(context: CodexLineContext, usage: UsageSummary): CodexCumulativeUsage {
	const prev = context.cumulativeUsage;
	const curr: CodexCumulativeUsage = {
		inputTokens: usage.inputTokens ?? prev.inputTokens,
		outputTokens: usage.outputTokens ?? prev.outputTokens,
		cachedTokens: usage.cachedTokens ?? prev.cachedTokens,
		reasoningTokens: usage.reasoningTokens ?? prev.reasoningTokens,
	};
	const delta: CodexCumulativeUsage = {
		inputTokens: Math.max(0, curr.inputTokens - prev.inputTokens),
		outputTokens: Math.max(0, curr.outputTokens - prev.outputTokens),
		cachedTokens: Math.max(0, curr.cachedTokens - prev.cachedTokens),
		reasoningTokens: Math.max(0, curr.reasoningTokens - prev.reasoningTokens),
	};

	if (
		curr.inputTokens < prev.inputTokens ||
		curr.outputTokens < prev.outputTokens ||
		curr.cachedTokens < prev.cachedTokens ||
		curr.reasoningTokens < prev.reasoningTokens
	) {
		context.input.logWriter(
			'WARN',
			'Codex turn.completed reported lower cumulative usage than previous turn — clamping delta to 0',
			{ prev, curr },
		);
		// Return all-zero delta — discard the entire backwards event rather than
		// persisting partial positive fields (e.g. outputTokens increased while
		// inputTokens went backwards). The high-water mark stays at `prev` so
		// the next valid cumulative is correctly subtracted from the last known
		// good baseline; without this, any positive per-field delta from the
		// discarded event would be double-counted on the following valid event.
		return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 };
	}

	context.cumulativeUsage = curr;
	return delta;
}

/**
 * Persist exactly one storeLlmCall row for the completed turn, then reset the accumulator.
 * Called only from turn.completed to guarantee one row per turn, never from intermediate events.
 *
 * Cost = calculateCost('openai:<model>', delta) — Codex never emits cost_usd
 * upstream (openai/codex#17539), so cost is always computed CASCADE-side from
 * the per-turn token DELTA × the pricing table at src/utils/llmMetrics.ts.
 *
 * Reasoning tokens: OpenAI/Codex treats `reasoning_output_tokens` as a
 * breakdown/subset of `output_tokens` — NOT an additional counter. A turn
 * with `output_tokens: 47, reasoning_output_tokens: 41` has 47 total output
 * tokens (41 of which are reasoning). We store the reasoning count separately
 * in the response payload for observability, but billing always uses
 * `delta.outputTokens` as-is (it already includes reasoning).
 */
function persistTurnLlmCall(context: CodexLineContext): void {
	const acc = context.currentTurn;
	const usage = acc.usage;
	context.llmCallCount += 1;

	let delta: CodexCumulativeUsage | null = null;
	let costUsd: number | undefined;
	let outputForRow: number | undefined;

	if (usage) {
		delta = computeTurnDelta(context, usage);
		// Use delta.outputTokens directly — reasoning_output_tokens is already
		// counted within output_tokens (it is a breakdown, not an extra counter).
		outputForRow = delta.outputTokens;
		const turnCost = calculateCost(`openai:${context.model}`, {
			inputTokens: delta.inputTokens,
			outputTokens: delta.outputTokens,
			totalTokens: delta.inputTokens + delta.outputTokens,
			cachedInputTokens: delta.cachedTokens,
		});
		if (turnCost > 0) {
			costUsd = turnCost;
			context.cost = (context.cost ?? 0) + turnCost;
		}
	}

	const turnPayload = JSON.stringify({
		turn: context.llmCallCount,
		text: acc.textSummary.join(' ').slice(0, 500) || undefined,
		tools: acc.toolNames.length > 0 ? acc.toolNames : undefined,
		usage: usage ?? undefined,
		delta: delta ?? undefined,
		// Reasoning breakdown preserved for observability; it is already counted
		// within outputTokens above and must NOT be added to it for billing.
		reasoning: delta && delta.reasoningTokens > 0 ? delta.reasoningTokens : undefined,
	});

	logLlmCall({
		runId: context.input.runId,
		callNumber: context.llmCallCount,
		model: context.model,
		inputTokens: delta?.inputTokens,
		outputTokens: outputForRow,
		cachedTokens: delta?.cachedTokens,
		costUsd,
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
	// Accept openai: prefix as a convenience shorthand (e.g. "openai:gpt-5.4").
	// Only resolve to a known Codex model ID — the old gpt-*codex* wildcard was
	// removed because unrecognised model IDs have no pricing row in MODEL_PRICING
	// and would silently persist zero cost. Add new models to CODEX_MODEL_IDS in
	// src/backends/codex/models.ts AND add a pricing row to MODEL_PRICING in
	// src/utils/llmMetrics.ts before accepting them here.
	if (cascadeModel.startsWith('openai:')) {
		const bareId = cascadeModel.replace('openai:', '');
		if (CODEX_MODEL_IDS.includes(bareId)) return bareId;
	}

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
 * Inspect stderr for the SHELL_CORRUPTED signal and decide the outcome.
 *
 * The signal can fire mid-work (corruption masks real output → fail) or
 * at session-close (real work already captured → success-with-warning).
 * Discriminator: if `prUrl` is set and `finalOutput` is non-empty, the
 * agent emitted real artifacts before the signal fired. See MNG-718
 * (run f801342b, 2026-05-11) for the late-corruption prod case.
 *
 * Returns the failure `AgentEngineResult` to surface, or `null` when
 * the run should continue through the normal success path (either no
 * signal present, or signal fired after success evidence was captured).
 */
function classifyShellCorruption(
	stderrOutput: string,
	exitCode: number,
	prUrl: string | undefined,
	prEvidence: ReturnType<typeof extractAndBuildPrEvidence>['prEvidence'],
	finalOutput: string,
	cost: number | undefined,
	logWriter: LogWriter,
): AgentEngineResult | null {
	if (exitCode !== 0 || !SHELL_CORRUPTED_RE.test(stderrOutput)) return null;

	const hasSuccessEvidence = !!prUrl && finalOutput.length > 0;
	if (hasSuccessEvidence) {
		logWriter(
			'WARN',
			'Codex shell-state corruption signal fired after success evidence captured — treating as success-with-warning',
			{
				stderr: stderrOutput.slice(-500),
				prUrl,
				finalOutputLength: finalOutput.length,
				hint: 'PR was created and final output captured before the corruption signal; verify the PR manually if anything looks off',
			},
		);
		return null;
	}

	logWriter('ERROR', 'Codex shell-state corrupted (write_stdin closed) — failing run', {
		stderr: stderrOutput,
		hint: 'codex_core::tools::router lost its persistent bash session; subsequent commands may have inherited stale state',
	});
	return buildEngineResult({
		success: false,
		output: finalOutput,
		error: 'codex shell-state corrupted: write_stdin failed (stdin closed for session)',
		cost,
		prUrl,
		prEvidence,
	});
}

/**
 * Codex CLI backend for CASCADE.
 *
 * Uses `codex exec` in JSONL mode and a conservative event parser so the engine
 * remains robust across Codex CLI upgrades. The product surface is intentionally
 * stable even though the runtime transport can evolve later.
 *
 * Extends NativeToolEngine to share subprocess env-building, supportsAgentType(),
 * resolveModel() delegation, and base afterExecute() context cleanup.
 */
export class CodexEngine extends NativeToolEngine {
	readonly definition = CODEX_ENGINE_DEFINITION;

	/** Stores the original auth JSON so afterExecute can detect token refreshes. */
	private _originalAuthJson: string | undefined;
	/** True when beforeExecute has been called (adapter lifecycle is active). */
	private _adapterLifecycleActive = false;

	// -------------------------------------------------------------------------
	// NativeToolEngine abstract method implementations
	// -------------------------------------------------------------------------

	getAllowedEnvExact(): Set<string> {
		return new Set([
			...SHARED_ALLOWED_ENV_EXACT,
			// Codex auth
			'OPENAI_API_KEY',
		]);
	}

	getExtraEnvVars(): Record<string, string> {
		return {
			CI: 'true',
			CODEX_DISABLE_UPDATE_NOTIFIER: '1',
		};
	}

	resolveEngineModel(cascadeModel: string): string {
		return resolveCodexModel(cascadeModel);
	}

	// -------------------------------------------------------------------------
	// Engine-specific methods
	// -------------------------------------------------------------------------

	getSettingsSchema() {
		return CodexSettingsSchema;
	}

	async beforeExecute(plan: AgentExecutionPlan): Promise<void> {
		this._adapterLifecycleActive = true;
		this._originalAuthJson = await writeCodexAuthFile(plan.projectSecrets, plan.logWriter);
	}

	/**
	 * Calls super.afterExecute() for context file cleanup, then captures any
	 * refreshed Codex auth token back to the project credentials.
	 */
	async afterExecute(plan: AgentExecutionPlan, result: AgentEngineResult): Promise<void> {
		await super.afterExecute(plan, result);
		await captureRefreshedToken(plan.project.id, this._originalAuthJson, plan.logWriter);
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
		// resolveCodexModel() is idempotent; calling it here ensures execute() works when
		// invoked directly (e.g. in tests) without going through the adapter.
		const model = resolveCodexModel(input.model);
		const settings = resolveCodexSettings(
			input.project,
			input.nativeToolCapabilities,
			input.engineSettings,
		);
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
		const env = this.buildEnv(strippedSecrets, input.cliToolsDir, input.nativeToolShimDir);
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
					cumulativeUsage: {
						inputTokens: 0,
						outputTokens: 0,
						cachedTokens: 0,
						reasoningTokens: 0,
					},
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
			let { prUrl, prEvidence } = extractAndBuildPrEvidence(finalOutput);
			if (!prUrl) {
				({ prUrl, prEvidence } = extractAndBuildPrEvidence(rawTextParts.join('\n')));
			}

			input.logWriter('DEBUG', 'Codex process exited', {
				exitCode,
				iterationCount,
				llmCallCount,
				finalOutputLength: finalOutput.length,
			});

			if (stderrOutput) {
				input.logWriter('WARN', 'Codex stderr output', { stderr: stderrOutput });
			}

			// Prod regression 2026-05-09 (runs 8b000cd6, d8e31665): codex's
			// persistent bash session breaks with `ERROR
			// codex_core::tools::router: error=write_stdin failed: stdin is
			// closed for this session`. Once that signal fires, every
			// subsequent command in the session inherits a corrupted stdout
			// buffer (lint output from one command bleeding into the next,
			// sidecar writes racing). We observed this leading to silent run
			// failures with PR-creation evidence missing despite a real PR
			// existing on GitHub. Codex itself exits cleanly (exit=0) — the
			// stderr signal is the only evidence the session was corrupted.
			//
			// MNG-718 follow-up (run f801342b, 2026-05-11): the signal can
			// also fire LATE, at session-close, after all real work has been
			// captured. That run opened PR #1350, ran the full verification
			// suite, and filed a follow-up friction ticket — yet was marked
			// failed, costing cascade the post-completion review dispatch
			// and surfacing a misleading "agent failed" comment. Split the
			// two cases by whether success evidence (prUrl + finalOutput)
			// was captured before the signal: late → WARN + success, early
			// → ERROR + fail.
			const shellCorruptionResult = classifyShellCorruption(
				stderrOutput,
				exitCode,
				prUrl,
				prEvidence,
				finalOutput,
				cost,
				input.logWriter,
			);
			if (shellCorruptionResult) return shellCorruptionResult;

			if (exitCode !== 0) {
				return buildEngineResult({
					success: false,
					output: finalOutput,
					error: finalError ?? stderrOutput ?? `Codex exited with code ${exitCode}`,
					cost,
					prUrl,
					prEvidence,
				});
			}

			input.logWriter('INFO', 'Codex execution completed', {
				turns: iterationCount,
				cost: cost ?? null,
				prUrl: prUrl ?? null,
				durationMs: Date.now() - startTime,
			});

			return buildEngineResult({
				success: true,
				output: finalOutput,
				cost,
				prUrl,
				prEvidence,
			});
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

export {
	extractErrorMessage,
	extractTextParts,
	extractToolCall,
	extractUsage,
} from './jsonlParser.js';
export { resolveCodexModel };
