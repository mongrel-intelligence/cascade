/**
 * Shared engine credential definitions.
 *
 * Each entry describes an env-var key that serves as a credential for one or
 * more engine IDs.  Both the Harness tab (project-harness-form.tsx) and the
 * Agent Config list (project-agent-configs.tsx) import from this module so
 * that the mapping is always kept in sync.
 */
export const ENGINE_SECRETS: Array<{
	envVarKey: string;
	label: string;
	description: string;
	placeholder?: string;
	engines?: string[];
}> = [
	{
		envVarKey: 'OPENAI_API_KEY',
		label: 'OpenAI API Key',
		description: 'API key for OpenAI/Codex or OpenCode backend.',
		placeholder: 'sk-...',
		engines: ['codex', 'opencode'],
	},
	{
		envVarKey: 'CODEX_AUTH_JSON',
		label: 'Codex Auth JSON',
		description: 'Codex subscription auth.json contents for ChatGPT Plus/Pro.',
		placeholder: '{"token":"..."}',
		engines: ['codex'],
	},
	{
		envVarKey: 'ANTHROPIC_API_KEY',
		label: 'Anthropic API Key',
		description: 'API key for Claude Code (non-subscription) or OpenCode backend.',
		placeholder: 'sk-ant-api03-...',
		engines: ['claude-code', 'opencode'],
	},
	{
		envVarKey: 'CLAUDE_CODE_OAUTH_TOKEN',
		label: 'Claude Code OAuth Token',
		description: 'OAuth token for Claude Code subscription auth.',
		placeholder: 'sk-ant-oat01-...',
		engines: ['claude-code'],
	},
	{
		envVarKey: 'OPENROUTER_API_KEY',
		label: 'OpenRouter API Key',
		description:
			'API key for OpenCode engine. Also configurable on the General tab for LLM routing.',
		placeholder: 'sk-or-...',
		engines: ['opencode', 'llmist'],
	},
];

/**
 * Derived map from engine ID to the env-var keys that serve as credentials
 * for that engine.  Built once at module load time from ENGINE_SECRETS so
 * both consumers always agree on the mapping.
 *
 * Example: engineCredentialKeys['codex'] === ['OPENAI_API_KEY', 'CODEX_AUTH_JSON']
 */
export const engineCredentialKeys: Record<string, string[]> = {};
for (const secret of ENGINE_SECRETS) {
	for (const engine of secret.engines ?? []) {
		if (!engineCredentialKeys[engine]) {
			engineCredentialKeys[engine] = [];
		}
		engineCredentialKeys[engine].push(secret.envVarKey);
	}
}
