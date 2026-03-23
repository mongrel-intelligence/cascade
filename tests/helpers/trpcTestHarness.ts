/**
 * tRPC Router Test Harness
 *
 * Eliminates the most repeated boilerplate in API router tests:
 *
 * 1. `createCallerFor(router)` — generic caller factory (replaces the
 *    per-file `function createCaller(ctx) { return fooRouter.createCaller(ctx); }` pattern
 *    copied in 15+ test files)
 *
 * 2. `setupOwnershipCheckMock()` — returns `{ mockDbSelect, mockDbFrom, mockDbWhere }` with
 *    the pre-wired chain that 6+ API router test files set up identically in every
 *    `beforeEach`, plus a `configureOwnership(orgId)` helper to simulate a project
 *    belonging to a given org
 *
 * 3. `expectTRPCError(promise, code)` — assertion helper for the 30+ places that do
 *    `try/catch + expect(error).toBeInstanceOf(TRPCError) + expect(error.code).toBe('UNAUTHORIZED')`
 *
 * ---
 *
 * ## Anti-pattern: `(...args: unknown[]) => mockFn(...args)` wrappers
 *
 * Many existing API router test files use this pattern in `vi.mock()` factories:
 *
 * ```ts
 * vi.mock('../../../../src/db/repositories/runsRepository.js', () => ({
 *   listRuns: (...args: unknown[]) => mockListRuns(...args),
 *   //        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 *   //        Unnecessary wrapper — wraps the mock in an anonymous function.
 *   //        Downsides: loses the mock's call tracking (toHaveBeenCalledWith won't
 *   //        work on the outer wrapper, only on the inner mockFn) and adds noise.
 * }));
 * ```
 *
 * **Preferred alternative using `vi.hoisted()`:**
 *
 * ```ts
 * const { mockListRuns } = vi.hoisted(() => ({
 *   mockListRuns: vi.fn(),
 * }));
 *
 * vi.mock('../../../../src/db/repositories/runsRepository.js', () => ({
 *   listRuns: mockListRuns,
 *   //        ^^^^^^^^^^ Direct assignment — no wrapper needed.
 *   //        vi.hoisted() ensures the mock is created before the vi.mock() factory runs,
 *   //        so the module factory can reference the mock function directly.
 * }));
 * ```
 *
 * `vi.hoisted()` runs before `vi.mock()` hoisting, so the mocks are available
 * when the factory executes. This is the idiomatic Vitest approach and avoids
 * the `(...args) => mockFn(...args)` indirection entirely.
 *
 * Migration of existing files is tracked as a separate story.
 */

import { TRPCError } from '@trpc/server';
import { expect, vi } from 'vitest';
import type { TRPCContext } from '../../src/api/trpc.js';

// ---------------------------------------------------------------------------
// createCallerFor
// ---------------------------------------------------------------------------

/**
 * A tRPC router that exposes `createCaller`. Matches the shape returned by
 * `router({...})` from `@trpc/server`.
 */
export interface TRPCRouter {
	createCaller(ctx: TRPCContext): unknown;
}

/**
 * Returns a typed caller factory for any tRPC router.
 *
 * Replaces the per-file boilerplate:
 * ```ts
 * function createCaller(ctx: TRPCContext) {
 *   return fooRouter.createCaller(ctx);
 * }
 * ```
 *
 * Usage:
 * ```ts
 * import { fooRouter } from '../../../../src/api/routers/foo.js';
 * import { createCallerFor } from '../../../helpers/trpcTestHarness.js';
 *
 * const createCaller = createCallerFor(fooRouter);
 *
 * // In tests:
 * const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
 * const result = await caller.list();
 * ```
 *
 * @param routerInstance - Any tRPC router with a `createCaller` method
 * @returns A function `(ctx: TRPCContext) => ReturnType<router.createCaller>`
 */
export function createCallerFor<TRouter extends TRPCRouter>(
	routerInstance: TRouter,
): (ctx: TRPCContext) => ReturnType<TRouter['createCaller']> {
	return (ctx: TRPCContext) =>
		routerInstance.createCaller(ctx) as ReturnType<TRouter['createCaller']>;
}

// ---------------------------------------------------------------------------
// setupOwnershipCheckMock
// ---------------------------------------------------------------------------

/**
 * The mock functions returned by `setupOwnershipCheckMock()`.
 */
