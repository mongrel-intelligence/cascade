import { describe, expect, it } from 'vitest';
import {
	DEFAULT_OPENCODE_MODEL,
	OPENCODE_MODELS,
	OPENCODE_MODEL_IDS,
	resolveOpencodeModel,
} from '../../../src/backends/opencode/models.js';

describe('OPENCODE_MODELS constants', () => {
	it('has at least one model', () => {
		expect(OPENCODE_MODELS.length).toBeGreaterThan(0);
	});

	it('all models have value and label', () => {
		for (const model of OPENCODE_MODELS) {
			expect(model.value).toBeTruthy();
			expect(model.label).toBeTruthy();
		}
	});

	it('OPENCODE_MODEL_IDS matches OPENCODE_MODELS values', () => {
		const modelValues = OPENCODE_MODELS.map((m) => m.value);
		expect(OPENCODE_MODEL_IDS).toEqual(modelValues);
	});

	it('DEFAULT_OPENCODE_MODEL is in OPENCODE_MODEL_IDS', () => {
		expect(OPENCODE_MODEL_IDS).toContain(DEFAULT_OPENCODE_MODEL);
	});

	it('all model values contain a colon (provider prefix)', () => {
		for (const model of OPENCODE_MODELS) {
			expect(model.value).toContain(':');
		}
	});
});

describe('resolveOpencodeModel', () => {
	it('resolves anthropic: prefixed model', () => {
		const result = resolveOpencodeModel('anthropic:claude-sonnet-4-5');
		expect(result).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4-5' });
	});

	it('resolves openrouter: prefixed model', () => {
		const result = resolveOpencodeModel('openrouter:google/gemini-2.5-pro');
		expect(result).toEqual({ providerID: 'openrouter', modelID: 'google/gemini-2.5-pro' });
	});

	it('resolves openrouter model with nested slash in model ID', () => {
		const result = resolveOpencodeModel('openrouter:anthropic/claude-sonnet-4-5');
		expect(result).toEqual({ providerID: 'openrouter', modelID: 'anthropic/claude-sonnet-4-5' });
	});

	it('treats bare model without prefix as anthropic provider', () => {
		const result = resolveOpencodeModel('claude-sonnet-4-5');
		expect(result).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4-5' });
	});

	it('resolves the default model correctly', () => {
		const result = resolveOpencodeModel(DEFAULT_OPENCODE_MODEL);
		expect(result.providerID).toBe('anthropic');
		expect(result.modelID).toBeTruthy();
	});

	it('resolves arbitrary provider:model strings', () => {
		const result = resolveOpencodeModel('bedrock:anthropic.claude-3-sonnet');
		expect(result).toEqual({ providerID: 'bedrock', modelID: 'anthropic.claude-3-sonnet' });
	});

	it('handles model IDs with multiple colons by using only the first', () => {
		// openrouter:provider:model would be unusual but colon-split should use first
		const result = resolveOpencodeModel('openrouter:some:model');
		expect(result.providerID).toBe('openrouter');
		expect(result.modelID).toBe('some:model');
	});
});
