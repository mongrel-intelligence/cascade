import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
	debugAnalysisStatus: {
		analyzedRunId: 'analyzed_run_id',
		status: 'status',
		updatedAt: 'updated_at',
	},
}));

import {
	clearDebugAnalysisStatus,
	DEBUG_ANALYSIS_RUNNING_STALE_MS,
	deleteDebugAnalysisByRunId,
	getDebugAnalysisByDebugRunId,
	getDebugAnalysisByRunId,
	getDebugAnalysisRunState,
	isDebugAnalysisRunActive,
	markDebugAnalysisFailed,
	markDebugAnalysisRunning,
	storeDebugAnalysis,
} from '../../../../src/db/repositories/debugAnalysisRepository.js';

describe('debugAnalysisRepository', () => {
	let mockDb: ReturnType<typeof createMockDbWithGetDb>;

	beforeEach(() => {
		mockDb = createMockDbWithGetDb({ withUpsert: true });
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

	describe('markDebugAnalysisRunning', () => {
		it('upserts a running status row keyed by analyzed run', async () => {
			await markDebugAnalysisRunning('run-1');

			expect(mockDb.db.insert).toHaveBeenCalled();
			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({ analyzedRunId: 'run-1', status: 'running' }),
			);
			expect(mockDb.chain.onConflictDoUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					set: expect.objectContaining({ status: 'running' }),
				}),
			);
		});
	});

	describe('markDebugAnalysisFailed', () => {
		it('upserts a failed status row keyed by analyzed run', async () => {
			await markDebugAnalysisFailed('run-1');

			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({ analyzedRunId: 'run-1', status: 'failed' }),
			);
			expect(mockDb.chain.onConflictDoUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					set: expect.objectContaining({ status: 'failed' }),
				}),
			);
		});
	});

	describe('clearDebugAnalysisStatus', () => {
		it('deletes the status row by analyzed run', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await clearDebugAnalysisStatus('run-1');

			expect(mockDb.db.delete).toHaveBeenCalled();
			expect(mockDb.chain.where).toHaveBeenCalled();
		});
	});

	describe('getDebugAnalysisRunState', () => {
		it('returns the status row when present', async () => {
			const updatedAt = new Date();
			mockDb.chain.where.mockResolvedValueOnce([{ status: 'running', updatedAt }]);

			const result = await getDebugAnalysisRunState('run-1');

			expect(result).toEqual({ status: 'running', updatedAt });
		});

		it('returns null when no status row exists', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getDebugAnalysisRunState('run-1');

			expect(result).toBeNull();
		});
	});

	describe('isDebugAnalysisRunActive', () => {
		it('returns false for a null state', () => {
			expect(isDebugAnalysisRunActive(null)).toBe(false);
		});

		it('returns false for a terminal (failed) status', () => {
			expect(isDebugAnalysisRunActive({ status: 'failed', updatedAt: new Date() })).toBe(false);
		});

		it('returns true for a fresh running status', () => {
			expect(isDebugAnalysisRunActive({ status: 'running', updatedAt: new Date() })).toBe(true);
		});

		it('returns true for a running status with no timestamp (defensive)', () => {
			expect(isDebugAnalysisRunActive({ status: 'running', updatedAt: null })).toBe(true);
		});

		it('returns false for a stale running status (crashed worker)', () => {
			const stale = new Date(Date.now() - DEBUG_ANALYSIS_RUNNING_STALE_MS - 1_000);
			expect(isDebugAnalysisRunActive({ status: 'running', updatedAt: stale })).toBe(false);
		});
	});

	// The staleness check uses a strict `<` against DEBUG_ANALYSIS_RUNNING_STALE_MS,
	// so a `running` row aged *exactly* at the threshold is already treated as stale.
	// That boundary is what guarantees a crashed/OOM-killed worker never wedges the
	// run as permanently `running`. Freeze the clock so the off-by-one is asserted
	// deterministically, then restore real timers — this file runs under unit-core
	// with `isolate: false`, where a leaked fake timer would bleed into sibling files.
	describe('isDebugAnalysisRunActive — exact staleness boundary', () => {
		beforeEach(() => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-06-25T12:00:00Z'));
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('treats a running row aged exactly at the threshold as stale (strict <)', () => {
			const updatedAt = new Date(Date.now() - DEBUG_ANALYSIS_RUNNING_STALE_MS);
			expect(isDebugAnalysisRunActive({ status: 'running', updatedAt })).toBe(false);
		});

		it('treats a running row aged one ms under the threshold as active', () => {
			const updatedAt = new Date(Date.now() - DEBUG_ANALYSIS_RUNNING_STALE_MS + 1);
			expect(isDebugAnalysisRunActive({ status: 'running', updatedAt })).toBe(true);
		});
	});
});
