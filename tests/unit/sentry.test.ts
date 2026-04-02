import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @sentry/node before any import (ESM exports are frozen, vi.spyOn won't work)
vi.mock('@sentry/node', () => ({
	init: vi.fn(),
	withScope: vi.fn((cb: (scope: unknown) => void) => cb(mockScope)),
	captureException: vi.fn(),
	addBreadcrumb: vi.fn(),
	setTag: vi.fn(),
	flush: vi.fn().mockResolvedValue(true),
}));

const mockScope = {
	setTag: vi.fn(),
	setExtra: vi.fn(),
	setLevel: vi.fn(),
};

import * as Sentry from '@sentry/node';

describe('sentry wrappers', () => {
	describe('when SENTRY_DSN is NOT set (disabled)', () => {
		let sentry: typeof import('../../src/sentry.js');

		beforeEach(async () => {
			vi.resetModules();
			delete process.env.SENTRY_DSN;
			sentry = await import('../../src/sentry.js');
		});

		it('sentryEnabled is false', () => {
			expect(sentry.sentryEnabled).toBe(false);
		});

		it('captureException does not call Sentry', () => {
			sentry.captureException(new Error('test'));
			expect(Sentry.withScope).not.toHaveBeenCalled();
		});

		it('addBreadcrumb does not call Sentry', () => {
			sentry.addBreadcrumb({ message: 'test', category: 'test' });
			expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
		});

		it('setTag does not call Sentry', () => {
			sentry.setTag('key', 'value');
			expect(Sentry.setTag).not.toHaveBeenCalled();
		});

		it('flush resolves without calling Sentry', async () => {
			await sentry.flush();
			expect(Sentry.flush).not.toHaveBeenCalled();
		});
	});

	describe('when SENTRY_DSN IS set (enabled)', () => {
		let sentry: typeof import('../../src/sentry.js');

		beforeEach(async () => {
			vi.resetModules();
			for (const k of Object.keys(mockScope)) mockScope[k as keyof typeof mockScope].mockClear();
			process.env.SENTRY_DSN = 'https://fake@sentry.io/123';
			sentry = await import('../../src/sentry.js');
		});

		afterEach(() => {
			delete process.env.SENTRY_DSN;
		});

		it('sentryEnabled is true', () => {
			expect(sentry.sentryEnabled).toBe(true);
		});

		it('captureException delegates to Sentry.withScope', () => {
			sentry.captureException(new Error('test'));
			expect(Sentry.withScope).toHaveBeenCalledTimes(1);
			expect(Sentry.captureException).toHaveBeenCalled();
		});

		it('captureException sets tags, extra, and level on scope', () => {
			const error = new Error('test');
			sentry.captureException(error, {
				tags: { source: 'test_source', role: 'worker' },
				extra: { jobId: '123' },
				level: 'fatal',
			});

			expect(mockScope.setTag).toHaveBeenCalledWith('source', 'test_source');
			expect(mockScope.setTag).toHaveBeenCalledWith('role', 'worker');
			expect(mockScope.setExtra).toHaveBeenCalledWith('jobId', '123');
			expect(mockScope.setLevel).toHaveBeenCalledWith('fatal');
			expect(Sentry.captureException).toHaveBeenCalledWith(error);
		});

		it('captureException works with no context', () => {
			const error = new Error('bare error');
			sentry.captureException(error);
			expect(Sentry.captureException).toHaveBeenCalledWith(error);
			expect(mockScope.setTag).not.toHaveBeenCalled();
			expect(mockScope.setExtra).not.toHaveBeenCalled();
			expect(mockScope.setLevel).not.toHaveBeenCalled();
		});

		it('addBreadcrumb delegates to Sentry', () => {
			const breadcrumb = { message: 'test', category: 'http' };
			sentry.addBreadcrumb(breadcrumb);
			expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(breadcrumb);
		});

		it('setTag delegates to Sentry', () => {
			sentry.setTag('role', 'router');
			expect(Sentry.setTag).toHaveBeenCalledWith('role', 'router');
		});

		it('flush delegates to Sentry.flush with timeout', async () => {
			await sentry.flush(5000);
			expect(Sentry.flush).toHaveBeenCalledWith(5000);
		});

		it('flush uses default 2000ms timeout', async () => {
			await sentry.flush();
			expect(Sentry.flush).toHaveBeenCalledWith(2000);
		});
	});
});