export interface OwnershipCheckMocks {
	/** Mock for `db.select(...)` — returns `{ from: mockDbFrom }` */
	mockDbSelect: ReturnType<typeof vi.fn>;
	/** Mock for `db.select().from(...)` — returns `{ where: mockDbWhere }` */
	mockDbFrom: ReturnType<typeof vi.fn>;
	/** Mock for `db.select().from().where(...)` — resolves with query results */
	mockDbWhere: ReturnType<typeof vi.fn>;
	/**
	 * Convenience helper: configures `mockDbWhere` to resolve with a project row
	 * indicating the project belongs to `orgId`.
	 *
	 * Call this in each `it()` block (or `beforeEach`) where the procedure is
	 * expected to pass the ownership check.
	 *
	 * ```ts
	 * const { configureOwnership } = setupOwnershipCheckMock();
	 *
	 * it('returns data when project belongs to org', async () => {
	 *   configureOwnership('org-1');
	 *   const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
	 *   const result = await caller.list({ projectId: 'proj-1' });
	 *   expect(result).toEqual([...]);
	 * });
	 * ```
	 *
	 * @param orgId - The `orgId` the project should appear to belong to
	 */
	configureOwnership: (orgId: string) => void;
}

/**
 * Sets up mock functions for the Drizzle `select → from → where` ownership check
 * chain that 6+ API router test files wire identically.
 *
 * Returns `{ mockDbSelect, mockDbFrom, mockDbWhere, configureOwnership }`.
 *
 * **Note:** You still need to call `vi.mock()` for `../../../../src/db/client.js`
 * and `../../../../src/db/schema/index.js` in each test file (vi.mock calls must
 * remain in the file where they appear). Wire them up to the mocks returned here:
 *
 * ```ts
 * const { mockDbSelect, mockDbFrom, mockDbWhere, configureOwnership } =
 *   setupOwnershipCheckMock();
 *
 * vi.mock('../../../../src/db/client.js', () => ({
 *   getDb: () => ({ select: mockDbSelect }),
 * }));
 *
 * vi.mock('../../../../src/db/schema/index.js', () => ({
 *   projects: { id: 'id', orgId: 'org_id' },
 * }));
 *
 * beforeEach(() => {
 *   mockDbSelect.mockReturnValue({ from: mockDbFrom });
 *   mockDbFrom.mockReturnValue({ where: mockDbWhere });
 * });
 * ```
 *
 * @returns The three mock functions and the `configureOwnership` convenience helper
 */
export function setupOwnershipCheckMock(): OwnershipCheckMocks {
	const mockDbSelect = vi.fn();
	const mockDbFrom = vi.fn();
	const mockDbWhere = vi.fn();

	function configureOwnership(orgId: string): void {
		mockDbWhere.mockResolvedValue([{ orgId }]);
	}

	return { mockDbSelect, mockDbFrom, mockDbWhere, configureOwnership };
}

// ---------------------------------------------------------------------------
// expectTRPCError
// ---------------------------------------------------------------------------

/**
 * Valid tRPC error codes as defined by `@trpc/server`.
 */
export type TRPCErrorCode =
	| 'PARSE_ERROR'
	| 'BAD_REQUEST'
	| 'INTERNAL_SERVER_ERROR'
	| 'NOT_IMPLEMENTED'
	| 'UNAUTHORIZED'
	| 'FORBIDDEN'
	| 'NOT_FOUND'
	| 'METHOD_NOT_SUPPORTED'
	| 'TIMEOUT'
	| 'CONFLICT'
	| 'PRECONDITION_FAILED'
	| 'PAYLOAD_TOO_LARGE'
	| 'UNPROCESSABLE_CONTENT'
	| 'TOO_MANY_REQUESTS'
	| 'CLIENT_CLOSED_REQUEST';

/**
 * Asserts that a tRPC procedure call rejects with a `TRPCError` of the given code.
 *
 * Replaces the 30+ places in API router tests that do:
 * ```ts
 * try {
 *   await caller.someMethod(input);
 *   throw new Error('Expected to throw');
 * } catch (error) {
 *   expect(error).toBeInstanceOf(TRPCError);
 *   expect((error as TRPCError).code).toBe('UNAUTHORIZED');
 * }
 * ```
 * or the shorter (but less precise) form:
 * ```ts
 * await expect(caller.someMethod(input)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
 * ```
 *
 * Usage:
 * ```ts
 * it('throws UNAUTHORIZED when not authenticated', async () => {
 *   const caller = createCaller({ user: null, effectiveOrgId: null });
 *   await expectTRPCError(caller.list(), 'UNAUTHORIZED');
 * });
 *
 * it('throws FORBIDDEN for non-admin', async () => {
 *   const caller = createCaller({ user: memberUser, effectiveOrgId: 'org-1' });
 *   await expectTRPCError(caller.adminOnlyMethod(), 'FORBIDDEN');
 * });
 * ```
 *
 * @param promise - The promise returned by a tRPC caller method
 * @param code - The expected tRPC error code
 */
export async function expectTRPCError(
	promise: Promise<unknown>,
	code: TRPCErrorCode,
): Promise<void> {
	await expect(promise).rejects.toSatisfy((error: unknown) => {
		expect(error).toBeInstanceOf(TRPCError);
		expect((error as TRPCError).code).toBe(code);
		return true;
	});
}
