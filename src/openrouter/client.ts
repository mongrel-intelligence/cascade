import type { OpenRouterModel, OpenRouterModelsResponse, OpenRouterRawModel } from './types.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 5_000; // 5 seconds

interface CacheEntry {
	data: OpenRouterModel[];
	timestamp: number;
}

let cache: CacheEntry | null = null;

/**
 * Convert a per-token price string from OpenRouter to per-million-token USD.
 * OpenRouter returns cost per token as a decimal string (e.g. "0.0000015").
 * We multiply by 1,000,000 to get a human-readable per-million price.
 */
function toPerMillion(priceStr: string | undefined): number {
	if (!priceStr) return 0;
	const n = Number.parseFloat(priceStr);
	if (Number.isNaN(n)) return 0;
	return n * 1_000_000;
}

/**
 * Returns true if the model is text-capable (supports text input and text output).
 * Filters out image-only or audio-only models.
 */
function isTextCapable(model: OpenRouterRawModel): boolean {
	const modality = model.architecture?.modality ?? '';
	if (!modality) return true; // unknown modality — include by default
	const parts = modality.split('->');
	const inputPart = parts[0] ?? '';
	const outputPart = parts[1] ?? '';
	// Must accept text input AND produce text output (not image/audio only)
	return inputPart.includes('text') && outputPart.includes('text');
}

/**
 * Map a raw OpenRouter model to the minimal shape used by the dashboard.
 */
function mapModel(raw: OpenRouterRawModel): OpenRouterModel {
	return {
		id: raw.id,
		name: raw.name,
		contextLength: raw.context_length ?? null,
		maxOutput: raw.top_provider?.max_completion_tokens ?? null,
		pricing: {
			inputPerMillion: toPerMillion(raw.pricing?.prompt),
			outputPerMillion: toPerMillion(raw.pricing?.completion),
		},
	};
}

/**
 * Fetch the list of available models from OpenRouter.
 * Results are cached in memory for 1 hour to avoid excessive API calls.
 *
 * @param apiKey - Optional OpenRouter API key. Without a key, the public list is returned.
 * @returns Sorted list of text-capable models, or an empty array on failure.
 */
export async function fetchOpenRouterModels(apiKey?: string | null): Promise<OpenRouterModel[]> {
	// Return cached result if still valid
	if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
		return cache.data;
	}

	try {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		if (apiKey) {
			headers.Authorization = `Bearer ${apiKey}`;
		}

		const response = await fetch(OPENROUTER_API_URL, {
			headers,
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});

		if (!response.ok) {
			throw new Error(`OpenRouter API returned ${response.status}: ${response.statusText}`);
		}

		const json = (await response.json()) as OpenRouterModelsResponse;
		const models = json.data ?? [];

		const filtered = models
			.filter(isTextCapable)
			.map(mapModel)
			.sort((a, b) => a.name.localeCompare(b.name));

		cache = { data: filtered, timestamp: Date.now() };
		return filtered;
	} catch {
		// Return empty array on any failure (network error, timeout, parse error, etc.)
		return [];
	}
}

/**
 * Clear the in-memory model cache (useful for testing).
 */
export function clearOpenRouterCache(): void {
	cache = null;
}
