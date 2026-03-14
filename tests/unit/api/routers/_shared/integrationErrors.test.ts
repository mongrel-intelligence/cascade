import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import { wrapIntegrationCall } from '../../../../../src/api/routers/_shared/integrationErrors.js';

describe('wrapIntegrationCall', () => {
	it('returns the result of a successful async callback', async () => {
		const result = await wrapIntegrationCall('test label', async () => 'success');
		expect(result).toBe('success');
	});

	it('re-throws TRPCError unchanged', async () => {
		const original = new TRPCError({ code: 'NOT_FOUND', message: 'Not found' });

		const error = await wrapIntegrationCall('test label', async () => {
			throw original;
		}).catch((e) => e);

		expect(error).toBe(original);
		expect(error.code).toBe('NOT_FOUND');
		expect(error.message).toBe('Not found');
	});

	it('wraps a plain Error in BAD_REQUEST with label prefix', async () => {
		const error = await wrapIntegrationCall('Failed to fetch data', async () => {
			throw new Error('Network error');
		}).catch((e) => e);

		expect(error).toBeInstanceOf(TRPCError);
		expect(error.code).toBe('BAD_REQUEST');
		expect(error.message).toBe('Failed to fetch data: Network error');
	});

	it('wraps a non-Error thrown value (string) in BAD_REQUEST', async () => {
		const error = await wrapIntegrationCall('Operation failed', async () => {
			// eslint-disable-next-line @typescript-eslint/no-throw-literal
			throw 'something bad';
		}).catch((e) => e);

		expect(error).toBeInstanceOf(TRPCError);
		expect(error.code).toBe('BAD_REQUEST');
		expect(error.message).toBe('Operation failed: something bad');
	});

	it('wraps a non-Error thrown value (object) by calling String()', async () => {
		const error = await wrapIntegrationCall('Op', async () => {
			// eslint-disable-next-line @typescript-eslint/no-throw-literal
			throw { custom: 'error object' };
		}).catch((e) => e);

		expect(error).toBeInstanceOf(TRPCError);
		expect(error.code).toBe('BAD_REQUEST');
		expect(error.message).toBe('Op: [object Object]');
	});
});
