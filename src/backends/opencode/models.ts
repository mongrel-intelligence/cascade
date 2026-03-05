/**
 * Model resolution for OpenCode agent subprocesses.
 *
 * Maps CASCADE model names (with provider prefixes like `anthropic:` or `openrouter:`)
 * to OpenCode's `{ providerID, modelID }` tuple format.
 */

export interface OpencodeModelRef {
	providerID: string;
	modelID: string;
}

/** Well-known models available through OpenCode. */
export const OPENCODE_MODELS = [
	{ value: 'anthropic:claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (Anthropic)' },
	{ value: 'anthropic:claude-opus-4-5', label: 'Claude Opus 4.5 (Anthropic)' },
	{ value: 'anthropic:claude-haiku-4-5', label: 'Claude Haiku 4.5 (Anthropic)' },
	{ value: 'openrouter:anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (OpenRouter)' },
	{ value: 'openrouter:google/gemini-2.5-pro', label: 'Gemini 2.5 Pro (OpenRouter)' },
	{ value: 'openrouter:google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (OpenRouter)' },
] as const;

export const OPENCODE_MODEL_IDS: string[] = OPENCODE_MODELS.map((m) => m.value);

export const DEFAULT_OPENCODE_MODEL = 'anthropic:claude-sonnet-4-5';

/**
 * Resolve a CASCADE model string to OpenCode `{ providerID, modelID }`.
 *
 * CASCADE config uses prefixed model names, e.g.:
 * - `anthropic:claude-sonnet-4-5`  → `{ providerID: 'anthropic', modelID: 'claude-sonnet-4-5' }`
 * - `openrouter:google/gemini-2.5-pro` → `{ providerID: 'openrouter', modelID: 'google/gemini-2.5-pro' }`
 *
 * If the model already contains a colon (provider:model format), the prefix is used as providerID.
 * If no prefix is present, the model is assumed to be an Anthropic model ID.
 */
export function resolveOpencodeModel(cascadeModel: string): OpencodeModelRef {
	if (cascadeModel.includes(':')) {
		const colonIndex = cascadeModel.indexOf(':');
		const providerID = cascadeModel.slice(0, colonIndex);
		const modelID = cascadeModel.slice(colonIndex + 1);
		return { providerID, modelID };
	}

	// No prefix — treat as bare Anthropic model ID
	return { providerID: 'anthropic', modelID: cascadeModel };
}
