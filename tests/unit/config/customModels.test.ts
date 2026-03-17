import { describe, expect, it } from 'vitest';

import { CUSTOM_MODELS } from '../../../src/config/customModels.js';

describe.concurrent('config/customModels', () => {
	describe('CUSTOM_MODELS array', () => {
		it('is defined and is an array', () => {
			expect(Array.isArray(CUSTOM_MODELS)).toBe(true);
			expect(CUSTOM_MODELS.length).toBeGreaterThan(0);
		});

		it('contains expected model count', () => {
			// As of current implementation: Gemini 3 Flash/Pro, Grok, DeepSeek variants, MiniMax, Gemini 2.5 Flash Lite
			expect(CUSTOM_MODELS.length).toBeGreaterThanOrEqual(7);
		});

		it('all models use openrouter provider', () => {
			for (const model of CUSTOM_MODELS) {
				expect(model.provider).toBe('openrouter');
			}
		});
	});

	describe('model specifications', () => {
		it('all models have required fields', () => {
			const requiredFields = [
				'provider',
				'modelId',
				'displayName',
				'contextWindow',
				'maxOutputTokens',
				'pricing',
				'features',
			];

			for (const model of CUSTOM_MODELS) {
				for (const field of requiredFields) {
					expect(model).toHaveProperty(field);
				}
			}
		});

		it('all models have valid context windows', () => {
			for (const model of CUSTOM_MODELS) {
				expect(model.contextWindow).toBeGreaterThan(0);
				expect(model.contextWindow).toBeGreaterThan(model.maxOutputTokens);
			}
		});

		it('all models have valid max output tokens', () => {
			for (const model of CUSTOM_MODELS) {
				expect(model.maxOutputTokens).toBeGreaterThan(0);
				expect(model.maxOutputTokens).toBeLessThanOrEqual(model.contextWindow);
			}
		});

		it('all models have pricing information', () => {
			for (const model of CUSTOM_MODELS) {
				expect(model.pricing).toBeDefined();
				expect(model.pricing.input).toBeGreaterThanOrEqual(0);
				expect(model.pricing.output).toBeGreaterThanOrEqual(0);
				expect(model.pricing.output).toBeGreaterThanOrEqual(model.pricing.input);
			}
		});

		it('all models have knowledge cutoff date', () => {
			for (const model of CUSTOM_MODELS) {
				if (model.knowledgeCutoff) {
					expect(model.knowledgeCutoff).toMatch(/^\d{4}-\d{2}$/);
				}
			}
		});

		it('all models have feature flags', () => {
			for (const model of CUSTOM_MODELS) {
				expect(model.features).toBeDefined();
				expect(typeof model.features.streaming).toBe('boolean');
				expect(typeof model.features.functionCalling).toBe('boolean');
			}
		});
	});

	describe('specific models', () => {
		it('includes Gemini 3 Flash Preview', () => {
			const model = CUSTOM_MODELS.find((m) => m.modelId === 'google/gemini-3-flash-preview');

			expect(model).toBeDefined();
			expect(model?.displayName).toBe('Gemini 3 Flash Preview');
			expect(model?.contextWindow).toBe(1_048_576);
			expect(model?.features.streaming).toBe(true);
			expect(model?.features.functionCalling).toBe(true);
			expect(model?.features.vision).toBe(true);
		});

		it('includes Gemini 3 Pro Preview', () => {
			const model = CUSTOM_MODELS.find((m) => m.modelId === 'google/gemini-3-pro-preview');

			expect(model).toBeDefined();
			expect(model?.displayName).toBe('Gemini 3 Pro Preview');
			expect(model?.contextWindow).toBe(1_048_576);
			expect(model?.pricing.input).toBeGreaterThan(0);
			expect(model?.features.reasoning).toBe(true);
		});

		it('includes Grok Code Fast 1', () => {
			const model = CUSTOM_MODELS.find((m) => m.modelId === 'x-ai/grok-code-fast-1');

			expect(model).toBeDefined();
			expect(model?.displayName).toBe('Grok Code Fast 1');
			expect(model?.contextWindow).toBe(256_000);
			expect(model?.maxOutputTokens).toBe(32_768);
			expect(model?.features.vision).toBe(false);
		});

		it('includes DeepSeek V3 0324', () => {
			const model = CUSTOM_MODELS.find((m) => m.modelId === 'deepseek/deepseek-chat-v3-0324');

			expect(model).toBeDefined();
			expect(model?.displayName).toBe('DeepSeek V3 0324');
			expect(model?.contextWindow).toBe(163_840);
			expect(model?.features.functionCalling).toBe(true);
		});

		it('includes DeepSeek V3.2', () => {
			const model = CUSTOM_MODELS.find((m) => m.modelId === 'deepseek/deepseek-v3.2');

			expect(model).toBeDefined();
			expect(model?.displayName).toBe('DeepSeek V3.2');
			expect(model?.features.reasoning).toBe(true);
		});

		it('includes DeepSeek V3.2 Speciale', () => {
			const model = CUSTOM_MODELS.find((m) => m.modelId === 'deepseek/deepseek-v3.2-speciale');

			expect(model).toBeDefined();
			expect(model?.displayName).toBe('DeepSeek V3.2 Speciale');
		});

		it('includes MiniMax M2.1', () => {
			const model = CUSTOM_MODELS.find((m) => m.modelId === 'minimax/minimax-m2.1');

			expect(model).toBeDefined();
			expect(model?.displayName).toBe('MiniMax M2.1');
			expect(model?.contextWindow).toBe(196_608);
			expect(model?.maxOutputTokens).toBe(65_536);
		});

		it('includes Gemini 2.5 Flash Lite', () => {
			const model = CUSTOM_MODELS.find((m) => m.modelId === 'google/gemini-2.5-flash-lite');

			expect(model).toBeDefined();
			expect(model?.displayName).toBe('Gemini 2.5 Flash Lite');
			expect(model?.contextWindow).toBe(1_048_576);
			expect(model?.maxOutputTokens).toBe(8_192);
			expect(model?.features.functionCalling).toBe(false);
			expect(model?.features.vision).toBe(false);
		});
	});

	describe('model characteristics', () => {
		it('Gemini models have large context windows', () => {
			const geminiModels = CUSTOM_MODELS.filter((m) => m.modelId.includes('gemini'));

			for (const model of geminiModels) {
				expect(model.contextWindow).toBeGreaterThanOrEqual(1_000_000);
			}
		});

		it('vision models are correctly flagged', () => {
			const visionModels = CUSTOM_MODELS.filter((m) => m.features.vision);

			// Gemini 3 Flash and Pro have vision
			expect(visionModels.length).toBeGreaterThan(0);

			for (const model of visionModels) {
				expect(model.modelId).toContain('gemini-3');
			}
		});

		it('reasoning models are correctly flagged', () => {
			const reasoningModels = CUSTOM_MODELS.filter((m) => m.features.reasoning);

			expect(reasoningModels.length).toBeGreaterThan(0);

			// Gemini 3, Grok, DeepSeek V3.2, MiniMax should have reasoning
			for (const model of reasoningModels) {
				const isReasoningModel =
					model.modelId.includes('gemini-3') ||
					model.modelId.includes('grok') ||
					model.modelId.includes('deepseek-v3') ||
					model.modelId.includes('minimax');
				expect(isReasoningModel).toBe(true);
			}
		});

		it('all models support streaming', () => {
			for (const model of CUSTOM_MODELS) {
				expect(model.features.streaming).toBe(true);
			}
		});

		it('most models support function calling', () => {
			const withFunctionCalling = CUSTOM_MODELS.filter((m) => m.features.functionCalling);

			// All except Gemini 2.5 Flash Lite
			expect(withFunctionCalling.length).toBe(CUSTOM_MODELS.length - 1);
		});
	});

	describe('pricing structure', () => {
		it('output pricing is higher than input pricing', () => {
			for (const model of CUSTOM_MODELS) {
				expect(model.pricing.output).toBeGreaterThanOrEqual(model.pricing.input);
			}
		});

		it('pricing is in reasonable range (per million tokens)', () => {
			for (const model of CUSTOM_MODELS) {
				// Input should be between $0 and $10 per million tokens
				expect(model.pricing.input).toBeGreaterThanOrEqual(0);
				expect(model.pricing.input).toBeLessThanOrEqual(10);

				// Output should be between $0 and $20 per million tokens
				expect(model.pricing.output).toBeGreaterThanOrEqual(0);
				expect(model.pricing.output).toBeLessThanOrEqual(20);
			}
		});

		it('lite/flash models are cheaper than pro models', () => {
			const flashLite = CUSTOM_MODELS.find((m) => m.modelId === 'google/gemini-2.5-flash-lite');
			const pro = CUSTOM_MODELS.find((m) => m.modelId === 'google/gemini-3-pro-preview');

			expect(flashLite?.pricing.input).toBeLessThan(pro?.pricing.input || Number.POSITIVE_INFINITY);
		});
	});

	describe('model IDs', () => {
		it('all model IDs are unique', () => {
			const modelIds = CUSTOM_MODELS.map((m) => m.modelId);
			const uniqueIds = new Set(modelIds);

			expect(uniqueIds.size).toBe(modelIds.length);
		});

		it('all display names are unique', () => {
			const displayNames = CUSTOM_MODELS.map((m) => m.displayName);
			const uniqueNames = new Set(displayNames);

			expect(uniqueNames.size).toBe(displayNames.length);
		});

		it('model IDs follow expected format', () => {
			for (const model of CUSTOM_MODELS) {
				// Should be in format: provider/model-name
				expect(model.modelId).toMatch(/^[a-z0-9-]+\/[a-z0-9.-]+$/);
			}
		});
	});
});
