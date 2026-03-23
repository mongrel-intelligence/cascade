import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
// vi.mock factories are hoisted to the top of the file, so any variables they
// reference must also be hoisted via vi.hoisted().

const { mockPoolEnd, mockPoolConstructor, mockReadFileSync, mockExistsSync } = vi.hoisted(() => {
	const mockPoolEnd = vi.fn().mockResolvedValue(undefined);
	const mockPoolConstructor = vi.fn().mockImplementation(() => ({ end: mockPoolEnd }));
	const mockReadFileSync = vi.fn().mockReturnValue('mock-ca-cert-content');
	const mockExistsSync = vi.fn().mockReturnValue(true);
	return { mockPoolEnd, mockPoolConstructor, mockReadFileSync, mockExistsSync };
});

vi.mock('pg', () => ({
	default: {
		Pool: mockPoolConstructor,
	},
}));

vi.mock('drizzle-orm/node-postgres', () => ({
	drizzle: vi.fn().mockReturnValue({ __isMockDrizzle: true }),
}));

vi.mock('node:fs', () => ({
	default: {
		readFileSync: mockReadFileSync,
	},
	existsSync: mockExistsSync,
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import {
	DatabaseContext,
	_setTestDb,
	closeDb,
	createDatabaseContext,
	getDb,
	setDefaultDatabaseContext,
} from '../../../src/db/client.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Reset module-level context singleton between tests. */
async function resetDbState() {
	// closeDb() resets _defaultContext to null; safe to call when already null.
	await closeDb();
	// Also clear any test override.
	setDefaultDatabaseContext(null);
}

// ── Tests: setDefaultDatabaseContext ─────────────────────────────────────────

describe('setDefaultDatabaseContext', () => {
	afterEach(async () => {
		await resetDbState();
	});

	it('getDb() returns the db from the injected context', () => {
		const fakeDb = { __isFakeDb: true } as unknown as ReturnType<typeof getDb>;
		const fakeContext = {
			getDb: () => fakeDb,
			close: vi.fn().mockResolvedValue(undefined),
		} as unknown as DatabaseContext;

		setDefaultDatabaseContext(fakeContext);
		expect(getDb()).toBe(fakeDb);
	});

	it('getDb() returns the latest injected context', () => {
		const fakeDb1 = { id: 1 } as unknown as ReturnType<typeof getDb>;
		const fakeDb2 = { id: 2 } as unknown as ReturnType<typeof getDb>;

		const fakeCtx1 = {
			getDb: () => fakeDb1,
			close: vi.fn().mockResolvedValue(undefined),
		} as unknown as DatabaseContext;
		const fakeCtx2 = {
			getDb: () => fakeDb2,
			close: vi.fn().mockResolvedValue(undefined),
		} as unknown as DatabaseContext;

		setDefaultDatabaseContext(fakeCtx1);
		expect(getDb()).toBe(fakeDb1);

		setDefaultDatabaseContext(fakeCtx2);
		expect(getDb()).toBe(fakeDb2);
	});

	it('setting null causes getDb() to create a new real context', () => {
		vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/testdb');

		const fakeDb = { __isFakeDb: true } as unknown as ReturnType<typeof getDb>;
		const fakeContext = {
			getDb: () => fakeDb,
			close: vi.fn().mockResolvedValue(undefined),
		} as unknown as DatabaseContext;

		setDefaultDatabaseContext(fakeContext);
		expect(getDb()).toBe(fakeDb);

		setDefaultDatabaseContext(null);
		// Now getDb() should create a new pool and return the drizzle mock
		const db = getDb();
		expect(db).toEqual({ __isMockDrizzle: true });
		expect(mockPoolConstructor).toHaveBeenCalled();
	});
});

// ── Tests: _setTestDb (pre-existing coverage, kept for regression) ────────────

describe('_setTestDb', () => {
	afterEach(async () => {
		await resetDbState();
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

	it('_setTestDb(null) clears the override', async () => {
		vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/testdb');

		const fakeDb = { __isFakeDb: true } as unknown as ReturnType<typeof getDb>;
		_setTestDb(fakeDb);
		expect(getDb()).toBe(fakeDb);

		_setTestDb(null);
		// After clearing, getDb() should create a real context
		const db = getDb();
		expect(db).toEqual({ __isMockDrizzle: true });
	});
});

// ── Tests: createDatabaseContext ──────────────────────────────────────────────

describe('createDatabaseContext', () => {
	beforeEach(async () => {
		await resetDbState();
		vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/testdb');
	});

	afterEach(async () => {
		await resetDbState();
	});

	it('creates a DatabaseContext with a pool and drizzle db', () => {
		vi.stubEnv('DATABASE_SSL', 'false');

		const ctx = createDatabaseContext();
		expect(ctx).toBeInstanceOf(DatabaseContext);
		expect(ctx.getDb()).toEqual({ __isMockDrizzle: true });
		expect(mockPoolConstructor).toHaveBeenCalled();
	});
});

// ── Tests: getDatabaseUrl (tested via getDb internals) ───────────────────────

describe('getDatabaseUrl', () => {
	beforeEach(async () => {
		await resetDbState();
	});

	afterEach(async () => {
		await resetDbState();
	});

	it('uses DATABASE_URL when set', () => {
		vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@myhost:5432/mydb');
		vi.stubEnv('CASCADE_POSTGRES_HOST', '');

		getDb();

		expect(mockPoolConstructor).toHaveBeenCalledWith(
			expect.objectContaining({
				connectionString: 'postgresql://user:pass@myhost:5432/mydb',
			}),
		);
	});

	it('falls back to CASCADE_POSTGRES_* vars with correct defaults', () => {
		vi.stubEnv('DATABASE_URL', '');
		vi.stubEnv('CASCADE_POSTGRES_HOST', 'pg.example.com');
		vi.stubEnv('CASCADE_POSTGRES_PORT', '');
		vi.stubEnv('CASCADE_POSTGRES_USER', '');
		vi.stubEnv('CASCADE_POSTGRES_PASSWORD', '');
		vi.stubEnv('CASCADE_POSTGRES_DB', '');

		getDb();

		expect(mockPoolConstructor).toHaveBeenCalledWith(
			expect.objectContaining({
				connectionString: 'postgresql://postgres:@pg.example.com:6543/cascade',
			}),
		);
	});

	it('respects custom CASCADE_POSTGRES_* values', () => {
		vi.stubEnv('DATABASE_URL', '');
		vi.stubEnv('CASCADE_POSTGRES_HOST', 'custom-host');
		vi.stubEnv('CASCADE_POSTGRES_PORT', '5432');
		vi.stubEnv('CASCADE_POSTGRES_USER', 'myuser');
		vi.stubEnv('CASCADE_POSTGRES_PASSWORD', 'secret');
		vi.stubEnv('CASCADE_POSTGRES_DB', 'mydb');

		getDb();

		expect(mockPoolConstructor).toHaveBeenCalledWith(
			expect.objectContaining({
				connectionString: 'postgresql://myuser:secret@custom-host:5432/mydb',
			}),
		);
	});

	it('throws when neither DATABASE_URL nor CASCADE_POSTGRES_HOST is set', () => {
		vi.stubEnv('DATABASE_URL', '');
		vi.stubEnv('CASCADE_POSTGRES_HOST', '');

		expect(() => getDb()).toThrow('DATABASE_URL or CASCADE_POSTGRES_HOST must be set');
	});
});

// ── Tests: getDb ─────────────────────────────────────────────────────────────

describe('getDb', () => {
	beforeEach(async () => {
		await resetDbState();
		vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/testdb');
	});

	afterEach(async () => {
		await resetDbState();
	});

	it('creates pool with SSL disabled when DATABASE_SSL=false', () => {
		vi.stubEnv('DATABASE_SSL', 'false');
		vi.stubEnv('DATABASE_CA_CERT', '');

		getDb();

		expect(mockPoolConstructor).toHaveBeenCalledWith(expect.objectContaining({ ssl: false }));
	});

	it('creates pool with rejectUnauthorized:true by default (DATABASE_SSL not set)', () => {
		vi.stubEnv('DATABASE_SSL', '');
		vi.stubEnv('DATABASE_CA_CERT', '');

		getDb();

		expect(mockPoolConstructor).toHaveBeenCalledWith(
			expect.objectContaining({ ssl: { rejectUnauthorized: true } }),
		);
	});

	it('creates pool with custom CA cert when DATABASE_CA_CERT is set', () => {
		vi.stubEnv('DATABASE_SSL', '');
		vi.stubEnv('DATABASE_CA_CERT', '/path/to/ca.pem');

		getDb();

		expect(mockReadFileSync).toHaveBeenCalledWith('/path/to/ca.pem', 'utf8');
		expect(mockPoolConstructor).toHaveBeenCalledWith(
			expect.objectContaining({
				ssl: { rejectUnauthorized: true, ca: 'mock-ca-cert-content' },
			}),
		);
	});

	it('throws a descriptive error when DATABASE_CA_CERT path does not exist', () => {
		vi.stubEnv('DATABASE_SSL', '');
		vi.stubEnv('DATABASE_CA_CERT', '/nonexistent/ca.pem');
		mockExistsSync.mockReturnValueOnce(false);

		expect(() => getDb()).toThrow('DATABASE_CA_CERT file not found: /nonexistent/ca.pem');
	});

	it('DATABASE_CA_CERT is ignored when DATABASE_SSL=false', () => {
		vi.stubEnv('DATABASE_SSL', 'false');
		vi.stubEnv('DATABASE_CA_CERT', '/path/to/ca.pem');

		getDb();

		expect(mockReadFileSync).not.toHaveBeenCalled();
		expect(mockPoolConstructor).toHaveBeenCalledWith(expect.objectContaining({ ssl: false }));
	});

	it('returns singleton — second call returns same instance', () => {
		const first = getDb();
		const second = getDb();

		expect(first).toBe(second);
		// Pool constructor should only be called once
		expect(mockPoolConstructor).toHaveBeenCalledTimes(1);
	});
});

// ── Tests: closeDb ────────────────────────────────────────────────────────────

describe('closeDb', () => {
	beforeEach(async () => {
		await resetDbState();
		vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/testdb');
	});

	afterEach(async () => {
		await resetDbState();
	});

	it('calls pool.end() and resets state', async () => {
		getDb(); // creates pool via DatabaseContext
		expect(mockPoolConstructor).toHaveBeenCalledTimes(1);

		await closeDb();
		expect(mockPoolEnd).toHaveBeenCalledTimes(1);

		// After close, calling getDb() should create a new pool
		getDb();
		expect(mockPoolConstructor).toHaveBeenCalledTimes(2);
	});

	it('is a no-op when context is null (pool never initialized)', async () => {
		// No getDb() call — _defaultContext is null
		await closeDb();

		expect(mockPoolEnd).not.toHaveBeenCalled();
	});

	it('does not throw when close() is called on a mock context', async () => {
		// When _setTestDb is used, close() is a no-op and should not throw
		const fakeDb = { __isFakeDb: true } as unknown as ReturnType<typeof getDb>;
		_setTestDb(fakeDb);

		await expect(closeDb()).resolves.toBeUndefined();
		expect(mockPoolEnd).not.toHaveBeenCalled();
	});
});
