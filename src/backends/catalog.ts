import { CLAUDE_CODE_MODELS } from './claude-code/models.js';
import type { AgentEngineDefinition } from './types.js';

export const LLMIST_ENGINE_DEFINITION: AgentEngineDefinition = {
	id: 'llmist',
	label: 'LLMist',
	description: 'LLMist SDK with synthetic tool context and CASCADE gadget support.',
	capabilities: [
		'synthetic_tool_context',
		'streaming_text_events',
		'streaming_tool_events',
		'structured_llm_logging',
		'scoped_env_secrets',
	],
	modelSelection: { type: 'free-text' },
	logLabel: 'LLMist Log',
};

export const CLAUDE_CODE_ENGINE_DEFINITION: AgentEngineDefinition = {
	id: 'claude-code',
	label: 'Claude Code',
	description: 'Anthropic Claude Code SDK with built-in file tools and Bash-driven CASCADE tools.',
	capabilities: [
		'inline_prompt_context',
		'offloaded_context_files',
		'native_file_edit_tools',
		'external_cli_tools',
		'streaming_text_events',
		'streaming_tool_events',
		'task_completion_events',
		'scoped_env_secrets',
	],
	modelSelection: {
		type: 'select',
		defaultValueLabel: 'Default (Sonnet 4.5)',
		options: CLAUDE_CODE_MODELS,
	},
	logLabel: 'Claude Code Log',
};

export const DEFAULT_ENGINE_CATALOG: AgentEngineDefinition[] = [
	LLMIST_ENGINE_DEFINITION,
	CLAUDE_CODE_ENGINE_DEFINITION,
];
