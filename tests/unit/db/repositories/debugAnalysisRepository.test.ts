import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDbWithGetDb } from '../../../helpers/mockDb.js';
import { mockDbClientModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/db/client.js', () => mockDbClientModule);

vi.mock('../../../../src/db/schema/index.js', () => ({
	debugAnalyses: {
		id: 'id',
		analyzedRunId: 'analyzed_run_id',
		debugRunId: 'debug_run_id',
		summary: 'summary',
		issues: 'issues',
		timeline: 'timeline',
		recommendations: 'recommendations',
		rootCause: 'root_cause',
		severity: 'severity',
	},
}));

import {
	deleteDebugAnalysisByRunId,
	getDebugAnalysisByDebugRunId,
	getDebugAnalysisByRunId,
	storeDebugAnalysis,
} from '../../../../src/db/repositories/debugAnalysisRepository.js';

describe('debugAnalysisRepository', () => {
	let mockDb: ReturnType<typeof createMockDbWithGetDb>;

	beforeEach(() => {
		mockDb = createMockDbWithGetDb();
	});

	describe('storeDebugAnalysis', () => {
		it('inserts analysis and returns the new id', async () => {
			mockDb.chain.returning.mockResolvedValueOnce([{ id: 'debug-uuid-1' }]);

			const result = await storeDebugAnalysis({
				analyzedRunId: 'run-1',
				debugRunId: 'debug-run-1',
				summary: 'The agent failed due to missing config',
				issues: 'Issue 1, Issue 2',
				timeline: 'Step 1, Step 2',
				rootCause: 'Missing config',
				recommendations: 'Add config',
				severity: 'failure',
			});

			expect(result).toBe('debug-uuid-1');
			expect(mockDb.db.insert).toHaveBeenCalled();
			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					analyzedRunId: 'run-1',
					debugRunId: 'debug-run-1',
					summary: 'The agent failed due to missing config',
				}),
			);
		});

		it('stores optional fields when provided', async () => {
			mockDb.chain.returning.mockResolvedValueOnce([{ id: 'debug-uuid-2' }]);

			await storeDebugAnalysis({
				analyzedRunId: 'run-2',
				summary: 'Minimal analysis',
				issues: 'One issue',
				timeline: 'Timeline text',
				recommendations: 'Fix it',
				severity: 'warning',
			});

			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					timeline: 'Timeline text',
					recommendations: 'Fix it',
					severity: 'warning',
				}),
			);
		});

		it('stores with only required fields (optional fields undefined)', async () => {
			mockDb.chain.returning.mockResolvedValueOnce([{ id: 'debug-uuid-3' }]);

			await storeDebugAnalysis({
				analyzedRunId: 'run-3',
				summary: 'Summary only',
				issues: 'Issues only',
			});

			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					analyzedRunId: 'run-3',
					summary: 'Summary only',
					issues: 'Issues only',
					debugRunId: undefined,
					timeline: undefined,
					recommendations: undefined,
					rootCause: undefined,
					severity: undefined,
				}),
			);
		});
	});

	describe('getDebugAnalysisByRunId', () => {
		it('returns analysis when found', async () => {
			const mockAnalysis = {
				id: 'da-1',
				analyzedRunId: 'run-1',
				summary: 'Analysis result',
				issues: 'Found 3 issues',
			};
			mockDb.chain.where.mockResolvedValueOnce([mockAnalysis]);

			const result = await getDebugAnalysisByRunId('run-1');

			expect(result).toEqual(mockAnalysis);
			expect(mockDb.db.select).toHaveBeenCalled();
		});

		it('returns null when not found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getDebugAnalysisByRunId('nonexistent-run');

			expect(result).toBeNull();
		});
	});

	describe('deleteDebugAnalysisByRunId', () => {
		it('deletes analysis by analyzedRunId', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await deleteDebugAnalysisByRunId('run-1');

			expect(mockDb.db.delete).toHaveBeenCalled();
			expect(mockDb.chain.where).toHaveBeenCalled();
		});

		it('does not throw when no analysis exists', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await expect(deleteDebugAnalysisByRunId('nonexistent')).resolves.toBeUndefined();
		});
	});

	describe('getDebugAnalysisByDebugRunId', () => {
		it('returns analysis by debug run id', async () => {
			const mockAnalysis = {
				id: 'da-2',
				analyzedRunId: 'run-1',
				debugRunId: 'debug-run-1',
				summary: 'Debug analysis',
				issues: 'Various issues',
			};
			mockDb.chain.where.mockResolvedValueOnce([mockAnalysis]);

			const result = await getDebugAnalysisByDebugRunId('debug-run-1');

			expect(result).toEqual(mockAnalysis);
		});

		it('returns null when debug run id not found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getDebugAnalysisByDebugRunId('nonexistent-debug');

			expect(result).toBeNull();
		});
	});
});
