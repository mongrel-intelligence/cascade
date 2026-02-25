import { vi } from 'vitest';

export type MockDbChain = Record<string, ReturnType<typeof vi.fn>>;

export interface MockDbResult {
	db: {
		select: ReturnType<typeof vi.fn>;
		insert: ReturnType<typeof vi.fn>;
		update: ReturnType<typeof vi.fn>;
		delete: ReturnType<typeof vi.fn>;
	};
	chain: MockDbChain;
}

/**
 * Creates a mock Drizzle query chain that supports the common patterns:
 *
 * - `select().from().where()` / `select().from().innerJoin().where()`
 * - `select().from().innerJoin().innerJoin().where()` (double join)
 * - `insert().values().returning()` / `insert().values().onConflictDoUpdate()`
 * - `update().set().where()`
 * - `delete().where()`
 *
 * Options let you extend the chain for repo-specific needs.
 */
export function createMockDb(
	opts: {
		/** Add `.limit()` support on select chains */
		withLimit?: boolean;
		/** Add nested `.innerJoin().innerJoin().where()` support */
		withDoubleJoin?: boolean;
		/** Add `.onConflictDoUpdate()` on insert chains */
		withUpsert?: boolean;
		/** Make the chain itself thenable (for queries without `.where()` terminal) */
		withThenable?: boolean;
	} = {},
): MockDbResult {
	const chain: MockDbChain = {};

	// Terminal methods that return results
	chain.returning = vi.fn().mockResolvedValue([]);

	// Limit support — limit is the terminal when present, where is a chaining step
	if (opts.withLimit) {
		chain.limit = vi.fn().mockResolvedValue([]);
		chain.where = vi.fn().mockReturnValue({ limit: chain.limit });
	} else {
		chain.where = vi.fn().mockResolvedValue([]);
	}

	// Chain methods - innerJoin
	const innerJoinResult: Record<string, unknown> = { where: chain.where };
	if (opts.withDoubleJoin) {
		innerJoinResult.innerJoin = vi.fn().mockReturnValue({ where: chain.where });
	}
	chain.innerJoin = vi.fn().mockReturnValue(innerJoinResult);

	// From
	chain.from = vi.fn().mockReturnValue({
		where: chain.where,
		innerJoin: chain.innerJoin,
	});

	// Update chain
	chain.set = vi.fn().mockReturnValue({ where: chain.where });

	// Insert chain
	const valuesResult: Record<string, unknown> = { returning: chain.returning };
	if (opts.withUpsert) {
		chain.onConflictDoUpdate = vi.fn().mockReturnValue({ returning: chain.returning });
		valuesResult.onConflictDoUpdate = chain.onConflictDoUpdate;
	}
	chain.values = vi.fn().mockReturnValue(valuesResult);

	// Thenable support for queries without .where() terminal
	if (opts.withThenable) {
		// biome-ignore lint/suspicious/noThenProperty: intentional thenable mock for Drizzle query chains
		chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve);
	}

	const db = {
		select: vi.fn().mockReturnValue({ from: chain.from }),
		insert: vi.fn().mockReturnValue({ values: chain.values }),
		update: vi.fn().mockReturnValue({ set: chain.set }),
		delete: vi.fn().mockReturnValue({ where: chain.where }),
	};

	return { db, chain };
}
