export const CLAUDE_CODE_MODELS = [
	{ value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
	{ value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
	{ value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
	{ value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
] as const;

export const CLAUDE_CODE_MODEL_IDS: string[] = CLAUDE_CODE_MODELS.map((m) => m.value);

export const DEFAULT_CLAUDE_CODE_MODEL = 'claude-sonnet-4-5-20250929';
