import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDbWithGetDb } from '../../../helpers/mockDb.js';
import { mockDbClientModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/db/client.js', () => mockDbClientModule);

vi.mock('../../../../src/db/schema/index.js', () => ({
	agentRunLlmCalls: {
		id: 'id',
		runId: 'run_id',
		callNumber: 'call_number',
		request: 'request',
		response: 'response',
		inputTokens: 'input_tokens',
		outputTokens: 'output_tokens',
		cachedTokens: 'cached_tokens',
		costUsd: 'cost_usd',
		durationMs: 'duration_ms',
		model: 'model',
		createdAt: 'created_at',
	},
}));

import {
	getLlmCallByNumber,
	getLlmCallsByRunId,
	listLlmCallsMeta,
	storeLlmCall,
	storeLlmCallsBulk,
} from '../../../../src/db/repositories/llmCallsRepository.js';

describe('llmCallsRepository', () => {
	let mockDb: ReturnType<typeof createMockDbWithGetDb>;

	beforeEach(() => {
		mockDb = createMockDbWithGetDb({ withThenable: true });
	});

	describe('storeLlmCall', () => {
		it('inserts a single call with all fields', async () => {
			mockDb.chain.values.mockResolvedValueOnce(undefined);

			await storeLlmCall({
				runId: 'run-1',
				callNumber: 1,
				request: 'What is 2+2?',
				response: '4',
				inputTokens: 100,
				outputTokens: 50,
				cachedTokens: 10,
				costUsd: 0.001,
				durationMs: 500,
				model: 'claude-3-5-sonnet',
			});

			expect(mockDb.db.insert).toHaveBeenCalled();
			expect(mockDb.chain.values).toHaveBeenCalledWith({
				runId: 'run-1',
				callNumber: 1,
				request: 'What is 2+2?',
				response: '4',
				inputTokens: 100,
				outputTokens: 50,
				cachedTokens: 10,
				costUsd: '0.001',
				durationMs: 500,
				model: 'claude-3-5-sonnet',
			});
		});

		it('converts costUsd number to string', async () => {
			mockDb.chain.values.mockResolvedValueOnce(undefined);

			await storeLlmCall({
				runId: 'run-1',
				callNumber: 1,
				costUsd: 0.123456,
			});

			const valuesArg = mockDb.chain.values.mock.calls[0][0];
			expect(valuesArg.costUsd).toBe('0.123456');
		});

		it('passes undefined costUsd when not provided', async () => {
			mockDb.chain.values.mockResolvedValueOnce(undefined);

			await storeLlmCall({ runId: 'run-1', callNumber: 2 });

			const valuesArg = mockDb.chain.values.mock.calls[0][0];
			expect(valuesArg.costUsd).toBeUndefined();
		});

		it('inserts with only required fields', async () => {
			mockDb.chain.values.mockResolvedValueOnce(undefined);

			await storeLlmCall({ runId: 'run-1', callNumber: 2 });

			expect(mockDb.chain.values).toHaveBeenCalledWith({
				runId: 'run-1',
				callNumber: 2,
				request: undefined,
				response: undefined,
				inputTokens: undefined,
				outputTokens: undefined,
				cachedTokens: undefined,
				costUsd: undefined,
				durationMs: undefined,
				model: undefined,
			});
		});
	});

	describe('storeLlmCallsBulk', () => {
		it('inserts multiple calls at once', async () => {
			mockDb.chain.values.mockResolvedValueOnce(undefined);

			await storeLlmCallsBulk([
				{
					runId: 'run-1',
					callNumber: 1,
					costUsd: 0.001,
					inputTokens: 100,
					outputTokens: 50,
				},
				{
					runId: 'run-1',
					callNumber: 2,
					costUsd: 0.002,
					inputTokens: 200,
					outputTokens: 100,
				},
			]);

			expect(mockDb.db.insert).toHaveBeenCalled();
			expect(mockDb.chain.values).toHaveBeenCalledWith([
				expect.objectContaining({ runId: 'run-1', callNumber: 1, costUsd: '0.001' }),
				expect.objectContaining({ runId: 'run-1', callNumber: 2, costUsd: '0.002' }),
			]);
		});

		it('skips insert when calls array is empty', async () => {
			await storeLlmCallsBulk([]);

			expect(mockDb.db.insert).not.toHaveBeenCalled();
		});

		it('converts costUsd to string for each call', async () => {
			mockDb.chain.values.mockResolvedValueOnce(undefined);

			await storeLlmCallsBulk([
				{ runId: 'run-1', callNumber: 1, costUsd: 0.5 },
				{ runId: 'run-1', callNumber: 2, costUsd: 0.25 },
			]);

			const valuesArg = mockDb.chain.values.mock.calls[0][0] as Array<{ costUsd: string }>;
			expect(valuesArg[0].costUsd).toBe('0.5');
			expect(valuesArg[1].costUsd).toBe('0.25');
		});
	});

	describe('getLlmCallsByRunId', () => {
		it('returns calls ordered by callNumber', async () => {
			const mockCalls = [
				{ id: '1', runId: 'run-1', callNumber: 1 },
				{ id: '2', runId: 'run-1', callNumber: 2 },
			];
			// getLlmCallsByRunId uses .orderBy() as terminal
			const mockOrderBy = vi.fn().mockResolvedValueOnce(mockCalls);
			mockDb.chain.where.mockReturnValueOnce({ orderBy: mockOrderBy });

			const result = await getLlmCallsByRunId('run-1');

			expect(result).toEqual(mockCalls);
			expect(mockDb.db.select).toHaveBeenCalled();
		});

		it('returns empty array when no calls exist', async () => {
			const mockOrderBy = vi.fn().mockResolvedValueOnce([]);
			mockDb.chain.where.mockReturnValueOnce({ orderBy: mockOrderBy });

			const result = await getLlmCallsByRunId('run-no-calls');

			expect(result).toEqual([]);
		});
	});

	describe('getLlmCallByNumber', () => {
		it('returns the call when found', async () => {
			const mockCall = { id: '1', runId: 'run-1', callNumber: 3, request: 'q', response: 'a' };
			mockDb.chain.where.mockResolvedValueOnce([mockCall]);

			const result = await getLlmCallByNumber('run-1', 3);

			expect(result).toEqual(mockCall);
		});

		it('returns null when not found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getLlmCallByNumber('run-1', 999);

			expect(result).toBeNull();
		});
	});

	describe('listLlmCallsMeta', () => {
		it('returns metadata without request/response bodies', async () => {
			const mockMeta = [
				{
					id: 'call-1',
					runId: 'run-1',
					callNumber: 1,
					inputTokens: 100,
					outputTokens: 50,
					cachedTokens: 0,
					costUsd: '0.001',
					durationMs: 300,
					model: 'claude-3',
					createdAt: new Date(),
				},
				{
					id: 'call-2',
					runId: 'run-1',
					callNumber: 2,
					inputTokens: 200,
					outputTokens: 80,
					cachedTokens: 10,
					costUsd: '0.002',
					durationMs: 500,
					model: 'claude-3',
					createdAt: new Date(),
				},
			];
			const mockOrderBy = vi.fn().mockResolvedValueOnce(mockMeta);
			mockDb.chain.where.mockReturnValueOnce({ orderBy: mockOrderBy });

			const result = await listLlmCallsMeta('run-1');

			expect(result).toEqual(mockMeta);
			expect(mockDb.db.select).toHaveBeenCalled();
		});

		it('returns empty array when no calls exist', async () => {
			const mockOrderBy = vi.fn().mockResolvedValueOnce([]);
			mockDb.chain.where.mockReturnValueOnce({ orderBy: mockOrderBy });

			const result = await listLlmCallsMeta('run-no-calls');

			expect(result).toEqual([]);
		});
	});
});
