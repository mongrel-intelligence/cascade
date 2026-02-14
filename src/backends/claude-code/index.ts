import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
	SDKAssistantMessage,
	SDKResultMessage,
	SDKResultSuccess,
} from '@anthropic-ai/claude-agent-sdk';
import type {
	AgentBackend,
	AgentBackendInput,
	AgentBackendResult,
	ContextInjection,
	ToolManifest,
} from '../types.js';

/**
 * Build prompt guidance for CASCADE-specific CLI tools.
 * The Claude Code agent invokes these via its built-in Bash tool.
 */
export function buildToolGuidance(tools: ToolManifest[]): string {
	if (tools.length === 0) return '';

	let guidance = '## CASCADE Tools\n\n';
	guidance += 'Use the Bash tool to invoke these CASCADE-specific commands.\n';
	guidance += 'All commands output JSON. Parse the output to extract results.\n\n';

	for (const tool of tools) {
		guidance += `### ${tool.name}\n`;
		guidance += `${tool.description}\n`;
		guidance += `\`\`\`bash\n${tool.cliCommand}`;

		for (const [key, schema] of Object.entries(tool.parameters)) {
			const s = schema as { type: string; required?: boolean };
			guidance += s.required ? ` --${key} <${s.type}>` : ` [--${key} <${s.type}>]`;
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
	if (cascadeModel.startsWith('claude-')) return cascadeModel;
	if (cascadeModel.startsWith('anthropic:')) return cascadeModel.replace('anthropic:', '');
	// Fallback for non-Claude models configured in CASCADE
	return 'claude-sonnet-4-5-20250929';
}

/**
 * Build environment variables to pass through to the SDK subprocess.
 */
function buildEnv(): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = {};
	if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
	if (process.env.TRELLO_API_KEY) env.TRELLO_API_KEY = process.env.TRELLO_API_KEY;
	if (process.env.TRELLO_TOKEN) env.TRELLO_TOKEN = process.env.TRELLO_TOKEN;
	if (process.env.GITHUB_TOKEN) env.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
	return env;
}

/**
 * Extract finish comment from assistant messages that invoked cascade-tools session finish.
 */
function extractFinishComment(assistantMessages: SDKAssistantMessage[]): string | undefined {
	for (const msg of assistantMessages) {
		if (!msg.message?.content) continue;
		for (const block of msg.message.content) {
			if (block.type === 'tool_use' && block.name === 'Bash') {
				const input = block.input as { command?: string };
				if (input.command?.includes('cascade-tools') && input.command?.includes('session finish')) {
					// Extract --comment value from the command
					const match = input.command.match(/--comment\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
					if (match) return match[1] ?? match[2] ?? match[3];
				}
			}
		}
	}
	return undefined;
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
		const systemPrompt = buildSystemPrompt(input.systemPrompt, input.availableTools);
		const taskPrompt = buildTaskPrompt(input.taskPrompt, input.contextInjections);
		const model = resolveClaudeModel(input.model);

		input.logWriter('INFO', 'Starting Claude Code SDK execution', {
			agentType: input.agentType,
			model,
			repoDir: input.repoDir,
			maxIterations: input.maxIterations,
		});

		const assistantMessages: SDKAssistantMessage[] = [];
		let resultMessage: SDKResultMessage | undefined;
		let turnCount = 0;

		const stream = query({
			prompt: taskPrompt,
			options: {
				model,
				systemPrompt,
				cwd: input.repoDir,
				maxTurns: input.maxIterations,
				maxBudgetUsd: input.budgetUsd,
				permissionMode: 'bypassPermissions',
				allowDangerouslySkipPermissions: true,
				tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
				allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
				persistSession: false,
				env: buildEnv(),
			},
		});

		for await (const message of stream) {
			if (message.type === 'assistant') {
				const assistantMsg = message as SDKAssistantMessage;
				assistantMessages.push(assistantMsg);
				turnCount++;

				await input.progressReporter.onIteration(turnCount, input.maxIterations);

				if (assistantMsg.message?.content) {
					for (const block of assistantMsg.message.content) {
						if (block.type === 'tool_use') {
							input.progressReporter.onToolCall(block.name, block.input as Record<string, unknown>);
						}
						if (block.type === 'text') {
							input.progressReporter.onText(block.text);
						}
					}
				}
			}

			if (message.type === 'result') {
				resultMessage = message as SDKResultMessage;
			}
		}

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

		input.logWriter('INFO', 'Claude Code SDK execution completed', {
			success,
			subtype: resultMessage?.subtype,
			turns: resultMessage?.num_turns,
			cost,
		});

		return { success, output, cost, error };
	}
}
