import { existsSync, writeFileSync } from 'node:fs';
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
import type {
	AgentBackend,
	AgentBackendInput,
	AgentBackendResult,
	ContextInjection,
	ToolManifest,
} from '../types.js';
import { filterProcessEnv } from './env.js';
import { buildHooks } from './hooks.js';
import { CLAUDE_CODE_MODEL_IDS, DEFAULT_CLAUDE_CODE_MODEL } from './models.js';

/**
 * Format a single CLI parameter for tool guidance documentation.
 */
function formatParam(
	key: string,
	schema: { type: string; required?: boolean; default?: unknown; description?: string },
): string {
	let result: string;
	if (schema.type === 'array') {
		// Array params use repeated flags: --item "a" --item "b"
		const singular = key.replace(/s$/, '');
		result = schema.required
			? ` --${singular} <string> (repeatable)`
			: ` [--${singular} <string> (repeatable)]`;
	} else if (schema.type === 'boolean') {
		// Boolean flags are presence-based: --flag (true) or --no-flag (false), no value argument
		if (schema.default === true) {
			result = ` [--no-${key}]`;
		} else {
			result = ` [--${key}]`;
		}
	} else {
		result = schema.required ? ` --${key} <${schema.type}>` : ` [--${key} <${schema.type}>]`;
	}
	if (schema.description) {
		result += ` # ${schema.description}`;
	}
	return result;
}

/**
 * Build prompt guidance for CASCADE-specific CLI tools.
 * The Claude Code agent invokes these via its built-in Bash tool.
 */
export function buildToolGuidance(tools: ToolManifest[]): string {
	if (tools.length === 0) return '';

	let guidance = '## CASCADE Tools\n\n';
	guidance += 'Use the Bash tool to invoke these CASCADE-specific commands.\n';
	guidance += 'All commands output JSON. Parse the output to extract results.\n\n';
	guidance +=
		'**CRITICAL**: You MUST use these cascade-tools commands for all PM (Trello/JIRA), GitHub, and session operations. ' +
		'Do NOT use `gh` CLI or other tools directly — cascade-tools handle authentication, push, and ' +
		'state tracking that raw CLI tools do not. For example, `cascade-tools github create-pr` pushes ' +
		'the branch AND creates the PR atomically, while `gh pr create` does NOT push and will fail.\n\n';

	for (const tool of tools) {
		guidance += `### ${tool.name}\n`;
		guidance += `${tool.description}\n`;
		guidance += `\`\`\`bash\n${tool.cliCommand}`;

		for (const [key, schema] of Object.entries(tool.parameters)) {
			guidance += formatParam(key, schema as { type: string; required?: boolean });
		}

		guidance += '\n```\n\n';
	}

	return guidance;
}

/**
 * Build the task prompt with pre-fetched context injections.
 */
export function buildTaskPrompt(taskPrompt: string, contextInjections: ContextInjection[]): string {
	let prompt = taskPrompt;

	if (contextInjections.length > 0) {
		prompt += '\n\n## Pre-loaded Context\n';
		for (const injection of contextInjections) {
			prompt += `\n### ${injection.description} (${injection.toolName})\n`;
			prompt += `Parameters: ${JSON.stringify(injection.params)}\n`;
			prompt += `\`\`\`\n${injection.result}\n\`\`\`\n`;
		}
	}

	return prompt;
}

/**
 * Build the system prompt by combining CASCADE's agent prompt with tool guidance.
 */
export function buildSystemPrompt(systemPrompt: string, tools: ToolManifest[]): string {
	const toolGuidance = buildToolGuidance(tools);
	if (!toolGuidance) return systemPrompt;
	return `${systemPrompt}\n\n${toolGuidance}`;
}

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
 * Build environment variables to pass through to the SDK subprocess.
 *
 * Uses an allowlist filter on process.env so only safe system variables
 * (HOME, PATH, locale, etc.) reach the subprocess. Server-side secrets
 * like DATABASE_URL are never passed through.
 *
 * Project-specific secrets (GITHUB_TOKEN, TRELLO_API_KEY, etc.) are
 * injected via projectSecrets, which are layered on top.
 *
 * Auth (handled by SDK via inherited env vars):
 * - CLAUDE_CODE_OAUTH_TOKEN — long-lived OAuth token from `claude setup-token`
 */
