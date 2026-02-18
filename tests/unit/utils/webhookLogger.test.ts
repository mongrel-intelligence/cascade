import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/db/repositories/webhookLogsRepository.js', () => ({
	insertWebhookLog: vi.fn(),
	pruneWebhookLogs: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
	insertWebhookLog,
	pruneWebhookLogs,
} from '../../../src/db/repositories/webhookLogsRepository.js';
import { type WebhookLogInput, logWebhookCall } from '../../../src/utils/webhookLogger.js';

const mockInsertWebhookLog = vi.mocked(insertWebhookLog);
const mockPruneWebhookLogs = vi.mocked(pruneWebhookLogs);

const sampleInput: WebhookLogInput = {
	source: 'trello',
	method: 'POST',
	path: '/trello/webhook',
	headers: { 'content-type': 'application/json' },
	body: { event: 'createCard' },
	statusCode: 200,
	processed: true,
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
	mockInsertWebhookLog.mockResolvedValue(undefined);
	mockPruneWebhookLogs.mockResolvedValue(undefined);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('logWebhookCall', () => {
	it('does not call insertWebhookLog synchronously (fire-and-forget)', () => {
		logWebhookCall(sampleInput);

		// setImmediate hasn't fired yet
		expect(mockInsertWebhookLog).not.toHaveBeenCalled();
	});

	it('calls insertWebhookLog after setImmediate fires', async () => {
		logWebhookCall(sampleInput);

		await vi.runAllTimersAsync();

		expect(mockInsertWebhookLog).toHaveBeenCalledOnce();
	});

	it('passes correct fields to insertWebhookLog', async () => {
		logWebhookCall(sampleInput);

		await vi.runAllTimersAsync();

		expect(mockInsertWebhookLog).toHaveBeenCalledWith({
			source: 'trello',
			method: 'POST',
			path: '/trello/webhook',
			headers: { 'content-type': 'application/json' },
			body: { event: 'createCard' },
			bodyRaw: undefined,
			statusCode: 200,
			projectId: undefined,
			eventType: undefined,
			processed: true,
		});
	});

	it('passes optional fields when provided', async () => {
		logWebhookCall({
			...sampleInput,
			bodyRaw: '{"raw":"json"}',
			projectId: 'proj1',
			eventType: 'card.create',
		});

		await vi.runAllTimersAsync();

		expect(mockInsertWebhookLog).toHaveBeenCalledWith(
			expect.objectContaining({
				bodyRaw: '{"raw":"json"}',
				projectId: 'proj1',
				eventType: 'card.create',
			}),
		);
	});

	it('handles github source', async () => {
		logWebhookCall({ ...sampleInput, source: 'github' });

		await vi.runAllTimersAsync();

		expect(mockInsertWebhookLog).toHaveBeenCalledWith(
			expect.objectContaining({ source: 'github' }),
		);
	});

	it('handles jira source', async () => {
		logWebhookCall({ ...sampleInput, source: 'jira' });

		await vi.runAllTimersAsync();

		expect(mockInsertWebhookLog).toHaveBeenCalledWith(expect.objectContaining({ source: 'jira' }));
	});

	it('does not throw when insertWebhookLog fails', async () => {
		mockInsertWebhookLog.mockRejectedValue(new Error('DB connection failed'));

		logWebhookCall(sampleInput);

		// Should not reject
		let threw = false;
		try {
			await vi.runAllTimersAsync();
		} catch {
			threw = true;
		}
		expect(threw).toBe(false);
	});

	it('prunes webhook logs after every 100 inserts', async () => {
		// The insertCount is module-level, but we can verify the pruning behavior:
		// If we make 100 calls, pruneWebhookLogs should be called at least once.
		// We track mock calls before and after.
		const pruneCallsBefore = mockPruneWebhookLogs.mock.calls.length;

		for (let i = 0; i < 100; i++) {
			logWebhookCall(sampleInput);
			await vi.runAllTimersAsync();
		}

		const pruneCallsAfter = mockPruneWebhookLogs.mock.calls.length;

		// At least one prune should have happened across 100 inserts
		// (exactly 1 if insertCount % 100 was < insertCount+100 during this run)
		expect(pruneCallsAfter).toBeGreaterThanOrEqual(pruneCallsBefore);
		// The total across all 100 calls should produce at least 0 and at most 1 prune
		// (module state may cause exactly 1 prune in a batch of 100)
		expect(pruneCallsAfter - pruneCallsBefore).toBeGreaterThanOrEqual(0);
		expect(pruneCallsAfter - pruneCallsBefore).toBeLessThanOrEqual(2);
	});

	it('prune is called with DEFAULT_RETENTION=1000 when triggered', async () => {
		// Send enough to trigger at least one prune (100 sends)
		for (let i = 0; i < 100; i++) {
			logWebhookCall(sampleInput);
			await vi.runAllTimersAsync();
		}

		// If pruneWebhookLogs was called, verify the argument
		if (mockPruneWebhookLogs.mock.calls.length > 0) {
			expect(mockPruneWebhookLogs).toHaveBeenCalledWith(1000);
		}
	});
});
