import { constants, accessSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
	SDKAssistantMessage,
	SDKResultMessage,
	SDKResultSuccess,
	SDKStatusMessage,
	SDKSystemMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { storeLlmCall } from '../../db/repositories/runsRepository.js';
import { logger } from '../../utils/logging.js';
import { extractPRUrl } from '../../utils/prUrl.js';
import { getWorkspaceDir } from '../../utils/repo.js';
import { CLAUDE_CODE_ENGINE_DEFINITION } from '../catalog.js';
import { cleanupContextFiles } from '../contextFiles.js';
import { buildSystemPrompt, buildTaskPrompt } from '../nativeTools.js';
import type { AgentEngine, AgentEngineResult, AgentExecutionPlan } from '../types.js';
import { buildClaudeEnv } from './env.js';
import { buildHooks } from './hooks.js';
import { CLAUDE_CODE_MODEL_IDS, DEFAULT_CLAUDE_CODE_MODEL } from './models.js';

export { buildToolGuidance, buildTaskPrompt, buildSystemPrompt } from '../nativeTools.js';
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
	// Non-Claude model configured for Claude Code backend — warn and fall back
	logger.warn('Non-Claude model configured for Claude Code backend, falling back to default', {
		configured: cascadeModel,
		fallback: DEFAULT_CLAUDE_CODE_MODEL,
	});
	return DEFAULT_CLAUDE_CODE_MODEL;
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
	const prEvidence = prUrl
		? {
				source: 'text' as const,
				authoritative: false,
			}
		: undefined;

	input.logWriter('INFO', 'Claude Code SDK execution completed', {
		success,
		subtype: resultMessage?.subtype,
		turns: resultMessage?.num_turns,
		cost,
		prUrl: prUrl ?? null,
		durationMs: Date.now() - startTime,
	});

	return { success, output, cost, error, prUrl, prEvidence };
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

function logLlmCall(
	input: AgentExecutionPlan,
	assistantMsg: SDKAssistantMessage,
	turnCount: number,
	model: string,
): void {
	if (!input.runId || !assistantMsg.message?.usage) return;

	const usage = assistantMsg.message.usage;
	let response: string | undefined;
	try {
		response = JSON.stringify(assistantMsg.message.content ?? []);
	} catch {
		// Ignore serialization errors
	}

	storeLlmCall({
		runId: input.runId,
		callNumber: turnCount,
		request: undefined,
		response,
		inputTokens: usage.input_tokens,
		outputTokens: usage.output_tokens,
		cachedTokens: undefined,
		costUsd: undefined,
		durationMs: undefined,
		model,
	}).catch((err) => {
		logger.warn('Failed to store Claude Code LLM call in real-time', {
			runId: input.runId,
			turn: turnCount,
			error: String(err),
		});
	});
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

	async execute(input: AgentExecutionPlan): Promise<AgentEngineResult> {
		const startTime = Date.now();
		const systemPrompt = buildSystemPrompt(input.systemPrompt, input.availableTools);
		const { prompt: taskPrompt, hasOffloadedContext } = await buildTaskPrompt(
			input.taskPrompt,
			input.contextInjections,
			input.repoDir,
		);
		const model = resolveClaudeModel(input.model);

		input.logWriter('INFO', 'Starting Claude Code SDK execution', {
			agentType: input.agentType,
			model,
			repoDir: input.repoDir,
			maxIterations: input.maxIterations,
			hasOffloadedContext,
		});

		const { env } = buildClaudeEnv(
			input.projectSecrets,
			input.cliToolsDir,
			input.nativeToolShimDir,
		);
		// Always ensure onboarding flag exists (required for both API key and subscription auth)
		ensureOnboardingFlag();
		const hooks = buildHooks(input.logWriter, input.repoDir, input.enableStopHooks ?? true, {
			blockGitPush: input.blockGitPush,
		});

		const sdkTools = resolveNativeTools(input.nativeToolCapabilities);

		debugRepoDirectory(input.repoDir);

		const assistantMessages: SDKAssistantMessage[] = [];
		let resultMessage: SDKResultMessage | undefined;
		let turnCount = 0;
		const stderrChunks: string[] = [];

		try {
			const stream = query({
				prompt: taskPrompt,
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
					persistSession: false,
					hooks,
					env,
					debug: true,
					stderr: (data: string) => {
						stderrChunks.push(data);
						input.logWriter('INFO', 'Claude Code stderr', { data: data.trim() });
					},
				},
			});

			for await (const message of stream) {
				if (message.type === 'assistant') {
					const assistantMsg = message as SDKAssistantMessage;
					assistantMessages.push(assistantMsg);
					turnCount++;
					await input.progressReporter.onIteration(turnCount, input.maxIterations);
					processAssistantMessage(assistantMsg, turnCount, input);
					logLlmCall(input, assistantMsg, turnCount, model);
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

			return buildResult(assistantMessages, resultMessage, stderrChunks, input, startTime);
		} finally {
			// Clean up offloaded context files after execution
			if (hasOffloadedContext) {
				await cleanupContextFiles(input.repoDir);
			}
		}
	}
}
