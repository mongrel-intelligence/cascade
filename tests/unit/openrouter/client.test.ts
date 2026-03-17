import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We import the module under test after mocking fetch
import { clearOpenRouterCache, fetchOpenRouterModels } from '../../../src/openrouter/client.js';

describe('fetchOpenRouterModels', () => {
	beforeEach(() => {
		clearOpenRouterCache();
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		clearOpenRouterCache();
	});

	function makeFetchResponse(data: unknown, ok = true, status = 200) {
		return Promise.resolve({
			ok,
			status,
			statusText: ok ? 'OK' : 'Error',
			json: () => Promise.resolve(data),
		});
	}

	const sampleModels = {
		data: [
			{
				id: 'anthropic/claude-3-5-sonnet',
				name: 'Claude 3.5 Sonnet',
				context_length: 200000,
				architecture: { modality: 'text->text' },
				pricing: { prompt: '0.000003', completion: '0.000015' },
				top_provider: { max_completion_tokens: 8192 },
			},
			{
				id: 'google/gemini-flash-1.5',
				name: 'Gemini Flash 1.5',
				context_length: 1000000,
				architecture: { modality: 'text+image->text' },
				pricing: { prompt: '0.000000075', completion: '0.0000003' },
				top_provider: { max_completion_tokens: 8192 },
			},
			{
				id: 'stability/stable-diffusion-xl',
				name: 'Stable Diffusion XL',
				context_length: null,
				architecture: { modality: 'text->image' },
				pricing: { prompt: '0.000004', completion: '0.000004' },
			},
		],
	};

	it('fetches and returns text-capable models sorted by name', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse(sampleModels) as ReturnType<typeof fetch>,
		);
		const models = await fetchOpenRouterModels();
		// Should exclude the text->image model (image output only)
		expect(models).toHaveLength(2);
		// Sorted alphabetically by name
		expect(models[0].name).toBe('Claude 3.5 Sonnet');
		expect(models[1].name).toBe('Gemini Flash 1.5');
	});

	it('maps pricing to per-million-token values', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse(sampleModels) as ReturnType<typeof fetch>,
		);
		const models = await fetchOpenRouterModels();
		const claude = models.find((m) => m.id === 'anthropic/claude-3-5-sonnet');
		expect(claude).toBeDefined();
		// 0.000003 * 1_000_000 = 3
		expect(claude?.pricing.inputPerMillion).toBeCloseTo(3, 5);
		// 0.000015 * 1_000_000 = 15
		expect(claude?.pricing.outputPerMillion).toBeCloseTo(15, 5);
	});

	it('includes contextLength and maxOutput from response', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse(sampleModels) as ReturnType<typeof fetch>,
		);
		const models = await fetchOpenRouterModels();
		const claude = models.find((m) => m.id === 'anthropic/claude-3-5-sonnet');
		expect(claude?.contextLength).toBe(200000);
		expect(claude?.maxOutput).toBe(8192);
	});

	it('passes Authorization header when apiKey is provided', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse(sampleModels) as ReturnType<typeof fetch>,
		);
		await fetchOpenRouterModels('test-api-key');
		expect(fetch).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer test-api-key',
				}),
			}),
		);
	});

	it('does not pass Authorization header when no apiKey is provided', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse(sampleModels) as ReturnType<typeof fetch>,
		);
		await fetchOpenRouterModels();
		const callArgs = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
		const headers = callArgs?.headers as Record<string, string>;
		expect(headers?.Authorization).toBeUndefined();
	});

	it('caches results for subsequent calls', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse(sampleModels) as ReturnType<typeof fetch>,
		);
		await fetchOpenRouterModels();
		// Second call should use cache (fetch called only once)
		await fetchOpenRouterModels();
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('returns empty array when API returns non-ok response', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse({}, false, 500) as ReturnType<typeof fetch>,
		);
		const models = await fetchOpenRouterModels();
		expect(models).toEqual([]);
	});

	it('returns empty array when fetch throws (network error)', async () => {
		vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));
		const models = await fetchOpenRouterModels();
		expect(models).toEqual([]);
	});

	it('returns empty array when fetch times out', async () => {
		vi.mocked(fetch).mockRejectedValueOnce(new DOMException('Timeout', 'AbortError'));
		const models = await fetchOpenRouterModels();
		expect(models).toEqual([]);
	});

	it('filters out image-output-only models', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse(sampleModels) as ReturnType<typeof fetch>,
		);
		const models = await fetchOpenRouterModels();
		const imageModel = models.find((m) => m.id === 'stability/stable-diffusion-xl');
		expect(imageModel).toBeUndefined();
	});

	it('handles missing pricing gracefully (returns 0)', async () => {
		const noPricingModels = {
			data: [
				{
					id: 'free/model',
					name: 'Free Model',
					architecture: { modality: 'text->text' },
					// no pricing field
				},
			],
		};
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse(noPricingModels) as ReturnType<typeof fetch>,
		);
		const models = await fetchOpenRouterModels();
		expect(models[0].pricing.inputPerMillion).toBe(0);
		expect(models[0].pricing.outputPerMillion).toBe(0);
	});

	it('clearOpenRouterCache allows re-fetching', async () => {
		vi.mocked(fetch)
			.mockReturnValueOnce(makeFetchResponse(sampleModels) as ReturnType<typeof fetch>)
			.mockReturnValueOnce(makeFetchResponse(sampleModels) as ReturnType<typeof fetch>);
		await fetchOpenRouterModels();
		clearOpenRouterCache();
		await fetchOpenRouterModels();
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
