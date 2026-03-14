export const CODEX_MODELS = [{ value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' }] as const;

export const CODEX_MODEL_IDS: string[] = CODEX_MODELS.map((model) => model.value);

export const DEFAULT_CODEX_MODEL = 'gpt-5.3-codex';
