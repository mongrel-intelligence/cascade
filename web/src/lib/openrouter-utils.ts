/**
 * Shared utility functions for OpenRouter model handling.
 * Imported by both the OpenRouterModelCombobox component and its unit tests
 * to ensure the production implementations are always tested directly.
 */

import type { OpenRouterModel } from '../../../src/openrouter/types.js';

/** Prefix used to store OpenRouter model IDs */
export const OPENROUTER_PREFIX = 'openrouter:';

/** Strip the "openrouter:" prefix from a stored model ID, if present. */
export function stripPrefix(value: string): string {
	return value.startsWith(OPENROUTER_PREFIX) ? value.slice(OPENROUTER_PREFIX.length) : value;
}

/** Add the "openrouter:" prefix to a model ID, avoiding double-prefixing. */
export function addPrefix(id: string): string {
	return id.startsWith(OPENROUTER_PREFIX) ? id : `${OPENROUTER_PREFIX}${id}`;
}

/** Format a per-million-token price for display. */
export function formatPrice(n: number): string {
	if (n === 0) return 'free';
	if (n < 0.01) return `$${n.toFixed(4)}/M`;
	return `$${n.toFixed(2)}/M`;
}

/** Format a context length number as a human-readable string. */
export function formatContext(n: number | null): string {
	if (n == null) return '';
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M ctx`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K ctx`;
	return `${n} ctx`;
}

/** Build the pricing+context detail line shown under each combobox option. */
export function modelDetail(model: OpenRouterModel): string {
	const parts: string[] = [];
	const ctxStr = formatContext(model.contextLength);
	if (ctxStr) parts.push(ctxStr);
	const inStr = formatPrice(model.pricing.inputPerMillion);
	const outStr = formatPrice(model.pricing.outputPerMillion);
	parts.push(`in:${inStr} out:${outStr}`);
	return parts.join(' · ');
}

/**
 * Extracts the provider name from an OpenRouter model id.
 * E.g. "anthropic/claude-3-5-sonnet" → "Anthropic"
 */
export function modelGroup(modelId: string): string {
	const slash = modelId.indexOf('/');
	if (slash === -1) return 'Other';
	const provider = modelId.slice(0, slash);
	return provider.charAt(0).toUpperCase() + provider.slice(1);
}
