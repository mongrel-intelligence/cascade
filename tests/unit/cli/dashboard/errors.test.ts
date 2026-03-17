import { TRPCClientError } from '@trpc/client';
import { describe, expect, it } from 'vitest';
import {
	formatActionableError,
	isNetworkError,
	mapError,
	mapTRPCError,
} from '../../../../src/cli/dashboard/_shared/errors.js';

/**
 * Helper to create a TRPCClientError with a given TRPC error code.
 */
function makeTRPCError(code: string, message = 'Some TRPC error'): TRPCClientError<never> {
	const err = new TRPCClientError(message);
	// Manually assign data with code
	Object.assign(err, { data: { code } });
	return err;
}

describe('mapTRPCError', () => {
	it('maps UNAUTHORIZED to login suggestion', () => {
		const err = makeTRPCError('UNAUTHORIZED');
		const result = mapTRPCError(err);
		expect(result.message).toContain('Authentication required');
		expect(result.suggestion).toContain('cascade login');
	});

	it('maps FORBIDDEN to access denied', () => {
		const err = makeTRPCError('FORBIDDEN');
		const result = mapTRPCError(err);
		expect(result.message).toContain('Access denied');
		expect(result.suggestion).toBeDefined();
	});

	it('maps NOT_FOUND with list suggestion', () => {
		const err = makeTRPCError('NOT_FOUND', 'Resource not found');
		const result = mapTRPCError(err);
		expect(result.suggestion).toContain('cascade <resource> list');
	});

	it('maps BAD_REQUEST with validation details', () => {
		const err = makeTRPCError('BAD_REQUEST', 'email is required');
		const result = mapTRPCError(err);
		expect(result.message).toContain('Invalid request');
		expect(result.message).toContain('email is required');
		expect(result.suggestion).toBeDefined();
	});

	it('returns plain message for unknown error codes', () => {
		const err = makeTRPCError('INTERNAL_SERVER_ERROR', 'Something broke');
		const result = mapTRPCError(err);
		expect(result.message).toBe('Something broke');
		expect(result.suggestion).toBeUndefined();
	});
});

describe('isNetworkError', () => {
	it('returns false for non-Error values', () => {
		expect(isNetworkError('string')).toBe(false);
		expect(isNetworkError(null)).toBe(false);
		expect(isNetworkError(42)).toBe(false);
	});

	it('returns true when message contains ECONNREFUSED (lowercase)', () => {
		const err = new Error('connect econnrefused 127.0.0.1:3001');
		expect(isNetworkError(err)).toBe(true);
	});

	it('returns true when message contains ENOTFOUND (lowercase)', () => {
		const err = new Error('getaddrinfo enotfound localhost');
		expect(isNetworkError(err)).toBe(true);
	});

	it('returns true when error code is ECONNREFUSED', () => {
		const err = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
		expect(isNetworkError(err)).toBe(true);
	});

	it('returns true when error code is ENOTFOUND', () => {
		const err = Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
		expect(isNetworkError(err)).toBe(true);
	});

	it('returns true when nested cause contains ECONNREFUSED', () => {
		const cause = new Error('connect ECONNREFUSED');
		const err = new Error('fetch failed', { cause });
		expect(isNetworkError(err)).toBe(true);
	});

	it('returns false for unrelated errors', () => {
		const err = new Error('some unrelated error');
		expect(isNetworkError(err)).toBe(false);
	});
});

describe('mapError', () => {
	it('maps TRPC UNAUTHORIZED to login suggestion', () => {
		const err = makeTRPCError('UNAUTHORIZED');
		const result = mapError(err);
		expect(result.suggestion).toContain('cascade login');
	});

	it('maps TRPC NOT_FOUND to list suggestion', () => {
		const err = makeTRPCError('NOT_FOUND', 'Not found');
		const result = mapError(err);
		expect(result.suggestion).toContain('cascade <resource> list');
	});

	it('maps network errors (ECONNREFUSED) with server URL in message', () => {
		const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3001'), {
			code: 'ECONNREFUSED',
		});
		const result = mapError(err, 'http://localhost:3001');
		expect(result.message).toContain('http://localhost:3001');
		expect(result.suggestion).toContain('dashboard running');
	});

	it('maps network errors without server URL', () => {
		const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3001'), {
			code: 'ECONNREFUSED',
		});
		const result = mapError(err);
		expect(result.message).toContain('Cannot reach server');
		expect(result.suggestion).toContain('dashboard running');
	});

	it('maps TRPCClientError with network cause to connection error', () => {
		const cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
		const trpcErr = new TRPCClientError('fetch failed', { cause });
		const result = mapError(trpcErr, 'http://localhost:3001');
		expect(result.message).toContain('Cannot reach server');
		expect(result.suggestion).toContain('dashboard running');
	});

	it('returns plain message for regular Error', () => {
		const err = new Error('something went wrong');
		const result = mapError(err);
		expect(result.message).toBe('something went wrong');
		expect(result.suggestion).toBeUndefined();
	});

	it('converts non-Error to string message', () => {
		const result = mapError('some string error');
		expect(result.message).toBe('some string error');
	});
});

describe('formatActionableError', () => {
	it('returns message only when no suggestion', () => {
		const result = formatActionableError({ message: 'Something failed' });
		expect(result).toBe('Something failed');
	});

	it('appends suggestion with indentation', () => {
		const result = formatActionableError({
			message: 'Access denied.',
			suggestion: "Run 'cascade login'.",
		});
		expect(result).toBe("Access denied.\n  Run 'cascade login'.");
	});
});
