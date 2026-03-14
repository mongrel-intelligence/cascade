export const CODEX_MODELS = [
	{ value: 'gpt-5.4', label: 'GPT-5.4' },
	{ value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
	{ value: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
	{ value: 'codex-mini-latest', label: 'Codex Mini (latest)' },
] as const;

export const CODEX_MODEL_IDS: string[] = CODEX_MODELS.map((model) => model.value);

export const DEFAULT_CODEX_MODEL = 'gpt-5.4';
