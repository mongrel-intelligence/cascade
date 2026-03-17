import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockSetTestDb, mockTransaction } = vi.hoisted(() => ({
	mockSetTestDb: vi.fn(),
	mockTransaction: vi.fn(),
}));

vi.mock('../../../src/db/client.js', () => ({
	_setTestDb: mockSetTestDb,
	getDb: vi.fn(() => ({ transaction: mockTransaction })),
	closeDb: vi.fn(),
}));

import { withTestTransaction } from '../../integration/helpers/db.js';

/**
 * Unit tests for withTestTransaction helper.
 * Verifies rollback-on-success, error propagation, and _setTestDb lifecycle.
 */
describe('withTestTransaction', () => {
	afterEach(() => {
		mockSetTestDb.mockReset();
		mockTransaction.mockReset();
	});

	it('calls fn() inside a transaction', async () => {
		mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
			await callback({});
		});
		const fn = vi.fn().mockResolvedValue(undefined);

		await withTestTransaction(fn)();

		expect(fn).toHaveBeenCalledOnce();
	});

	it('passes the tx object to _setTestDb before fn and null after', async () => {
		const txMock = { tx: true };
		const calls: unknown[] = [];
		mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
			await callback(txMock);
		});
		mockSetTestDb.mockImplementation((db: unknown) => calls.push(db));

		await withTestTransaction(vi.fn().mockResolvedValue(undefined))();

		expect(calls).toEqual([txMock, null]);
	});

	it('calls _setTestDb(null) in finally even when fn throws', async () => {
		const txMock = { tx: true };
		mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
			await callback(txMock);
		});
		const error = new Error('fn error');

		await expect(withTestTransaction(vi.fn().mockRejectedValue(error))()).rejects.toThrow(
			'fn error',
		);

		expect(mockSetTestDb).toHaveBeenLastCalledWith(null);
	});

	it('does not throw when fn succeeds (ROLLBACK sentinel is swallowed)', async () => {
		mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
			await callback({});
		});

		await expect(
			withTestTransaction(vi.fn().mockResolvedValue(undefined))(),
		).resolves.toBeUndefined();
	});

	it('re-throws non-ROLLBACK errors from fn', async () => {
		mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
			await callback({});
		});
		const error = new Error('fn failed');

		await expect(withTestTransaction(vi.fn().mockRejectedValue(error))()).rejects.toThrow(
			'fn failed',
		);
	});
});
