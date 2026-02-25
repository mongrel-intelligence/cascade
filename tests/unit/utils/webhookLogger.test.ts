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
		// insertCount is module-level state that persists across tests, so we
		// don't know its starting value. By sending 101 inserts we guarantee
		// at least one multiple-of-100 boundary is crossed, triggering a prune.
		const pruneCallsBefore = mockPruneWebhookLogs.mock.calls.length;

		for (let i = 0; i < 101; i++) {
			logWebhookCall(sampleInput);
			await vi.runAllTimersAsync();
		}

		const pruneCallsAfter = mockPruneWebhookLogs.mock.calls.length;
		const prunesDuringBatch = pruneCallsAfter - pruneCallsBefore;

		// 101 inserts must cross at least one multiple-of-100 boundary
		expect(prunesDuringBatch).toBeGreaterThanOrEqual(1);
		// At most 2 boundaries can be crossed in 101 consecutive inserts
		expect(prunesDuringBatch).toBeLessThanOrEqual(2);
	});

	it('prune is called with DEFAULT_RETENTION=1000 when triggered', async () => {
		// Send enough to guarantee at least one prune (101 inserts)
		for (let i = 0; i < 101; i++) {
			logWebhookCall(sampleInput);
			await vi.runAllTimersAsync();
		}

		// With 101 inserts we always cross at least one boundary
		expect(mockPruneWebhookLogs).toHaveBeenCalledWith(1000);
	});
});
