import { describe, expect, it, vi } from 'vitest';

// Must mock heavy imports BEFORE importing the module under test
vi.mock('../../../src/utils/webhookLogger.js', () => ({
	logWebhookCall: vi.fn(),
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

vi.mock('../../../src/utils/index.js', () => ({
	logger: {
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

import { captureException } from '../../../src/sentry.js';
import { logger } from '../../../src/utils/index.js';
import { logWebhookCall } from '../../../src/utils/webhookLogger.js';
import {
	handleProcessingError,
	logSuccessfulWebhook,
} from '../../../src/webhook/webhookLogging.js';

const mockLogWebhookCall = vi.mocked(logWebhookCall);
const mockCaptureException = vi.mocked(captureException);
const mockLogger = vi.mocked(logger);

/** Build a minimal Hono-like Context mock */
function makeContext(method = 'POST', path = '/webhook') {
	return {
		req: { method, path },
	} as unknown as import('hono').Context;
}

// ---------------------------------------------------------------------------
// logSuccessfulWebhook
// ---------------------------------------------------------------------------

describe('logSuccessfulWebhook', () => {
	it('calls logWebhookCall with correct core params', () => {
		const c = makeContext('POST', '/webhook/trello');
		const headers = { 'x-trello-webhook': 'abc' };
		const payload = { action: { type: 'commentCard' } };

		logSuccessfulWebhook('trello', c, headers, payload, 'commentCard');

		expect(mockLogWebhookCall).toHaveBeenCalledOnce();
		expect(mockLogWebhookCall).toHaveBeenCalledWith(
			expect.objectContaining({
				source: 'trello',
				method: 'POST',
				path: '/webhook/trello',
				headers,
				body: payload,
				statusCode: 200,
				eventType: 'commentCard',
			}),
		);
	});

	it('defaults processed=true when no logOverrides provided', () => {
		const c = makeContext();

		logSuccessfulWebhook('github', c, {}, { foo: 'bar' }, 'push');

		expect(mockLogWebhookCall).toHaveBeenCalledWith(expect.objectContaining({ processed: true }));
	});

	it('defaults processed=true when logOverrides is undefined', () => {
		const c = makeContext();

		logSuccessfulWebhook('jira', c, {}, {}, 'issue_updated', undefined);

		expect(mockLogWebhookCall).toHaveBeenCalledWith(expect.objectContaining({ processed: true }));
	});

	it('applies processed override from logOverrides', () => {
		const c = makeContext();

		logSuccessfulWebhook('trello', c, {}, {}, 'commentCard', { processed: false });

		expect(mockLogWebhookCall).toHaveBeenCalledWith(expect.objectContaining({ processed: false }));
	});

	it('applies projectId from logOverrides', () => {
		const c = makeContext();

		logSuccessfulWebhook('github', c, {}, {}, 'push', { projectId: 'proj-123' });

		expect(mockLogWebhookCall).toHaveBeenCalledWith(
			expect.objectContaining({ projectId: 'proj-123' }),
		);
	});

	it('applies decisionReason from logOverrides', () => {
		const c = makeContext();

		logSuccessfulWebhook('trello', c, {}, {}, 'commentCard', {
			decisionReason: 'No trigger matched',
		});

		expect(mockLogWebhookCall).toHaveBeenCalledWith(
			expect.objectContaining({ decisionReason: 'No trigger matched' }),
		);
	});

	it('applies all logOverride fields together', () => {
		const c = makeContext('POST', '/webhook/github');

		logSuccessfulWebhook('github', c, {}, { action: 'opened' }, 'pull_request', {
			processed: true,
			projectId: 'proj-456',
			decisionReason: 'PR opened trigger matched',
		});

		expect(mockLogWebhookCall).toHaveBeenCalledWith(
			expect.objectContaining({
				processed: true,
				projectId: 'proj-456',
				decisionReason: 'PR opened trigger matched',
			}),
		);
	});

	it('passes undefined eventType when not provided', () => {
		const c = makeContext();

		logSuccessfulWebhook('trello', c, {}, {}, undefined);

		expect(mockLogWebhookCall).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: undefined }),
		);
	});
});

// ---------------------------------------------------------------------------
// handleProcessingError
// ---------------------------------------------------------------------------

describe('handleProcessingError', () => {
	it('calls logger.error with source and error string for Error instances', () => {
		const err = new Error('queue connection failed');

		handleProcessingError('trello', err);

		expect(mockLogger.error).toHaveBeenCalledOnce();
		expect(mockLogger.error).toHaveBeenCalledWith('Error processing trello webhook', {
			error: 'Error: queue connection failed',
			stack: err.stack,
		});
	});

	it('calls logger.error with source and error string for non-Error values', () => {
		handleProcessingError('github', 'something went wrong');

		expect(mockLogger.error).toHaveBeenCalledWith('Error processing github webhook', {
			error: 'something went wrong',
			stack: undefined,
		});
	});

	it('calls logger.error for null values', () => {
		handleProcessingError('jira', null);

		expect(mockLogger.error).toHaveBeenCalledWith('Error processing jira webhook', {
			error: 'null',
			stack: undefined,
		});
	});

	it('calls captureException with an Error instance for Error values', () => {
		const err = new Error('redis connection failed');

		handleProcessingError('trello', err);

		expect(mockCaptureException).toHaveBeenCalledOnce();
		expect(mockCaptureException).toHaveBeenCalledWith(err, {
			tags: { source: 'trello_webhook' },
		});
	});

	it('wraps non-Error values in an Error before calling captureException', () => {
		handleProcessingError('github', 'string error');

		expect(mockCaptureException).toHaveBeenCalledOnce();
		const [capturedErr, options] = mockCaptureException.mock.calls[0];
		expect(capturedErr).toBeInstanceOf(Error);
		expect((capturedErr as Error).message).toBe('string error');
		expect(options).toEqual({ tags: { source: 'github_webhook' } });
	});

	it('wraps number values in an Error before calling captureException', () => {
		handleProcessingError('jira', 42);

		const [capturedErr] = mockCaptureException.mock.calls[0];
		expect(capturedErr).toBeInstanceOf(Error);
		expect((capturedErr as Error).message).toBe('42');
	});

	it('uses source in the Sentry tag with _webhook suffix', () => {
		const err = new Error('test');

		handleProcessingError('custom-source', err);

		expect(mockCaptureException).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ tags: { source: 'custom-source_webhook' } }),
		);
	});
});
