import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BotIdentityCache } from '../../../src/router/bot-identity.js';

describe('BotIdentityCache', () => {
	let cache: BotIdentityCache<string>;

	beforeEach(() => {
		cache = new BotIdentityCache<string>('accountId');
	});

	it('calls resolver on first access', async () => {
		const resolver = vi.fn().mockResolvedValue('bot-id-123');
		const result = await cache.resolve('project-1', resolver);
		expect(result).toBe('bot-id-123');
		expect(resolver).toHaveBeenCalledOnce();
	});

	it('returns cached value on second call within TTL', async () => {
		const resolver = vi.fn().mockResolvedValue('bot-id-123');
		const result1 = await cache.resolve('project-1', resolver);
		const result2 = await cache.resolve('project-1', resolver);
		expect(result1).toBe('bot-id-123');
		expect(result2).toBe('bot-id-123');
		expect(resolver).toHaveBeenCalledOnce(); // Only one API call
	});

	it('caches separately per key', async () => {
		const resolver1 = vi.fn().mockResolvedValue('bot-1');
		const resolver2 = vi.fn().mockResolvedValue('bot-2');
		const result1 = await cache.resolve('project-1', resolver1);
		const result2 = await cache.resolve('project-2', resolver2);
		expect(result1).toBe('bot-1');
		expect(result2).toBe('bot-2');
		expect(resolver1).toHaveBeenCalledOnce();
		expect(resolver2).toHaveBeenCalledOnce();
	});

	it('returns null when resolver returns null', async () => {
		const resolver = vi.fn().mockResolvedValue(null);
		const result = await cache.resolve('project-1', resolver);
		expect(result).toBeNull();
	});

	it('returns null when resolver returns undefined', async () => {
		const resolver = vi.fn().mockResolvedValue(undefined);
		const result = await cache.resolve('project-1', resolver);
		expect(result).toBeNull();
	});

	it('returns null when resolver throws', async () => {
		const resolver = vi.fn().mockRejectedValue(new Error('API error'));
		const result = await cache.resolve('project-1', resolver);
		expect(result).toBeNull();
	});

	it('does not cache null results (retries on next call)', async () => {
		const resolver = vi
			.fn()
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce('bot-id-after-retry');
		const result1 = await cache.resolve('project-1', resolver);
		const result2 = await cache.resolve('project-1', resolver);
		expect(result1).toBeNull();
		expect(result2).toBe('bot-id-after-retry');
		expect(resolver).toHaveBeenCalledTimes(2);
	});

	it('clears cache with _reset()', async () => {
		const resolver = vi.fn().mockResolvedValue('bot-id-123');
		await cache.resolve('project-1', resolver);
		cache._reset();
		await cache.resolve('project-1', resolver);
		expect(resolver).toHaveBeenCalledTimes(2); // Refetched after reset
	});

	it('exposes the fieldName', () => {
		expect(cache._fieldName).toBe('accountId');
	});

	it('supports numeric values', async () => {
		const numCache = new BotIdentityCache<number>('userId');
		const resolver = vi.fn().mockResolvedValue(42);
		const result = await numCache.resolve('project-1', resolver);
		expect(result).toBe(42);
	});

	it('handles TTL expiry by re-calling resolver', async () => {
		// Use fake timers to simulate TTL expiry
		vi.useFakeTimers();
		const resolver = vi.fn().mockResolvedValue('bot-id');
		await cache.resolve('project-1', resolver);
		// Advance past 60s TTL
		vi.advanceTimersByTime(61_000);
		await cache.resolve('project-1', resolver);
		expect(resolver).toHaveBeenCalledTimes(2);
		vi.useRealTimers();
	});
});
