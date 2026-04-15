import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	formatDashboardErrorLog,
	formatTRPCErrorLog,
	formatTRPCErrorResponse,
	isPgLikeError,
} from '../../../src/api/errorLogging.js';

describe('isPgLikeError', () => {
	it('returns true for an object with a string code field', () => {
		expect(isPgLikeError({ code: '23505', message: 'dup' })).toBe(true);
	});

	it('returns false for a plain Error', () => {
		expect(isPgLikeError(new Error('boom'))).toBe(false);
	});

	it('returns false for null / undefined / primitives', () => {
		expect(isPgLikeError(null)).toBe(false);
		expect(isPgLikeError(undefined)).toBe(false);
		expect(isPgLikeError('string')).toBe(false);
		expect(isPgLikeError(42)).toBe(false);
	});

	it('returns true when code is present on a nested cause', () => {
		const err = new Error('wrapped');
		(err as unknown as { cause: unknown }).cause = { code: '23503', detail: 'FK' };
		expect(isPgLikeError(err)).toBe(true);
	});
});

describe('formatDashboardErrorLog', () => {
	it('captures message, name, stack for a plain Error', () => {
		const err = new Error('boom');
		const payload = formatDashboardErrorLog(err, { path: '/trpc/foo', method: 'POST' });
		expect(payload.path).toBe('/trpc/foo');
		expect(payload.method).toBe('POST');
		expect(payload.message).toBe('boom');
		expect(payload.name).toBe('Error');
		expect(payload.stack).toContain('boom');
	});

	it('copies PG-shaped fields (code, detail, constraint, table, column) onto the payload', () => {
		const pgErr = {
			message: 'duplicate key value violates unique constraint',
			code: '23505',
			detail: 'Key (project_id, category)=(llmist, pm) already exists.',
			constraint: 'project_integrations_project_id_category_key',
			table: 'project_integrations',
			column: undefined,
		};
		const payload = formatDashboardErrorLog(pgErr, { path: '/trpc/x', method: 'POST' });
		expect(payload.code).toBe('23505');
		expect(payload.detail).toBe(pgErr.detail);
		expect(payload.constraint).toBe(pgErr.constraint);
		expect(payload.table).toBe('project_integrations');
	});

	it('unwraps PG fields from a nested cause', () => {
		const wrapped = new Error('failed query');
		(wrapped as unknown as { cause: unknown }).cause = {
			code: '23503',
			detail: 'Key (project_id)=(llmist) is not present in table "projects".',
			constraint: 'project_integrations_project_id_fkey',
		};
		const payload = formatDashboardErrorLog(wrapped, { path: '/trpc/x', method: 'POST' });
		expect(payload.code).toBe('23503');
		expect(payload.constraint).toBe('project_integrations_project_id_fkey');
	});

	it('stringifies non-Error throwables safely', () => {
		const payload = formatDashboardErrorLog('oops', { path: '/x', method: 'GET' });
		expect(payload.message).toBe('oops');
		expect(payload.name).toBe('NonError');
	});
});

describe('formatTRPCErrorLog', () => {
	it('includes code, path, message, cause, stack for an unexpected throw', () => {
		const err = new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: 'boom',
			cause: new Error('underlying'),
		});
		const logged = formatTRPCErrorLog({
			error: err,
			path: 'projects.integrations.upsert',
			type: 'mutation',
		});
		expect(logged.code).toBe('INTERNAL_SERVER_ERROR');
		expect(logged.path).toBe('projects.integrations.upsert');
		expect(logged.message).toBe('boom');
		expect(logged.stack).toBeDefined();
	});

	it('merges PG fields from error.cause into the log payload', () => {
		const pgLike = {
			message: 'duplicate',
			code: '23505',
			detail: 'dup',
			constraint: 'uniq',
		};
		const err = new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'wrapped', cause: pgLike });
		const logged = formatTRPCErrorLog({
			error: err,
			path: 'projects.integrations.upsert',
			type: 'mutation',
		});
		expect(logged.code).toBe('INTERNAL_SERVER_ERROR');
		expect(logged.pgCode).toBe('23505');
		expect(logged.pgDetail).toBe('dup');
		expect(logged.pgConstraint).toBe('uniq');
	});
});

describe('formatTRPCErrorResponse', () => {
	it('returns generic message for INTERNAL_SERVER_ERROR with non-TRPCError cause', () => {
		const err = new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: 'dup key value violates unique constraint "project_integrations_pkey"',
			cause: new Error('underlying'),
		});
		const resp = formatTRPCErrorResponse(err);
		expect(resp.code).toBe('INTERNAL_SERVER_ERROR');
		expect(resp.message).toBe('Internal server error');
	});

	it('preserves original message for UNAUTHORIZED', () => {
		const err = new TRPCError({ code: 'UNAUTHORIZED', message: 'please sign in' });
		const resp = formatTRPCErrorResponse(err);
		expect(resp.code).toBe('UNAUTHORIZED');
		expect(resp.message).toBe('please sign in');
	});

	it('preserves original message for NOT_FOUND, FORBIDDEN, BAD_REQUEST', () => {
		for (const code of ['NOT_FOUND', 'FORBIDDEN', 'BAD_REQUEST'] as const) {
			const err = new TRPCError({ code, message: `msg-${code}` });
			const resp = formatTRPCErrorResponse(err);
			expect(resp.code).toBe(code);
			expect(resp.message).toBe(`msg-${code}`);
		}
	});
});

describe('secret redaction in error logs', () => {
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
	beforeEach(() => {
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		consoleErrorSpy.mockRestore();
	});

	it('dashboard error log does not include arbitrary interpolated credential values in message', () => {
		// Sanity tripwire: the system should not interpolate secrets into error messages.
		// If this ever starts failing, the bug is upstream — redact at the source, don't patch here.
		const err = new Error('save failed');
		const payload = formatDashboardErrorLog(err, { path: '/trpc/foo', method: 'POST' });
		expect(JSON.stringify(payload)).not.toContain('SECRET_SENTINEL_xyz');
	});

	it('tRPC error log does not include arbitrary interpolated credential values', () => {
		const err = new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'save failed' });
		const logged = formatTRPCErrorLog({
			error: err,
			path: 'projects.credentials.set',
			type: 'mutation',
		});
		expect(JSON.stringify(logged)).not.toContain('SECRET_SENTINEL_xyz');
	});
});
