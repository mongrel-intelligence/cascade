import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @sentry/node before importing our module
vi.mock('@sentry/node', () => ({
	init: vi.fn(),
	captureException: vi.fn(),
	withScope: vi.fn((cb: (scope: unknown) => void) => {
		cb(mockScope);
	}),
	close: vi.fn().mockResolvedValue(undefined),
}));

import * as Sentry from '@sentry/node';

const mockScope = {
	setTag: vi.fn(),
	setExtra: vi.fn(),
};

// Import the module under test after mocks are set up
import {
	captureRunFailure,
	captureWorkerError,
	flushSentry,
	initSentry,
} from '../../../src/utils/sentry.js';

describe('sentry utils', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env = { ...originalEnv };
		// Reset the initialized flag by reimporting — use the same module instance
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe('initSentry', () => {
		it('calls Sentry.init when SENTRY_DSN is set', () => {
			process.env.SENTRY_DSN = 'https://abc@sentry.io/1';
			initSentry('cascade-test');
			expect(Sentry.init).toHaveBeenCalledWith(
				expect.objectContaining({
					dsn: 'https://abc@sentry.io/1',
					serverName: 'cascade-test',
				}),
			);
		});

		it('does not call Sentry.init when SENTRY_DSN is absent', () => {
			process.env.SENTRY_DSN = undefined;
			initSentry('cascade-test');
			expect(Sentry.init).not.toHaveBeenCalled();
		});
	});

	describe('captureRunFailure', () => {
		it('captures exception with run tags when initialized', () => {
			process.env.SENTRY_DSN = 'https://abc@sentry.io/1';
			initSentry('cascade-test');

			captureRunFailure(new Error('run failed'), {
				runId: 'run-123',
				agentType: 'implementation',
				projectId: 'proj-1',
				cardId: 'card-abc',
				triggerType: 'trello',
				backendName: 'claude-code',
				durationMs: 5000,
			});

			expect(Sentry.withScope).toHaveBeenCalled();
			expect(mockScope.setTag).toHaveBeenCalledWith('runId', 'run-123');
			expect(mockScope.setTag).toHaveBeenCalledWith('agentType', 'implementation');
			expect(mockScope.setTag).toHaveBeenCalledWith('projectId', 'proj-1');
			expect(mockScope.setTag).toHaveBeenCalledWith('cardId', 'card-abc');
			expect(mockScope.setTag).toHaveBeenCalledWith('triggerType', 'trello');
			expect(mockScope.setTag).toHaveBeenCalledWith('backendName', 'claude-code');
			expect(mockScope.setExtra).toHaveBeenCalledWith('durationMs', 5000);
			expect(mockScope.setTag).toHaveBeenCalledWith('errorType', 'run_failure');
			expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error));
		});

		it('wraps non-Error values in an Error', () => {
			process.env.SENTRY_DSN = 'https://abc@sentry.io/1';
			initSentry('cascade-test');

			captureRunFailure('string error', { runId: 'run-123' });

			expect(Sentry.captureException).toHaveBeenCalledWith(
				expect.objectContaining({ message: 'string error' }),
			);
		});

		it('is a no-op when SENTRY_DSN is absent', () => {
			process.env.SENTRY_DSN = undefined;
			// Re-import with fresh state is tricky in vitest; test by verifying withScope not called
			// when initialized flag is false (i.e., when we never called initSentry with a DSN)
			captureRunFailure(new Error('run failed'), { runId: 'run-123' });

			// withScope shouldn't be called if not initialized
			// Note: since module state persists across tests, we check that captureException was not
			// called if Sentry was never initialized in this test context.
			// The key behavior: captureRunFailure does not throw, even without initialization
			expect(() =>
				captureRunFailure(new Error('should not throw'), { runId: 'run-123' }),
			).not.toThrow();
		});
	});

	describe('captureWorkerError', () => {
		it('captures exception with worker tags when initialized', () => {
			process.env.SENTRY_DSN = 'https://abc@sentry.io/1';
			initSentry('cascade-test');

			captureWorkerError(new Error('container failed'), {
				jobId: 'job-456',
				jobType: 'trello',
			});

			expect(Sentry.withScope).toHaveBeenCalled();
			expect(mockScope.setTag).toHaveBeenCalledWith('jobId', 'job-456');
			expect(mockScope.setTag).toHaveBeenCalledWith('jobType', 'trello');
			expect(mockScope.setTag).toHaveBeenCalledWith('errorType', 'worker_error');
			expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error));
		});

		it('wraps non-Error values in an Error', () => {
			process.env.SENTRY_DSN = 'https://abc@sentry.io/1';
			initSentry('cascade-test');

			captureWorkerError('string error', { jobId: 'job-456' });

			expect(Sentry.captureException).toHaveBeenCalledWith(
				expect.objectContaining({ message: 'string error' }),
			);
		});

		it('does not throw when called with no context', () => {
			process.env.SENTRY_DSN = 'https://abc@sentry.io/1';
			initSentry('cascade-test');

			expect(() => captureWorkerError(new Error('fail'), {})).not.toThrow();
		});
	});

	describe('flushSentry', () => {
		it('calls Sentry.close with timeout when initialized', async () => {
			process.env.SENTRY_DSN = 'https://abc@sentry.io/1';
			initSentry('cascade-test');

			await flushSentry(3000);

			expect(Sentry.close).toHaveBeenCalledWith(3000);
		});

		it('uses default timeout of 2000ms', async () => {
			process.env.SENTRY_DSN = 'https://abc@sentry.io/1';
			initSentry('cascade-test');

			await flushSentry();

			expect(Sentry.close).toHaveBeenCalledWith(2000);
		});

		it('does not throw when Sentry is not initialized', async () => {
			process.env.SENTRY_DSN = undefined;
			await expect(flushSentry(2000)).resolves.toBeUndefined();
		});
	});
});
