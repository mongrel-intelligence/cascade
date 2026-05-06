import { describe, expect, it } from 'vitest';
import { BootFailureError } from '../../../../src/agents/shared/bootFailureError.js';

describe('BootFailureError', () => {
	it('preserves the original error message', () => {
		const err = new BootFailureError('plan resolution failed', { phase: 'plan-resolution' });
		expect(err.message).toContain('plan resolution failed');
		expect(err.name).toBe('BootFailureError');
	});

	it('exposes the structured phase field', () => {
		const err = new BootFailureError('x', { phase: 'plan-resolution' });
		expect(err.phase).toBe('plan-resolution');
	});

	it('chains a cause when one is provided', () => {
		const cause = new Error('ENOENT: alerting.eta');
		const err = new BootFailureError('plan resolution failed', {
			phase: 'plan-resolution',
			cause,
		});
		expect(String(err)).toContain('ENOENT: alerting.eta');
		expect(err.cause).toBe(cause);
		// Stack trace includes the chained cause for debugging
		expect(err.stack).toContain('Caused by');
	});

	it('is distinguishable from a generic Error in catch blocks', () => {
		try {
			throw new BootFailureError('boom', { phase: 'plan-resolution' });
		} catch (caught) {
			expect(caught).toBeInstanceOf(BootFailureError);
			expect(caught).toBeInstanceOf(Error);
			expect(caught instanceof BootFailureError).toBe(true);
		}
	});

	it('survives being thrown across an async boundary', async () => {
		async function inner() {
			throw new BootFailureError('boom', { phase: 'gadget-allowlist' });
		}
		await expect(inner()).rejects.toThrow(BootFailureError);
	});
});
