import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { writeProjectCredential } from '../../db/repositories/credentialsRepository.js';
import { CODEX_ENGINE_DEFINITION } from '../catalog.js';
import { NativeToolEngine } from '../shared/NativeToolEngine.js';
import { cleanupContextFiles } from '../shared/contextFiles.js';
import { appendEngineLog } from '../shared/engineLog.js';
import { buildEngineResult, extractAndBuildPrEvidence } from '../shared/engineResult.js';
import { SHARED_ALLOWED_ENV_EXACT } from '../shared/envFilter.js';
import { logLlmCall } from '../shared/llmCallLogger.js';
import { buildSystemPrompt, buildTaskPrompt } from '../shared/nativeToolPrompts.js';
import type { AgentEngineResult, AgentExecutionPlan, LogWriter } from '../types.js';
import { extractUsage, parseCodexEvent } from './jsonlParser.js';
import type { UsageSummary } from './jsonlParser.js';
import { CODEX_MODEL_IDS, DEFAULT_CODEX_MODEL } from './models.js';
import {
	CodexSettingsSchema,
	assertHeadlessCodexSettings,
	resolveCodexSettings,
} from './settings.js';

const CODEX_AUTH_DIR = join(homedir(), '.codex');
const CODEX_AUTH_FILE = join(CODEX_AUTH_DIR, 'auth.json');

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
			// Squint
			'SQUINT_DB_PATH',
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

export { resolveCodexModel };
export {
	extractErrorMessage,
	extractToolCall,
	extractTextParts,
	extractUsage,
} from './jsonlParser.js';
