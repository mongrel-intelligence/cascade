import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import {
	findCredentialIdByEnvVarKey,
	updateCredential,
} from '../../db/repositories/credentialsRepository.js';
import { storeLlmCall } from '../../db/repositories/runsRepository.js';
import { logger } from '../../utils/logging.js';
import { extractPRUrl } from '../../utils/prUrl.js';
import { CODEX_ENGINE_DEFINITION } from '../catalog.js';
import { cleanupContextFiles } from '../contextFiles.js';
import { buildSystemPrompt, buildTaskPrompt } from '../nativeTools.js';
import type { AgentEngine, AgentEngineResult, AgentExecutionPlan, LogWriter } from '../types.js';
import { buildEnv } from './env.js';
import { CODEX_MODEL_IDS, DEFAULT_CODEX_MODEL } from './models.js';
import { assertHeadlessCodexSettings, resolveCodexSettings } from './settings.js';

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
	costUsd?: number;
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

/** Parses a Responses API function_call item into a ToolCall. */
function parseFunctionCallItem(item: unknown): ToolCall | null {
	if (!item || typeof item !== 'object') return null;
	const rec = item as JsonRecord;
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
	const costUsd =
		typeof event.total_cost_usd === 'number'
			? event.total_cost_usd
			: typeof event.cost_usd === 'number'
				? event.cost_usd
				: typeof usage?.cost_usd === 'number'
					? usage.cost_usd
					: undefined;

	return inputTokens !== undefined || outputTokens !== undefined || costUsd !== undefined
		? { inputTokens, outputTokens, costUsd }
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

function trackUsage(context: CodexLineContext, responseLine: string, usage: UsageSummary): void {
	context.cost = usage.costUsd ?? context.cost;
	if (!context.input.runId) return;

	context.llmCallCount += 1;
	void storeLlmCall({
		runId: context.input.runId,
		callNumber: context.llmCallCount,
		request: undefined,
		response: responseLine,
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		cachedTokens: undefined,
		costUsd: usage.costUsd,
		durationMs: undefined,
		model: context.model,
	}).catch((error) => {
		logger.warn('Failed to store Codex LLM call in real-time', {
			runId: context.input.runId,
			call: context.llmCallCount,
			error: String(error),
		});
	});
}

async function handleParsedLine(
	context: CodexLineContext,
	responseLine: string,
	parsed: JsonRecord,
): Promise<void> {
	const { textParts, toolCall, usage, error } = parseCodexEvent(parsed);

	if (textParts.length > 0 || toolCall) {
		await trackIteration(context);
	}

	for (const text of textParts) {
		logText(context, text);
	}

	if (toolCall) {
		context.input.progressReporter.onToolCall(toolCall.name, toolCall.input);
	}

	if (usage) {
		trackUsage(context, responseLine, usage);
	}

	if (error) {
		context.finalError = error;
		context.input.logWriter('WARN', 'Codex error event', { error });
	}

	if (textParts.length === 0 && !toolCall && !usage && !error) {
		context.input.logWriter('DEBUG', 'Unrecognized Codex event type — no fields extracted', {
			type: typeof parsed.type === 'string' ? parsed.type : '(none)',
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

	await handleParsedLine(context, line, parsed);
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
 * After a Codex run, read ~/.codex/auth.json and update the DB credential if
 * the Codex CLI refreshed the access token during the run.
 */
async function captureRefreshedToken(
	orgId: string,
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
		const credId = await findCredentialIdByEnvVarKey(orgId, 'CODEX_AUTH_JSON');
		if (!credId) {
			logWriter(
				'WARN',
				'Could not find CODEX_AUTH_JSON credential to update after token refresh',
				{},
			);
			return;
		}
		await updateCredential(credId, { value: newJson });
		logWriter('INFO', 'Captured refreshed Codex auth token and updated DB credential', {});
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

	supportsAgentType(_agentType: string): boolean {
		return true;
	}

	async execute(input: AgentExecutionPlan): Promise<AgentEngineResult> {
		const startTime = Date.now();
		const systemPrompt = buildSystemPrompt(input.systemPrompt, input.availableTools);
		const { prompt: taskPrompt, hasOffloadedContext } = await buildTaskPrompt(
			input.taskPrompt,
			input.contextInjections,
			input.repoDir,
		);
		const model = resolveCodexModel(input.model);
		const settings = resolveCodexSettings(input.project, input.nativeToolCapabilities);
		assertHeadlessCodexSettings(settings);

		const originalAuthJson = await writeCodexAuthFile(input.projectSecrets, input.logWriter);

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
			if (existsSync(lastMessagePath)) {
				try {
					unlinkSync(lastMessagePath);
				} catch {
					// Best-effort cleanup
				}
			}
			if (hasOffloadedContext) {
				await cleanupContextFiles(input.repoDir);
			}
			await captureRefreshedToken(input.project.orgId, originalAuthJson, input.logWriter);
		}
	}
}

export { resolveCodexModel, extractErrorMessage, extractToolCall, extractTextParts, extractUsage };
