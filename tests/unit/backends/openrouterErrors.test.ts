import { describe, expect, it } from 'vitest';

import {
	classifyOpenRouterError,
	formatOpenRouterErrorMessage,
	OPENROUTER_ERROR_SENTRY_TAG,
	openRouterErrorSentryTagValue,
} from '../../../src/backends/llmist/openrouterErrors.js';

describe('classifyOpenRouterError', () => {
	it('returns "insufficient_credits" for the llmist-wrapped 402 message', () => {
		// This is the exact message shape emitted by llmist's OpenRouterProvider.enhanceError
		// for HTTP 402 / Insufficient credits (see node_modules/llmist/dist/index.js).
		const err = new Error(
			'OpenRouter: Insufficient credits. Add funds at https://openrouter.ai/credits\n' +
				'Original error: 402 Payment Required',
		);
		expect(classifyOpenRouterError(err)).toBe('insufficient_credits');
	});

	it('returns "insufficient_credits" for a bare HTTP 402 from any upstream', () => {
		// Captured when the wrapping fails or when llmist surfaces the raw HTTP error.
		const err = new Error('Request failed with status code 402: Payment Required');
		expect(classifyOpenRouterError(err)).toBe('insufficient_credits');
	});

	it('returns "insufficient_credits" for "Insufficient balance" wording', () => {
		// Some providers use "balance" instead of "credits" — both mean the same thing.
		const err = new Error('OpenRouter: Insufficient balance. Top up at openrouter.ai');
		expect(classifyOpenRouterError(err)).toBe('insufficient_credits');
	});

	it('returns "rate_limit" for the llmist-wrapped 429 message', () => {
		const err = new Error(
			'OpenRouter: Rate limit exceeded. Consider upgrading your plan or reducing request frequency.\n' +
				'Original error: 429 Too Many Requests',
		);
		expect(classifyOpenRouterError(err)).toBe('rate_limit');
	});

	it('returns "unauthorized" for the llmist-wrapped 401 message', () => {
		const err = new Error(
			'OpenRouter: Authentication failed. Check that OPENROUTER_API_KEY is set correctly.\n' +
				'Original error: 401 Unauthorized',
		);
		expect(classifyOpenRouterError(err)).toBe('unauthorized');
	});

	it('returns "model_unavailable" for the llmist-wrapped 503 message', () => {
		const err = new Error(
			"OpenRouter: Model temporarily unavailable. Try a different model or use the 'models' fallback option for automatic retry.\n" +
				'Original error: 503 Service Unavailable',
		);
		expect(classifyOpenRouterError(err)).toBe('model_unavailable');
	});

	it('returns "other" for an OpenRouter-prefixed message that does not match a known kind', () => {
		const err = new Error('OpenRouter: weird new failure mode the SDK does not categorize');
		expect(classifyOpenRouterError(err)).toBe('other');
	});

	it('returns null for an error with no message', () => {
		expect(classifyOpenRouterError(new Error())).toBeNull();
	});

	it('returns null for non-OpenRouter errors that lack the prefix and a 402', () => {
		expect(classifyOpenRouterError(new Error('Network error: ECONNRESET'))).toBeNull();
		expect(
			classifyOpenRouterError(new Error('Agent terminated due to persistent loop')),
		).toBeNull();
	});

	it('returns null for null / undefined inputs without crashing', () => {
		expect(classifyOpenRouterError(null)).toBeNull();
		expect(classifyOpenRouterError(undefined)).toBeNull();
	});

	it('accepts string errors and plain message-bearing objects', () => {
		expect(classifyOpenRouterError('OpenRouter: Insufficient credits.')).toBe(
			'insufficient_credits',
		);
		expect(classifyOpenRouterError({ message: 'OpenRouter: Rate limit exceeded.' })).toBe(
			'rate_limit',
		);
	});

	it('is case-insensitive on the prefix and the keyword', () => {
		expect(classifyOpenRouterError(new Error('openrouter: INSUFFICIENT CREDITS.'))).toBe(
			'insufficient_credits',
		);
	});
});

describe('formatOpenRouterErrorMessage', () => {
	it('produces an actionable summary for insufficient_credits including the openrouter.ai link', () => {
		const raw = 'OpenRouter: Insufficient credits. Add funds at https://openrouter.ai/credits';
		const out = formatOpenRouterErrorMessage('insufficient_credits', raw);
		expect(out).toContain('insufficient credits');
		expect(out).toContain('https://openrouter.ai/credits');
		expect(out).toContain('switch the project to a different model');
		// Original raw message is preserved inside parens for debuggability
		expect(out).toContain('details:');
	});

	it('preserves the original message for rate_limit', () => {
		const raw = 'OpenRouter: Rate limit exceeded.';
		const out = formatOpenRouterErrorMessage('rate_limit', raw);
		expect(out).toContain('rate-limited');
		expect(out).toContain('details:');
		expect(out).toContain(raw);
	});

	it('preserves the original message for unauthorized', () => {
		const raw = 'OpenRouter: Authentication failed.';
		const out = formatOpenRouterErrorMessage('unauthorized', raw);
		expect(out).toContain('unauthorized');
		expect(out).toContain('OPENROUTER_API_KEY');
	});

	it('preserves the original message for model_unavailable', () => {
		const raw = 'OpenRouter: Model temporarily unavailable.';
		const out = formatOpenRouterErrorMessage('model_unavailable', raw);
		expect(out).toContain('temporarily unavailable');
	});

	it('produces a generic summary for the "other" kind', () => {
		const out = formatOpenRouterErrorMessage('other', 'OpenRouter: something else.');
		expect(out).toContain('OpenRouter provider error');
	});

	it('omits the details suffix when the raw message is missing', () => {
		expect(formatOpenRouterErrorMessage('insufficient_credits', null)).not.toContain('details:');
		expect(formatOpenRouterErrorMessage('insufficient_credits', '')).not.toContain('details:');
	});

	it('truncates excessively long raw messages so PM-card comments stay within provider caps', () => {
		// Trello has a 16k comment limit; we cap the embedded raw message at ~600 chars
		// so the final summary never blows past it even when nested inside a card.
		const long = `${'OpenRouter: '.repeat(200)}credits gone`;
		const out = formatOpenRouterErrorMessage('insufficient_credits', long);
		expect(out.length).toBeLessThan(1500);
		expect(out).toContain('…');
	});
});

describe('openRouterErrorSentryTagValue', () => {
	it('maps each kind to a stable tag value distinct from the others', () => {
		// The values are part of the operator-facing Sentry filter contract — if they
		// change, every Sentry saved query needs to be updated. Pin them here.
		expect(openRouterErrorSentryTagValue('insufficient_credits')).toBe(
			'openrouter_insufficient_credits',
		);
		expect(openRouterErrorSentryTagValue('rate_limit')).toBe('openrouter_rate_limit');
		expect(openRouterErrorSentryTagValue('unauthorized')).toBe('openrouter_unauthorized');
		expect(openRouterErrorSentryTagValue('model_unavailable')).toBe('openrouter_model_unavailable');
		expect(openRouterErrorSentryTagValue('other')).toBe('openrouter_provider_error');
	});

	it('exposes the stable Sentry tag key', () => {
		expect(OPENROUTER_ERROR_SENTRY_TAG).toBe('openrouter_provider_error');
	});
});
