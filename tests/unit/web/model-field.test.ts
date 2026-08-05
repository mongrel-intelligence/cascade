import { describe, expect, it } from 'vitest';
import { resolveSelectEmptyLabel } from '../../../web/src/components/settings/model-field.js';
import {
	addPrefix,
	formatContext,
	formatPrice,
	modelGroup,
	stripPrefix,
} from '../../../web/src/lib/openrouter-utils.js';

// ────────────────────────────────────────────────────────────────────────────
// resolveSelectEmptyLabel — honors the caller's inheritance-aware defaultLabel
// on the ModelField `select` branch (MNG-1772). The runtime chain is
// override → per-agent → project.model with no engine-default step, so the
// empty option must describe inheritance, not a fictional engine default.
// ────────────────────────────────────────────────────────────────────────────
describe('resolveSelectEmptyLabel', () => {
	it('returns the caller defaultLabel when provided', () => {
		expect(
			resolveSelectEmptyLabel(
				'Inherit from project (openrouter:google/gemini-3-flash-preview)',
				'Default (Claude Sonnet 5)',
			),
		).toBe('Inherit from project (openrouter:google/gemini-3-flash-preview)');
	});

	it('falls back to the engine defaultValueLabel when defaultLabel is undefined', () => {
		expect(resolveSelectEmptyLabel(undefined, 'Default (Claude Sonnet 5)')).toBe(
			'Default (Claude Sonnet 5)',
		);
	});

	it('prefers an empty-string defaultLabel only when it is nullish (uses ?? semantics)', () => {
		// Empty string is a real value under ?? — kept for callers that pass ''.
		expect(resolveSelectEmptyLabel('', 'Default (GPT-5.4)')).toBe('');
	});
});

// Tests import directly from the shared utility module used by the production
// component, so implementation drift between tests and production is impossible.

// ────────────────────────────────────────────────────────────────────────────
// stripPrefix / addPrefix
// ────────────────────────────────────────────────────────────────────────────
describe('OpenRouter prefix handling', () => {
	describe('addPrefix', () => {
		it('adds the openrouter: prefix to a plain model id', () => {
			expect(addPrefix('anthropic/claude-3-5-sonnet')).toBe(
				'openrouter:anthropic/claude-3-5-sonnet',
			);
		});

		it('does not double-prefix if already prefixed', () => {
			expect(addPrefix('openrouter:anthropic/claude-3-5-sonnet')).toBe(
				'openrouter:anthropic/claude-3-5-sonnet',
			);
		});
	});

	describe('stripPrefix', () => {
		it('strips the openrouter: prefix', () => {
			expect(stripPrefix('openrouter:anthropic/claude-3-5-sonnet')).toBe(
				'anthropic/claude-3-5-sonnet',
			);
		});

		it('leaves non-prefixed values unchanged', () => {
			expect(stripPrefix('anthropic/claude-3-5-sonnet')).toBe('anthropic/claude-3-5-sonnet');
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// formatPrice
// ────────────────────────────────────────────────────────────────────────────
describe('formatPrice', () => {
	it('returns "free" for 0', () => {
		expect(formatPrice(0)).toBe('free');
	});

	it('returns 4 decimal places for sub-cent values', () => {
		expect(formatPrice(0.001)).toBe('$0.0010/M');
	});

	it('returns 2 decimal places for values >= $0.01', () => {
		expect(formatPrice(3)).toBe('$3.00/M');
		expect(formatPrice(15)).toBe('$15.00/M');
	});

	it('shows 2 decimal places for values >= $0.01', () => {
		expect(formatPrice(0.075)).toBe('$0.07/M');
	});
});

// ────────────────────────────────────────────────────────────────────────────
// formatContext
// ────────────────────────────────────────────────────────────────────────────
describe('formatContext', () => {
	it('returns empty string for null', () => {
		expect(formatContext(null)).toBe('');
	});

	it('formats values in millions', () => {
		expect(formatContext(1_000_000)).toBe('1M ctx');
		expect(formatContext(200_000_000)).toBe('200M ctx');
	});

	it('formats values in thousands', () => {
		expect(formatContext(128_000)).toBe('128K ctx');
		expect(formatContext(32_768)).toBe('33K ctx');
	});

	it('formats small values as plain numbers', () => {
		expect(formatContext(512)).toBe('512 ctx');
	});
});

// ────────────────────────────────────────────────────────────────────────────
// modelGroup
// ────────────────────────────────────────────────────────────────────────────
describe('modelGroup', () => {
	it('extracts and capitalizes the provider name', () => {
		expect(modelGroup('anthropic/claude-3-5-sonnet')).toBe('Anthropic');
		expect(modelGroup('google/gemini-flash-1.5')).toBe('Google');
		expect(modelGroup('deepseek/deepseek-r1')).toBe('Deepseek');
	});

	it('returns "Other" when there is no slash', () => {
		expect(modelGroup('gpt-4o')).toBe('Other');
	});

	it('capitalizes single-character providers', () => {
		expect(modelGroup('x/some-model')).toBe('X');
	});
});
