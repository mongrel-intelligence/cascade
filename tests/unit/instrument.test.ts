import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({
	init: vi.fn(),
}));

import * as Sentry from '@sentry/node';

const mockInit = vi.mocked(Sentry.init);

describe('instrument (Sentry init)', () => {
	beforeEach(() => {
		vi.resetModules();
		mockInit.mockClear();
	});

	afterEach(() => {
		// biome-ignore lint/performance/noDelete: process.env requires delete to truly unset
		delete process.env.SENTRY_DSN;
		// biome-ignore lint/performance/noDelete: process.env requires delete to truly unset
		delete process.env.SENTRY_ENVIRONMENT;
		// biome-ignore lint/performance/noDelete: process.env requires delete to truly unset
		delete process.env.SENTRY_RELEASE;
		// biome-ignore lint/performance/noDelete: process.env requires delete to truly unset
		delete process.env.SENTRY_TRACES_SAMPLE_RATE;
	});

	it('does NOT call Sentry.init when SENTRY_DSN is unset', async () => {
		// biome-ignore lint/performance/noDelete: process.env requires delete to truly unset
		delete process.env.SENTRY_DSN;
		await import('../../src/instrument.js');
		expect(mockInit).not.toHaveBeenCalled();
	});

	it('calls Sentry.init with DSN when SENTRY_DSN is set', async () => {
		process.env.SENTRY_DSN = 'https://fake@sentry.io/123';
		await import('../../src/instrument.js');
		expect(mockInit).toHaveBeenCalledWith(
			expect.objectContaining({ dsn: 'https://fake@sentry.io/123' }),
		);
	});

	it('passes environment from SENTRY_ENVIRONMENT', async () => {
		process.env.SENTRY_DSN = 'https://fake@sentry.io/123';
		process.env.SENTRY_ENVIRONMENT = 'staging';
		await import('../../src/instrument.js');
		expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({ environment: 'staging' }));
	});

	it('falls back to NODE_ENV for environment', async () => {
		process.env.SENTRY_DSN = 'https://fake@sentry.io/123';
		// biome-ignore lint/performance/noDelete: process.env requires delete to truly unset
		delete process.env.SENTRY_ENVIRONMENT;
		const originalNodeEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = 'test';
		await import('../../src/instrument.js');
		expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({ environment: 'test' }));
		process.env.NODE_ENV = originalNodeEnv;
	});

	it('passes release from SENTRY_RELEASE', async () => {
		process.env.SENTRY_DSN = 'https://fake@sentry.io/123';
		process.env.SENTRY_RELEASE = 'abc123';
		await import('../../src/instrument.js');
		expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({ release: 'abc123' }));
	});

	it('defaults tracesSampleRate to 0.1', async () => {
		process.env.SENTRY_DSN = 'https://fake@sentry.io/123';
		// biome-ignore lint/performance/noDelete: process.env requires delete to truly unset
		delete process.env.SENTRY_TRACES_SAMPLE_RATE;
		await import('../../src/instrument.js');
		expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({ tracesSampleRate: 0.1 }));
	});

	it('respects SENTRY_TRACES_SAMPLE_RATE=0 (does not fall back to 0.1)', async () => {
		process.env.SENTRY_DSN = 'https://fake@sentry.io/123';
		process.env.SENTRY_TRACES_SAMPLE_RATE = '0';
		await import('../../src/instrument.js');
		expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({ tracesSampleRate: 0 }));
	});

	it('parses SENTRY_TRACES_SAMPLE_RATE=1 correctly', async () => {
		process.env.SENTRY_DSN = 'https://fake@sentry.io/123';
		process.env.SENTRY_TRACES_SAMPLE_RATE = '1';
		await import('../../src/instrument.js');
		expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({ tracesSampleRate: 1 }));
	});

	it('disables PII collection', async () => {
		process.env.SENTRY_DSN = 'https://fake@sentry.io/123';
		await import('../../src/instrument.js');
		expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({ sendDefaultPii: false }));
	});
});
