import type { ModelSpec } from 'llmist';

/**
 * Custom OpenRouter models registered in CASCADE.
 * These models are not built into llmist but can be used via OpenRouter.
 *
 * To use these models, set OPENROUTER_API_KEY in your environment
 * and configure the model in projects.json, e.g.:
 *   "model": "openrouter:x-ai/grok-code-fast-1"
 */
export const CUSTOM_MODELS: ModelSpec[] = [
	{
		provider: 'openrouter',
		modelId: 'google/gemini-3-flash-preview',
		displayName: 'Gemini 3 Flash Preview',
		contextWindow: 1_048_576,
		maxOutputTokens: 65_535,
		pricing: { input: 0.5, output: 3.0 },
		knowledgeCutoff: '2025-12',
		features: {
			streaming: true,
			functionCalling: true,
			vision: true,
			reasoning: true,
		},
	},
	{
		provider: 'openrouter',
		modelId: 'x-ai/grok-code-fast-1',
		displayName: 'Grok Code Fast 1',
		contextWindow: 256_000,
		maxOutputTokens: 32_768,
		pricing: { input: 0.2, output: 1.5 },
		knowledgeCutoff: '2025-08',
		features: {
			streaming: true,
			functionCalling: true,
			vision: false,
			reasoning: true,
		},
	},
	{
		provider: 'openrouter',
		modelId: 'deepseek/deepseek-chat-v3-0324',
		displayName: 'DeepSeek V3 0324',
		contextWindow: 163_840,
		maxOutputTokens: 16_384,
		pricing: { input: 0.19, output: 0.87 },
		knowledgeCutoff: '2025-03',
		features: {
			streaming: true,
			functionCalling: true,
			vision: false,
		},
	},
	{
		provider: 'openrouter',
		modelId: 'minimax/minimax-m2.1',
		displayName: 'MiniMax M2.1',
		contextWindow: 196_608,
		maxOutputTokens: 65_536,
		pricing: { input: 0.27, output: 1.12 },
		knowledgeCutoff: '2025-06',
		features: {
			streaming: true,
			functionCalling: true,
			vision: false,
			reasoning: true,
		},
	},
	{
		provider: 'openrouter',
		modelId: 'google/gemini-3-pro-preview',
		displayName: 'Gemini 3 Pro Preview',
		contextWindow: 1_048_576,
		maxOutputTokens: 65_536,
		pricing: { input: 2.0, output: 12.0 },
		knowledgeCutoff: '2025-12',
		features: {
			streaming: true,
			functionCalling: true,
			vision: true,
			reasoning: true,
		},
	},
	{
		provider: 'openrouter',
		modelId: 'deepseek/deepseek-v3.2',
		displayName: 'DeepSeek V3.2',
		contextWindow: 163_840,
		maxOutputTokens: 65_536,
		pricing: { input: 0.25, output: 0.38 },
		knowledgeCutoff: '2025-06',
		features: {
			streaming: true,
			functionCalling: true,
			vision: false,
			reasoning: true,
		},
	},
	{
		provider: 'openrouter',
		modelId: 'deepseek/deepseek-v3.2-speciale',
		displayName: 'DeepSeek V3.2 Speciale',
		contextWindow: 163_840,
		maxOutputTokens: 65_536,
		pricing: { input: 0.27, output: 0.41 },
		knowledgeCutoff: '2025-06',
		features: {
			streaming: true,
			functionCalling: true,
			vision: false,
			reasoning: true,
		},
	},
	{
		provider: 'openrouter',
		modelId: 'google/gemini-2.5-flash-lite',
		displayName: 'Gemini 2.5 Flash Lite',
		contextWindow: 1_048_576,
		maxOutputTokens: 8_192,
		pricing: { input: 0.075, output: 0.3 },
		knowledgeCutoff: '2025-03',
		features: {
			streaming: true,
			functionCalling: false,
			vision: false,
		},
	},
];