export function buildEnv(projectSecrets?: Record<string, string>): {
	env: Record<string, string | undefined>;
} {
	const env: Record<string, string | undefined> = {
		...filterProcessEnv(process.env),
		...projectSecrets,
		CLAUDE_AGENT_SDK_CLIENT_APP: 'cascade/1.0.0',
	};

	// Always ensure onboarding flag exists (required for both API key and subscription auth)
	ensureOnboardingFlag();

	return { env };
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
	input: AgentBackendInput,
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
	logWriter: AgentBackendInput['logWriter'],
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
 * Build the result from collected stream data.
 */
function buildResult(
	assistantMessages: SDKAssistantMessage[],
	resultMessage: SDKResultMessage | undefined,
	stderrChunks: string[],
	input: AgentBackendInput,
	startTime: number,
): AgentBackendResult {
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
		error = errorResult.errors?.join('; ') ?? errorResult.subtype;
	}

	const stderrOutput = stderrChunks.join('').trim();
	if (stderrOutput) {
		input.logWriter('WARN', 'Claude Code stderr output', { stderr: stderrOutput });
		if (error) {
			error += ` | stderr: ${stderrOutput}`;
		}
	}

	const prUrl = extractPRUrl(output) ?? extractPRUrlFromMessages(assistantMessages);

	input.logWriter('INFO', 'Claude Code SDK execution completed', {
		success,
		subtype: resultMessage?.subtype,
		turns: resultMessage?.num_turns,
		cost,
		prUrl: prUrl ?? null,
		durationMs: Date.now() - startTime,
	});

	return { success, output, cost, error, prUrl };
}

/**
 * Process a task_notification system message: log and report completed tasks.
 */
function processTaskNotification(
	sysMsg: { [key: string]: unknown },
	input: AgentBackendInput,
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
 * Claude Code SDK backend for CASCADE.
 *
 * Uses the Claude Code SDK's query() function to run agents with built-in file tools
 * (Read, Write, Edit, Bash, Glob, Grep). CASCADE's domain tools (Trello, GitHub, Session)
 * are invoked via the built-in Bash tool through the cascade-tools CLI, with usage
 * guidance injected into the system prompt.
 */
export class ClaudeCodeBackend implements AgentBackend {
	readonly name = 'claude-code';

	supportsAgentType(_agentType: string): boolean {
		return true;
	}

	async execute(input: AgentBackendInput): Promise<AgentBackendResult> {
		const startTime = Date.now();
		const systemPrompt = buildSystemPrompt(input.systemPrompt, input.availableTools);
		const taskPrompt = buildTaskPrompt(input.taskPrompt, input.contextInjections);
		const model = resolveClaudeModel(input.model);

		input.logWriter('INFO', 'Starting Claude Code SDK execution', {
			agentType: input.agentType,
			model,
			repoDir: input.repoDir,
			maxIterations: input.maxIterations,
		});

		const { env } = buildEnv(input.projectSecrets);
		const hooks = buildHooks(input.logWriter, input.repoDir, input.enableStopHooks ?? true, {
			blockGitPush: input.blockGitPush,
		});

		const sdkTools = input.sdkTools ?? ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];

		const assistantMessages: SDKAssistantMessage[] = [];
		let resultMessage: SDKResultMessage | undefined;
		let turnCount = 0;
		const stderrChunks: string[] = [];

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
				const thisTurn = turnCount + 1;
				assistantMessages.push(assistantMsg);
				turnCount++;
				await input.progressReporter.onIteration(turnCount, input.maxIterations);
				processAssistantMessage(assistantMsg, turnCount, input);

				// Real-time LLM call logging for Claude Code backend
				if (input.runId && assistantMsg.message?.usage) {
					const usage = assistantMsg.message.usage;

					// Serialize response content blocks as the response payload
					let response: string | undefined;
					try {
						response = JSON.stringify(assistantMsg.message.content ?? []);
					} catch {
						// Ignore serialization errors
					}

					storeLlmCall({
						runId: input.runId,
						callNumber: turnCount,
						// Claude Code SDK doesn't expose per-turn request messages; request is null
						request: undefined,
						response,
						inputTokens: usage.input_tokens,
						outputTokens: usage.output_tokens,
						cachedTokens: undefined,
						costUsd: undefined,
						// Claude Code SDK doesn't expose actual LLM call timing; omit to avoid misleading data
						durationMs: undefined,
						model,
					}).catch((err) => {
						logger.warn('Failed to store Claude Code LLM call in real-time', {
							runId: input.runId,
							turn: thisTurn,
							error: String(err),
						});
					});
				}
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
	}
}
