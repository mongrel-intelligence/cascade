import { TRPCError } from '@trpc/server';

/**
 * Shape of a `pg` driver error (or anything wrapping one, e.g. Drizzle).
 * Exposed so the Hono error handler and the tRPC error formatter both surface
 * the same diagnostic fields in server logs.
 */
export interface PgLikeError {
	code: string;
	message?: string;
	detail?: string;
	constraint?: string;
	table?: string;
	column?: string;
	schema?: string;
}

function asPgLike(value: unknown): PgLikeError | null {
	if (value === null || typeof value !== 'object') return null;
	if (value instanceof TRPCError) return null;
	const rec = value as Record<string, unknown>;
	if (typeof rec.code !== 'string') return null;
	return {
		code: rec.code,
		message: typeof rec.message === 'string' ? rec.message : undefined,
		detail: typeof rec.detail === 'string' ? rec.detail : undefined,
		constraint: typeof rec.constraint === 'string' ? rec.constraint : undefined,
		table: typeof rec.table === 'string' ? rec.table : undefined,
		column: typeof rec.column === 'string' ? rec.column : undefined,
		schema: typeof rec.schema === 'string' ? rec.schema : undefined,
	};
}

/**
 * Returns true if `err` (or a direct `.cause`) looks like a pg-driver error
 * with a string `code` field.
 */
export function isPgLikeError(err: unknown): boolean {
	if (asPgLike(err)) return true;
	if (err && typeof err === 'object' && 'cause' in err) {
		const cause = (err as { cause: unknown }).cause;
		if (asPgLike(cause)) return true;
	}
	return false;
}

function extractPgFields(err: unknown): PgLikeError | null {
	const direct = asPgLike(err);
	if (direct) return direct;
	if (err && typeof err === 'object' && 'cause' in err) {
		return asPgLike((err as { cause: unknown }).cause);
	}
	return null;
}

export interface DashboardErrorLogPayload {
	path: string;
	method: string;
	name: string;
	message: string;
	stack?: string;
	code?: string;
	detail?: string;
	constraint?: string;
	table?: string;
	column?: string;
}

/**
 * Build a structured log payload for `app.onError` in the Hono dashboard.
 * Includes PG-error diagnostic fields when present (on the error or its cause).
 */
export function formatDashboardErrorLog(
	err: unknown,
	ctx: { path: string; method: string },
): DashboardErrorLogPayload {
	let name = 'NonError';
	let message = '';
	let stack: string | undefined;
	if (err instanceof Error) {
		name = err.name || 'Error';
		message = err.message;
		stack = err.stack;
	} else if (typeof err === 'string') {
		message = err;
	} else {
		try {
			message = JSON.stringify(err);
		} catch {
			message = String(err);
		}
	}

	const payload: DashboardErrorLogPayload = {
		path: ctx.path,
		method: ctx.method,
		name,
		message,
		stack,
	};

	const pg = extractPgFields(err);
	if (pg) {
		payload.code = pg.code;
		if (pg.detail !== undefined) payload.detail = pg.detail;
		if (pg.constraint !== undefined) payload.constraint = pg.constraint;
		if (pg.table !== undefined) payload.table = pg.table;
		if (pg.column !== undefined) payload.column = pg.column;
	}

	return payload;
}

export interface TRPCErrorLogPayload {
	code: string;
	path: string;
	type?: string;
	message: string;
	stack?: string;
	cause?: string;
	pgCode?: string;
	pgDetail?: string;
	pgConstraint?: string;
	pgTable?: string;
	pgColumn?: string;
}

/**
 * Build a structured log payload for tRPC errors. Invoked by the tRPC
 * `errorFormatter` server-side so operators can grep `cascade-dashboard-dev`
 * logs and see real DB error messages instead of just an HTTP 500.
 */
export function formatTRPCErrorLog(opts: {
	error: TRPCError;
	path?: string | null;
	type?: string;
}): TRPCErrorLogPayload {
	const { error } = opts;
	const payload: TRPCErrorLogPayload = {
		code: error.code,
		path: opts.path ?? '',
		type: opts.type,
		message: error.message,
		stack: error.stack,
	};

	const cause = (error as unknown as { cause?: unknown }).cause;
	if (cause instanceof Error) {
		payload.cause = `${cause.name}: ${cause.message}`;
	} else if (cause !== undefined) {
		try {
			payload.cause = JSON.stringify(cause);
		} catch {
			payload.cause = String(cause);
		}
	}

	const pg = extractPgFields(error) ?? extractPgFields(cause);
	if (pg) {
		payload.pgCode = pg.code;
		if (pg.detail !== undefined) payload.pgDetail = pg.detail;
		if (pg.constraint !== undefined) payload.pgConstraint = pg.constraint;
		if (pg.table !== undefined) payload.pgTable = pg.table;
		if (pg.column !== undefined) payload.pgColumn = pg.column;
	}

	return payload;
}

/**
 * Shape the tRPC error response sent to the client. Swaps the message for
 * an unexpected INTERNAL_SERVER_ERROR with a generic placeholder so raw DB
 * error text never reaches the browser.
 */
export function formatTRPCErrorResponse(error: TRPCError): { code: string; message: string } {
	if (error.code === 'INTERNAL_SERVER_ERROR') {
		return { code: error.code, message: 'Internal server error' };
	}
	return { code: error.code, message: error.message };
}
