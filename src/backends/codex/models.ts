export const CODEX_MODELS = [
	{ value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
	{ value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
	{ value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
	{ value: 'gpt-5.5', label: 'GPT-5.5' },
	{ value: 'gpt-5.4', label: 'GPT-5.4' },
	{ value: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
	{ value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
	{ value: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
	{ value: 'codex-mini-latest', label: 'Codex Mini (latest)' },
] as const;

export const CODEX_MODEL_IDS: string[] = CODEX_MODELS.map((model) => model.value);

export const DEFAULT_CODEX_MODEL = 'gpt-5.4';

/**
 * Model-ID prefixes the Codex engine accepts in addition to catalog IDs.
 * Single source of truth consumed by `resolveCodexModel` (runtime acceptance)
 * and surfaced on the engine definition as `acceptedModelPrefixes` so the
 * dashboard can mirror the compatibility check without duplicating logic.
 *
 * Note: an `openai:`-prefixed model still only resolves when its bare ID is a
 * known catalog ID (see `resolveCodexModel`); the prefix alone is not enough.
 */
export const CODEX_ACCEPTED_PREFIXES = ['openai:'] as const;
