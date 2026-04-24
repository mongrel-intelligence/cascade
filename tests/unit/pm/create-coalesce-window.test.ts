import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	__resetCoalesceWindowForTests,
	clearPendingCreate,
	registerPendingCreate,
} from '../../../src/pm/create-coalesce-window.js';

describe('create-coalesce-window', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		__resetCoalesceWindowForTests();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('resolves to "proceed" after the window elapses with no follow-up', async () => {
		const promise = registerPendingCreate('proj-1:ITEM-1', 2000);
		await vi.advanceTimersByTimeAsync(2000);
		await expect(promise).resolves.toBe('proceed');
	});

	it('resolves to "superseded" when clearPendingCreate is called within the window', async () => {
		const promise = registerPendingCreate('proj-1:ITEM-1', 2000);
		await vi.advanceTimersByTimeAsync(500);
		clearPendingCreate('proj-1:ITEM-1');
		await expect(promise).resolves.toBe('superseded');
	});

	it('honors the window duration — does not resolve early', async () => {
		const promise = registerPendingCreate('proj-1:ITEM-1', 2000);
		const outcome: Array<'proceed' | 'superseded'> = [];
		promise.then((v) => outcome.push(v));

		await vi.advanceTimersByTimeAsync(1999);
		expect(outcome).toEqual([]);

		await vi.advanceTimersByTimeAsync(1);
		await promise;
		expect(outcome).toEqual(['proceed']);
	});

	it('keys are isolated — clearing one key does not affect another', async () => {
		const p1 = registerPendingCreate('proj-1:ITEM-1', 2000);
		const p2 = registerPendingCreate('proj-1:ITEM-2', 2000);

		clearPendingCreate('proj-1:ITEM-1');
		expect(await p1).toBe('superseded');

		await vi.advanceTimersByTimeAsync(2000);
		expect(await p2).toBe('proceed');
	});

	it('registering a second create for the same key supersedes the first', async () => {
		const first = registerPendingCreate('proj-1:ITEM-1', 2000);
		const second = registerPendingCreate('proj-1:ITEM-1', 2000);

		expect(await first).toBe('superseded');

		await vi.advanceTimersByTimeAsync(2000);
		expect(await second).toBe('proceed');
	});

	it('ttlMs of 0 resolves immediately to "proceed" without registering state', async () => {
		const promise = registerPendingCreate('proj-1:ITEM-1', 0);
		// No timer advance needed; microtask flush.
		await expect(promise).resolves.toBe('proceed');
		// A subsequent clear is a no-op (no pending entry).
		expect(() => clearPendingCreate('proj-1:ITEM-1')).not.toThrow();
	});

	it('clearPendingCreate on unknown key is a no-op', () => {
		expect(() => clearPendingCreate('never-registered')).not.toThrow();
	});
});
