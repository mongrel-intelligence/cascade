import { afterEach, describe, expect, it } from 'vitest';
import { _setTestDb, getDb } from '../../../src/db/client.js';

/**
 * Tests for the _setTestDb override mechanism in getDb().
 * These tests only exercise the override path (where _testDbOverride !== null),
 * so no real database connection is needed.
 */
describe('_setTestDb', () => {
	afterEach(() => {
		// Always clear to avoid polluting subsequent tests (isolate: false)
		_setTestDb(null);
	});

	it('getDb() returns the override when set', () => {
		const fakeDb = { __isFakeDb: true } as unknown as ReturnType<typeof getDb>;
		_setTestDb(fakeDb);
		expect(getDb()).toBe(fakeDb);
	});

	it('getDb() returns the latest override when called again', () => {
		const fakeDb1 = { id: 1 } as unknown as ReturnType<typeof getDb>;
		const fakeDb2 = { id: 2 } as unknown as ReturnType<typeof getDb>;
		_setTestDb(fakeDb1);
		_setTestDb(fakeDb2);
		expect(getDb()).toBe(fakeDb2);
	});

	it('override takes precedence over any cached real db', () => {
		// Arrange: set an initial override (simulates prior state)
		const initialDb = { initial: true } as unknown as ReturnType<typeof getDb>;
		_setTestDb(initialDb);
		expect(getDb()).toBe(initialDb);

		// Act: swap to a different override
		const newDb = { new: true } as unknown as ReturnType<typeof getDb>;
		_setTestDb(newDb);

		// Assert: new override wins
		expect(getDb()).toBe(newDb);
	});
});
