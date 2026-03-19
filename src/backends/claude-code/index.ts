import { randomUUID } from 'node:crypto';
import { constants, accessSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
	SDKAssistantMessage,
	SDKResultMessage,
	SDKResultSuccess,
	SDKStatusMessage,
	SDKSystemMessage,
	SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { getEngineSettings } from '../../config/engineSettings.js';
import { logger } from '../../utils/logging.js';
import { extractPRUrl } from '../../utils/prUrl.js';
import { getWorkspaceDir } from '../../utils/repo.js';
import { CLAUDE_CODE_ENGINE_DEFINITION } from '../catalog.js';
import {
	type CompletionRequirements,
	applyCompletionEvidence,
	getCompletionFailure,
	readCompletionEvidence,
} from '../completion.js';
import { cleanupContextFiles } from '../shared/contextFiles.js';
import { buildEngineResult, extractAndBuildPrEvidence } from '../shared/engineResult.js';
import { logLlmCall } from '../shared/llmCallLogger.js';
import { buildSystemPrompt, buildTaskPrompt } from '../shared/nativeToolPrompts.js';
import type { AgentEngine, AgentEngineResult, AgentExecutionPlan, ContextImage } from '../types.js';
import { buildClaudeEnv } from './env.js';
import { buildHooks } from './hooks.js';
import { CLAUDE_CODE_MODEL_IDS, DEFAULT_CLAUDE_CODE_MODEL } from './models.js';
import { ClaudeCodeSettingsSchema, resolveClaudeCodeSettings } from './settings.js';

export {
	buildToolGuidance,
	buildTaskPrompt,
	buildSystemPrompt,
} from '../shared/nativeToolPrompts.js';
export { buildClaudeEnv as buildEnv } from './env.js';

/**
 * Resolve a CASCADE model string to a Claude model ID.
 *
 * CASCADE config uses prefixed model names (e.g., 'openrouter:google/gemini-3-flash-preview').
 * The Claude Code SDK expects Anthropic model IDs.
 */
export function resolveClaudeModel(cascadeModel: string): string {
	if (CLAUDE_CODE_MODEL_IDS.includes(cascadeModel)) return cascadeModel;
	if (cascadeModel.startsWith('claude-')) return cascadeModel;
	if (cascadeModel.startsWith('anthropic:')) return cascadeModel.replace('anthropic:', '');

	throw new Error(
		`Model "${cascadeModel}" is not compatible with the Claude Code engine. Configure a Claude-compatible model (e.g. "${DEFAULT_CLAUDE_CODE_MODEL}") or switch to a different engine.`,
	);
}

/**
 * Ensure $HOME/.claude.json exists with the onboarding flag.
 * Claude Code CLI requires this file to skip interactive onboarding
 * in headless environments, regardless of auth method (API key or subscription).
 */
export function ensureOnboardingFlag(): void {
	const homeDir = process.env.HOME ?? '/home/node';
	const claudeJsonPath = path.join(homeDir, '.claude.json');
	if (!existsSync(claudeJsonPath)) {
		writeFileSync(claudeJsonPath, JSON.stringify({ hasCompletedOnboarding: true }), {
			mode: 0o600,
		});
	}
}

const CLAUDE_SUPPORTED_IMAGE_TYPES = new Set([
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
function filterContextImages(
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
function extractPRUrlFromMessages(assistantMessages: SDKAssistantMessage[]): string | undefined {
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
function extractCommentFromBlock(block: { type: string; name?: string; input?: unknown }):
	| string
	| undefined {
	if (block.type !== 'tool_use' || block.name !== 'Bash') return undefined;
	const { command } = block.input as { command?: string };
	if (!command?.includes('cascade-tools') || !command?.includes('session finish')) return undefined;
	const match = command.match(/--comment\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
	return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

/**
 * Extract finish comment from assistant messages that invoked cascade-tools session finish.
 */
function extractFinishComment(assistantMessages: SDKAssistantMessage[]): string | undefined {
	for (const msg of assistantMessages) {
		if (!msg.message?.content) continue;
		for (const block of msg.message.content) {
			const comment = extractCommentFromBlock(block);
			if (comment) return comment;
		}
	}
	return undefined;
}

/**
 * Process an assistant message: report progress, log text/errors/usage.
 */
function processAssistantMessage(
	assistantMsg: SDKAssistantMessage,
	turnCount: number,
	input: AgentExecutionPlan,
): void {
	if (assistantMsg.message?.content) {
		for (const block of assistantMsg.message.content) {
			if (block.type === 'tool_use') {
				input.progressReporter.onToolCall(block.name, block.input as Record<string, unknown>);
			}
			if (block.type === 'text') {
				const truncated = block.text.length > 300 ? `${block.text.slice(0, 300)}...` : block.text;
				input.logWriter('INFO', 'Agent text', { text: truncated });
				input.progressReporter.onText(block.text);
			}
		}
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
		});
	}
}

/**
 * Process a system message: log init and status events.
 */
function processSystemMessage(
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
function buildResult(
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
	const prEvidence = extractAndBuildPrEvidence(prUrl ?? '').prEvidence;

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

/**
 * Process a task_notification system message: log and report completed tasks.
 */
function processTaskNotification(
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

function debugRepoDirectory(repoDir: string): void {
	const repoDirExists = existsSync(repoDir);
	let repoDirReadable = false;
	let repoDirEntries: string[] = [];
	try {
		accessSync(repoDir, constants.R_OK | constants.X_OK);
		repoDirReadable = true;
		repoDirEntries = readdirSync(repoDir).slice(0, 15);
	} catch {}
	const repoDirStat = repoDirExists ? statSync(repoDir) : null;
	logger.info('Claude Code pre-launch directory check', {
		repoDir,
		exists: repoDirExists,
		readable: repoDirReadable,
		isDirectory: repoDirStat?.isDirectory() ?? false,
		uid: repoDirStat?.uid,
		gid: repoDirStat?.gid,
		mode: repoDirStat ? `0${(repoDirStat.mode & 0o777).toString(8)}` : null,
		entries: repoDirEntries,
		processCwd: process.cwd(),
		workspaceDir: getWorkspaceDir(),
	});

	if (!repoDirExists || !repoDirReadable) {
		logger.error('Repo directory not accessible — Claude Code will likely fail', {
			repoDir,
			exists: repoDirExists,
			readable: repoDirReadable,
		});
	}
}

const CLAUDE_NATIVE_TOOL_MAP: Record<string, string[]> = {
	'fs:read': ['Read', 'Glob', 'Grep'],
	'fs:write': ['Write', 'Edit'],
	'shell:exec': ['Bash'],
};

function resolveNativeTools(nativeToolCapabilities?: string[]): string[] {
	if (!nativeToolCapabilities || nativeToolCapabilities.length === 0) {
		return ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];
	}

	const tools = new Set<string>();
	for (const capability of nativeToolCapabilities) {
		for (const tool of CLAUDE_NATIVE_TOOL_MAP[capability] ?? []) {
			tools.add(tool);
		}
	}

	return tools.size > 0 ? [...tools] : ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];
}

/**
 * Map raw Claude Code engine settings to SDK query options.
 * Only settings that are explicitly configured are returned; undefined fields
 * are omitted to preserve SDK defaults.
 */
function buildSettingsOptions(rawSettings: {
	effort?: 'low' | 'medium' | 'high' | 'max';
	thinking?: 'adaptive' | 'enabled' | 'disabled';
	thinkingBudgetTokens?: number;
}): {
	effort?: 'low' | 'medium' | 'high' | 'max';
	thinking?:
		| { type: 'adaptive' }
		| { type: 'enabled'; budgetTokens: number }
		| { type: 'disabled' };
	maxThinkingTokens?: number;
} {
	const result: ReturnType<typeof buildSettingsOptions> = {};

	if (rawSettings.effort !== undefined) {
		result.effort = rawSettings.effort;
	}

	if (rawSettings.thinking !== undefined) {
		if (rawSettings.thinking === 'enabled') {
			result.thinking = {
				type: 'enabled',
				budgetTokens: rawSettings.thinkingBudgetTokens ?? 10_000,
			};
		} else if (rawSettings.thinking === 'disabled') {
			result.thinking = { type: 'disabled' };
		} else {
			result.thinking = { type: 'adaptive' };
		}
	} else if (rawSettings.thinkingBudgetTokens !== undefined) {
		// No explicit thinking mode — pass budget via deprecated maxThinkingTokens
		result.maxThinkingTokens = rawSettings.thinkingBudgetTokens;
	}

	return result;
}

function logClaudeCodeLlmCall(
	input: AgentExecutionPlan,
	assistantMsg: SDKAssistantMessage,
	turnCount: number,
	model: string,
): void {
	if (!assistantMsg.message?.usage) return;

	const usage = assistantMsg.message.usage;
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
		inputTokens: usage.input_tokens,
		outputTokens: usage.output_tokens,
		cachedTokens: undefined,
		costUsd: undefined,
		response,
		engineLabel: 'Claude Code',
	});
}

function countToolCalls(assistantMsg: SDKAssistantMessage): number {
	return (assistantMsg.message?.content ?? []).filter((b) => b.type === 'tool_use').length;
}

/**
 * Consume the Claude Code SDK stream and collect assistant messages, result, and counters.
 * Returns the updated turn count and tool call count accumulated during this stream.
 */
async function consumeStream(
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
 * Clean up the Claude Code persisted session directory.
 * Since workers are ephemeral, there's no need to keep session data after execution.
 *
 * The SDK encodes cwd into the session directory name by replacing path separators with '-'.
 * For example, /tmp/cascade-repo-abc becomes ~/.claude/projects/-tmp-cascade-repo-abc.
 */
async function cleanupPersistedSession(repoDir: string): Promise<void> {
	const encodedDir = repoDir.replaceAll(path.sep, '-');
	const sessionDir = path.join(homedir(), '.claude', 'projects', encodedDir);
	try {
		if (existsSync(sessionDir)) {
			await rm(sessionDir, { recursive: true, force: true });
		}
	} catch {
		// Best-effort cleanup
	}
}

type ContinuationDecision =
	| { done: true; result: AgentEngineResult }
	| { done: false; promptText: string };

/**
 * Check completion requirements and decide whether to continue or return a final result.
 * Logs the continuation warning when a new turn is needed.
 */
function decideContinuation(
	result: AgentEngineResult,
	completionRequirements: CompletionRequirements | undefined,
	continuationTurns: number,
	maxContinuationTurns: number,
	totalCost: number | undefined,
	logWriter: AgentExecutionPlan['logWriter'],
	toolCallCount: number,
): ContinuationDecision {
	const completionFailure = getCompletionFailure(
		completionRequirements,
		readCompletionEvidence(completionRequirements),
	);
	if (!completionFailure) {
		return { done: true, result: { ...result, cost: totalCost } };
	}
	if (continuationTurns >= maxContinuationTurns) {
		return {
			done: true,
			result: { ...result, success: false, error: completionFailure.error, cost: totalCost },
		};
	}
	logWriter('WARN', 'Claude Code completion check failed; continuing session', {
		reason: completionFailure.error,
		continuationTurn: continuationTurns + 1,
		maxContinuationTurns,
		toolCallCount,
	});
	return { done: false, promptText: completionFailure.continuationPrompt };
}

/**
 * Claude Code SDK backend for CASCADE.
 *
 * Uses the Claude Code SDK's query() function to run agents with built-in file tools
 * (Read, Write, Edit, Bash, Glob, Grep). CASCADE's domain tools (Trello, GitHub, Session)
 * are invoked via the built-in Bash tool through the cascade-tools CLI, with usage
 * guidance injected into the system prompt.
 */
export class ClaudeCodeEngine implements AgentEngine {
	readonly definition = CLAUDE_CODE_ENGINE_DEFINITION;

	supportsAgentType(_agentType: string): boolean {
		return true;
	}

	resolveModel(cascadeModel: string): string {
		return resolveClaudeModel(cascadeModel);
	}

	getSettingsSchema() {
		return ClaudeCodeSettingsSchema;
	}

	async beforeExecute(plan: AgentExecutionPlan): Promise<void> {
		// Ensure onboarding flag exists (required for both API key and subscription auth)
		ensureOnboardingFlag();
		// Log repo directory state for debugging
		debugRepoDirectory(plan.repoDir);
	}

	async afterExecute(plan: AgentExecutionPlan, _result: AgentEngineResult): Promise<void> {
		// Clean up offloaded context files after execution
		await cleanupContextFiles(plan.repoDir);
		// Clean up persisted session directory — workers are ephemeral
		await cleanupPersistedSession(plan.repoDir);
	}

	async execute(input: AgentExecutionPlan): Promise<AgentEngineResult> {
		const startTime = Date.now();
		const systemPrompt = buildSystemPrompt(input.systemPrompt, input.availableTools);

		// Collect supported images for native SDK delivery; strip from injections so
		// offloadLargeContext does not also write them to disk (redundant for this engine).
		const supportedImages = filterContextImages(input.contextInjections, input.logWriter);
		const injectionsForPrompt = input.contextInjections.map(({ images: _images, ...rest }) => rest);

		const { prompt: taskPrompt, hasOffloadedContext } = await buildTaskPrompt(
			input.taskPrompt,
			injectionsForPrompt,
			input.repoDir,
		);
		// Resolve model again here for backward compatibility: execute() may be called
		// directly (e.g. in tests) without going through the adapter, so we cannot rely
		// solely on the adapter's engine.resolveModel() pre-resolution. Since
		// resolveClaudeModel() is idempotent, calling it twice via the normal adapter path
		// is safe.
		const model = resolveClaudeModel(input.model);
		const resolvedSettings = resolveClaudeCodeSettings(input.project, input.engineSettings);
		// Only the explicitly-configured fields (raw, pre-default) are passed to the SDK.
		// This preserves SDK defaults when no project-level settings are configured.
		// Use the merged engineSettings from the execution plan (falls back to project-level).
		const effectiveEngineSettings = input.engineSettings ?? input.project.engineSettings;
		const rawEngineSettings =
			getEngineSettings(effectiveEngineSettings, 'claude-code', ClaudeCodeSettingsSchema) ?? {};

		input.logWriter('INFO', 'Starting Claude Code SDK execution', {
			agentType: input.agentType,
			model,
			repoDir: input.repoDir,
			maxIterations: input.maxIterations,
			hasOffloadedContext,
			effort: resolvedSettings.effort,
			thinking: resolvedSettings.thinking,
			thinkingBudgetTokens: resolvedSettings.thinkingBudgetTokens,
		});

		const { env } = buildClaudeEnv(
			input.projectSecrets,
			input.cliToolsDir,
			input.nativeToolShimDir,
		);
		const hooks = buildHooks(input.logWriter, input.repoDir, input.enableStopHooks ?? true, {
			blockGitPush: input.blockGitPush,
		});

		const sdkTools = resolveNativeTools(input.nativeToolCapabilities);
		const sdkSettingsOptions = buildSettingsOptions(rawEngineSettings);

		const maxContinuationTurns = input.completionRequirements?.maxContinuationTurns ?? 0;
		let continuationTurns = 0;
		// Use AsyncIterable prompt for the first turn when images are present; string otherwise.
		// Continuation turns always use a plain string prompt.
		let promptInput: string | AsyncIterable<SDKUserMessage> =
			supportedImages.length > 0 ? buildPromptWithImages(taskPrompt, supportedImages) : taskPrompt;
		let isContinuation = false;
		let turnCount = 0;
		let totalCost: number | undefined;

		for (;;) {
			const stderrChunks: string[] = [];
			const stream = query({
				prompt: promptInput,
				options: {
					model,
					systemPrompt,
					cwd: input.repoDir,
					additionalDirectories: [getWorkspaceDir()],
					maxBudgetUsd: input.budgetUsd,
					permissionMode: 'bypassPermissions',
					allowDangerouslySkipPermissions: true,
					tools: sdkTools,
					allowedTools: sdkTools,
					persistSession: true,
					hooks,
					env,
					debug: true,
					stderr: (data: string) => {
						stderrChunks.push(data);
						input.logWriter('INFO', 'Claude Code stderr', { data: data.trim() });
					},
					...(isContinuation ? { continue: true } : {}),
					...sdkSettingsOptions,
				},
			});

			const {
				assistantMessages,
				resultMessage,
				turnCount: newTurnCount,
				toolCallCount,
			} = await consumeStream(stream, input, model, turnCount);
			turnCount = newTurnCount;

			const turnResult = buildResult(
				assistantMessages,
				resultMessage,
				stderrChunks,
				input,
				startTime,
			);

			// Accumulate cost across continuation turns
			if (turnResult.cost !== undefined) {
				totalCost = (totalCost ?? 0) + turnResult.cost;
			}

			const result = applyCompletionEvidence(turnResult, input.completionRequirements);

			// Don't continue on non-success results
			if (!result.success) {
				return { ...result, cost: totalCost };
			}

			const decision = decideContinuation(
				result,
				input.completionRequirements,
				continuationTurns,
				maxContinuationTurns,
				totalCost,
				input.logWriter,
				toolCallCount,
			);
			if (decision.done) return decision.result;

			continuationTurns++;
			promptInput = decision.promptText;
			isContinuation = true;
		}
	}
}
