import {
	CLAUDE_CODE_ACCEPTED_PREFIXES,
	CLAUDE_CODE_MODELS,
	DEFAULT_CLAUDE_CODE_MODEL,
} from './claude-code/models.js';
import { CODEX_ACCEPTED_PREFIXES, CODEX_MODELS, DEFAULT_CODEX_MODEL } from './codex/models.js';
import type { AgentEngineDefinition } from './types.js';

/**
 * Derive the `select`-engine empty-option label from the engine's default model
 * constant, looking the display label up in the model catalog. This kills the
 * hand-synced-literal drift class (MNG-1772/MNG-1770): the displayed default
 * always matches the actually-resolved `DEFAULT_*_MODEL` on the next model bump.
 */
export function defaultModelLabel(
	models: ReadonlyArray<{ value: string; label: string }>,
	defaultId: string,
): string {
	const match = models.find((m) => m.value === defaultId);
	return `Default (${match?.label ?? defaultId})`;
}

export const LLMIST_ENGINE_DEFINITION: AgentEngineDefinition = {
	id: 'llmist',
	label: 'LLMist',
	description: 'LLMist SDK with synthetic tool context and CASCADE gadget support.',
	archetype: 'sdk',
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
	archetype: 'native-tool',
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
		defaultValueLabel: defaultModelLabel(CLAUDE_CODE_MODELS, DEFAULT_CLAUDE_CODE_MODEL),
		options: CLAUDE_CODE_MODELS,
		acceptedModelPrefixes: CLAUDE_CODE_ACCEPTED_PREFIXES,
	},
	logLabel: 'Claude Code Log',
	settings: {
		title: 'Claude Code Settings',
		description: 'Effort level and thinking mode for Claude Code runs.',
		fields: [
			{
				key: 'effort',
				label: 'Effort',
				type: 'select',
				description: 'Controls the overall effort level applied during the run.',
				options: [
					{ value: 'low', label: 'Low' },
					{ value: 'medium', label: 'Medium' },
					{ value: 'high', label: 'High' },
					{ value: 'max', label: 'Max' },
				],
			},
			{
				key: 'thinking',
				label: 'Thinking',
				type: 'select',
				description: 'Controls extended thinking mode.',
				options: [
					{ value: 'adaptive', label: 'Adaptive' },
					{ value: 'enabled', label: 'Enabled' },
					{ value: 'disabled', label: 'Disabled' },
				],
			},
			{
				key: 'thinkingBudgetTokens',
				label: 'Thinking Budget Tokens',
				// TODO: Frontend 'number' field type is not yet supported (Story #2).
				// The dashboard will render this field once numeric fields are implemented.
				type: 'number',
				description: 'Maximum tokens allocated for extended thinking (optional).',
			},
		],
	},
};

export const CODEX_ENGINE_DEFINITION: AgentEngineDefinition = {
	id: 'codex',
	label: 'Codex',
	description: 'OpenAI Codex CLI in headless automation mode with CASCADE tool guidance.',
	archetype: 'native-tool',
	capabilities: [
		'inline_prompt_context',
		'offloaded_context_files',
		'native_file_edit_tools',
		'external_cli_tools',
		'streaming_text_events',
		'streaming_tool_events',
		'scoped_env_secrets',
	],
	modelSelection: {
		type: 'select',
		defaultValueLabel: defaultModelLabel(CODEX_MODELS, DEFAULT_CODEX_MODEL),
		options: CODEX_MODELS,
		acceptedModelPrefixes: CODEX_ACCEPTED_PREFIXES,
	},
	logLabel: 'Codex Log',
	settings: {
		title: 'Codex Settings',
		description: 'Automation policy for Codex headless runs.',
		fields: [
			{
				key: 'approvalPolicy',
				label: 'Approval Policy',
				type: 'select',
				description: 'Headless worker runs must use `never`.',
				options: [
					{ value: 'never', label: 'Never' },
					{ value: 'on-request', label: 'On Request' },
					{ value: 'untrusted', label: 'Untrusted' },
				],
			},
			{
				key: 'sandboxMode',
				label: 'Sandbox Mode',
				type: 'select',
				options: [
					{ value: 'read-only', label: 'Read Only' },
					{ value: 'workspace-write', label: 'Workspace Write' },
					{ value: 'danger-full-access', label: 'Danger Full Access' },
				],
			},
			{
				key: 'reasoningEffort',
				label: 'Reasoning Effort',
				type: 'select',
				options: [
					{ value: 'low', label: 'Low' },
					{ value: 'medium', label: 'Medium' },
					{ value: 'high', label: 'High' },
					{ value: 'xhigh', label: 'XHigh' },
				],
			},
			{
				key: 'webSearch',
				label: 'Web Search',
				type: 'boolean',
				description: 'Allow Codex to use web search during runs.',
			},
		],
	},
};

export const OPENCODE_ENGINE_DEFINITION: AgentEngineDefinition = {
	id: 'opencode',
	label: 'OpenCode',
	description: 'OpenCode headless agent server with scoped permissions and CASCADE tool guidance.',
	archetype: 'native-tool',
	capabilities: [
		'inline_prompt_context',
		'offloaded_context_files',
		'native_file_edit_tools',
		'external_cli_tools',
		'streaming_text_events',
		'streaming_tool_events',
		'scoped_env_secrets',
		'permission_policy',
	],
	modelSelection: { type: 'free-text' },
	logLabel: 'OpenCode Log',
	settings: {
		title: 'OpenCode Settings',
		description: 'Headless OpenCode permission policy.',
		fields: [
			{
				key: 'webSearch',
				label: 'Web Search',
				type: 'boolean',
				description: 'Allow OpenCode web fetch permissions during runs.',
			},
		],
	},
};

export const DEFAULT_ENGINE_CATALOG: AgentEngineDefinition[] = [
	CLAUDE_CODE_ENGINE_DEFINITION,
	LLMIST_ENGINE_DEFINITION,
	CODEX_ENGINE_DEFINITION,
	OPENCODE_ENGINE_DEFINITION,
];
