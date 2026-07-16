export const CLAUDE_CODE_MODELS = [
	{ value: 'claude-fable-5', label: 'Claude Fable 5' },
	{ value: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
	{ value: 'claude-opus-4-8[1m]', label: 'Claude Opus 4.8 (1M context)' },
	{ value: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
	{ value: 'claude-opus-4-7[1m]', label: 'Claude Opus 4.7 (1M context)' },
	{ value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
	{ value: 'claude-opus-4-6[1m]', label: 'Claude Opus 4.6 (1M context)' },
	{ value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
	{ value: 'claude-sonnet-4-6[1m]', label: 'Claude Sonnet 4.6 (1M context)' },
	{ value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
	{ value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
] as const;

export const CLAUDE_CODE_MODEL_IDS: string[] = CLAUDE_CODE_MODELS.map((m) => m.value);

export const DEFAULT_CLAUDE_CODE_MODEL = 'claude-sonnet-4-5-20250929';
