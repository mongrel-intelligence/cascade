import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';
import { createMockUser } from '../../../helpers/factories.js';

// Mock repository functions
const mockListRuns = vi.fn();
const mockGetRunById = vi.fn();
const mockGetRunLogs = vi.fn();
const mockListLlmCallsMeta = vi.fn();
const mockGetLlmCallByNumber = vi.fn();
const mockGetDebugAnalysisByRunId = vi.fn();
const mockDeleteDebugAnalysisByRunId = vi.fn();
const mockHasActiveRunForWorkItem = vi.fn().mockResolvedValue(false);
const mockCancelRunById = vi.fn().mockResolvedValue(true);

vi.mock('../../../../src/db/repositories/runsRepository.js', () => ({
	DEFAULT_STALE_RUN_THRESHOLD_MS: 2 * 60 * 60 * 1000,
	listRuns: (...args: unknown[]) => mockListRuns(...args),
	getRunById: (...args: unknown[]) => mockGetRunById(...args),
	getRunLogs: (...args: unknown[]) => mockGetRunLogs(...args),
	listLlmCallsMeta: (...args: unknown[]) => mockListLlmCallsMeta(...args),
	getLlmCallByNumber: (...args: unknown[]) => mockGetLlmCallByNumber(...args),
	getDebugAnalysisByRunId: (...args: unknown[]) => mockGetDebugAnalysisByRunId(...args),
	deleteDebugAnalysisByRunId: (...args: unknown[]) => mockDeleteDebugAnalysisByRunId(...args),
	hasActiveRunForWorkItem: (...args: unknown[]) => mockHasActiveRunForWorkItem(...args),
	cancelRunById: (...args: unknown[]) => mockCancelRunById(...args),
}));

// Mock getDb for the inline org-access check in getById
const mockDbSelect = vi.fn();
const mockDbFrom = vi.fn();
const mockDbWhere = vi.fn();

vi.mock('../../../../src/db/client.js', () => ({
	getDb: () => ({
		select: mockDbSelect,
	}),
}));

vi.mock('../../../../src/db/schema/index.js', () => ({
	projects: { id: 'id', orgId: 'org_id' },
}));

// Mock debug-status tracker
const mockIsAnalysisRunning = vi.fn();
vi.mock('../../../../src/triggers/shared/debug-status.js', () => ({
	isAnalysisRunning: (...args: unknown[]) => mockIsAnalysisRunning(...args),
}));

// Mock triggerDebugAnalysis (fire-and-forget)
const mockTriggerDebugAnalysis = vi.fn();
vi.mock('../../../../src/triggers/shared/debug-runner.js', () => ({
	triggerDebugAnalysis: (...args: unknown[]) => mockTriggerDebugAnalysis(...args),
}));

// Mock triggerManualRun and triggerRetryRun (fire-and-forget)
const mockTriggerManualRun = vi.fn();
const mockTriggerRetryRun = vi.fn();
vi.mock('../../../../src/triggers/shared/manual-runner.js', () => ({
	triggerManualRun: (...args: unknown[]) => mockTriggerManualRun(...args),
	triggerRetryRun: (...args: unknown[]) => mockTriggerRetryRun(...args),
}));

// Mock config provider
const mockLoadProjectConfigById = vi.fn();
vi.mock('../../../../src/config/provider.js', () => ({
	loadProjectConfigById: (...args: unknown[]) => mockLoadProjectConfigById(...args),
}));

// Mock logger
vi.mock('../../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { runsRouter } from '../../../../src/api/routers/runs.js';

function createCaller(ctx: TRPCContext) {
	return runsRouter.createCaller(ctx);
}

const mockUser = createMockUser();

const RUN_UUID = 'aaaaaaaa-1111-2222-3333-444444444444';

describe('runsRouter', () => {
	beforeEach(() => {
		// Set up DB chain for getById org check
		mockDbSelect.mockReturnValue({ from: mockDbFrom });
		mockDbFrom.mockReturnValue({ where: mockDbWhere });
		// Default: fire-and-forget mocks return resolved promises
		mockTriggerDebugAnalysis.mockReturnValue(Promise.resolve());
		mockTriggerManualRun.mockReturnValue(Promise.resolve());
		mockTriggerRetryRun.mockReturnValue(Promise.resolve());
	});

	describe('list', () => {
		it('calls listRuns with orgId from context and forwarded filters', async () => {
			mockListRuns.mockResolvedValue({ data: [{ id: 'run-1' }], total: 1 });
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.list({
				projectId: 'p1',
				status: ['completed'],
				agentType: 'implementation',
				limit: 10,
				offset: 5,
				sort: 'costUsd',
				order: 'asc',
			});

			expect(mockListRuns).toHaveBeenCalledWith({
				orgId: 'org-1',
				projectId: 'p1',
				status: ['completed'],
				agentType: 'implementation',
				limit: 10,
				offset: 5,
				sort: 'costUsd',
				order: 'asc',
				startedAfter: undefined,
				startedBefore: undefined,
			});
			expect(result).toEqual({ data: [{ id: 'run-1' }], total: 1 });
		});

		it('converts startedAfter/startedBefore strings to Date objects', async () => {
			mockListRuns.mockResolvedValue({ data: [], total: 0 });
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.list({
				startedAfter: '2025-06-01T00:00:00.000Z',
				startedBefore: '2025-12-31T23:59:59.000Z',
			});

			expect(mockListRuns).toHaveBeenCalledWith(
				expect.objectContaining({
					startedAfter: new Date('2025-06-01T00:00:00.000Z'),
					startedBefore: new Date('2025-12-31T23:59:59.000Z'),
				}),
			);
		});

		it('uses defaults for limit/offset/sort/order when not provided', async () => {
			mockListRuns.mockResolvedValue({ data: [], total: 0 });
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.list({});

			expect(mockListRuns).toHaveBeenCalledWith(
				expect.objectContaining({
					limit: 50,
					offset: 0,
					sort: 'startedAt',
					order: 'desc',
				}),
			);
		});

		it('rejects limit > 100', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.list({ limit: 200 })).rejects.toThrow();
		});

		it('throws UNAUTHORIZED when unauthenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.list({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});
	});

	describe('getById', () => {
		it('returns run when found and org matches', async () => {
			const mockRun = {
				id: RUN_UUID,
				projectId: 'p1',
				agentType: 'implementation',
			};
			mockGetRunById.mockResolvedValue(mockRun);
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.getById({ id: RUN_UUID });

			expect(result).toEqual(mockRun);
		});

		it('throws NOT_FOUND when run does not exist', async () => {
			mockGetRunById.mockResolvedValue(null);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.getById({ id: RUN_UUID })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws NOT_FOUND when project org does not match user org', async () => {
			mockGetRunById.mockResolvedValue({
				id: RUN_UUID,
				projectId: 'p1',
			});
			mockDbWhere.mockResolvedValue([{ orgId: 'different-org' }]);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.getById({ id: RUN_UUID })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws NOT_FOUND when project not found for run', async () => {
			mockGetRunById.mockResolvedValue({
				id: RUN_UUID,
				projectId: 'p-missing',
			});
			mockDbWhere.mockResolvedValue([]);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.getById({ id: RUN_UUID })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('returns run when run has no projectId', async () => {
			const mockRun = {
				id: RUN_UUID,
				projectId: null,
				agentType: 'debug',
			};
			mockGetRunById.mockResolvedValue(mockRun);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.getById({ id: RUN_UUID });

			expect(result).toEqual(mockRun);
			expect(mockDbSelect).not.toHaveBeenCalled();
		});

		it('rejects non-UUID id', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.getById({ id: 'not-a-uuid' })).rejects.toThrow();
		});
	});

	describe('getLogs', () => {
		it('returns logs for given runId', async () => {
			const mockLogs = { cascadeLog: 'log text', llmistLog: null };
			mockGetRunLogs.mockResolvedValue(mockLogs);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.getLogs({ runId: RUN_UUID });

			expect(mockGetRunLogs).toHaveBeenCalledWith(RUN_UUID);
			expect(result).toEqual(mockLogs);
		});

		it('returns null when no logs found', async () => {
			mockGetRunLogs.mockResolvedValue(null);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.getLogs({ runId: RUN_UUID });
			expect(result).toBeNull();
		});
	});

	describe('listLlmCalls', () => {
		it('returns LLM call metadata list', async () => {
			const mockMeta = [
				{ callNumber: 1, inputTokens: 100 },
				{ callNumber: 2, inputTokens: 200 },
			];
			mockListLlmCallsMeta.mockResolvedValue(mockMeta);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.listLlmCalls({ runId: RUN_UUID });

			expect(result).toEqual(mockMeta);
		});

		it('includes model and createdAt in returned metadata', async () => {
			const createdAt = new Date('2026-02-18T10:00:00.000Z');
			const mockMeta = [
				{
					callNumber: 1,
					inputTokens: 100,
					outputTokens: 50,
					model: 'claude-sonnet-4-5',
					createdAt,
				},
			];
			mockListLlmCallsMeta.mockResolvedValue(mockMeta);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.listLlmCalls({ runId: RUN_UUID });

			expect(result[0]).toMatchObject({
				model: 'claude-sonnet-4-5',
				createdAt,
			});
		});
	});

	describe('getLlmCall', () => {
		it('returns specific LLM call by runId + callNumber', async () => {
			const mockCall = { callNumber: 3, request: '{}', response: '{}' };
			mockGetLlmCallByNumber.mockResolvedValue(mockCall);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.getLlmCall({
				runId: RUN_UUID,
				callNumber: 3,
			});

			expect(mockGetLlmCallByNumber).toHaveBeenCalledWith(RUN_UUID, 3);
			expect(result).toEqual(mockCall);
		});

		it('throws NOT_FOUND when call does not exist', async () => {
			mockGetLlmCallByNumber.mockResolvedValue(null);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(
				caller.getLlmCall({
					runId: RUN_UUID,
					callNumber: 999,
				}),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});
	});

	describe('getDebugAnalysis', () => {
		it('returns debug analysis for runId', async () => {
			const mockAnalysis = { summary: 'Agent failed', issues: 'Issue 1' };
			mockGetDebugAnalysisByRunId.mockResolvedValue(mockAnalysis);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.getDebugAnalysis({
				runId: RUN_UUID,
			});

			expect(result).toEqual(mockAnalysis);
		});

		it('returns null when no analysis exists', async () => {
			mockGetDebugAnalysisByRunId.mockResolvedValue(null);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.getDebugAnalysis({
				runId: RUN_UUID,
			});
			expect(result).toBeNull();
		});
	});

	describe('getDebugAnalysisStatus', () => {
		it('returns running when analysis is in progress', async () => {
			mockIsAnalysisRunning.mockReturnValue(true);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.getDebugAnalysisStatus({ runId: RUN_UUID });

			expect(result).toEqual({ status: 'running' });
			// Should not query DB when running
			expect(mockGetDebugAnalysisByRunId).not.toHaveBeenCalled();
		});

		it('returns completed when analysis exists in DB', async () => {
			mockIsAnalysisRunning.mockReturnValue(false);
			mockGetDebugAnalysisByRunId.mockResolvedValue({ summary: 'done' });

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.getDebugAnalysisStatus({ runId: RUN_UUID });

			expect(result).toEqual({ status: 'completed' });
		});

		it('returns idle when not running and no analysis exists', async () => {
			mockIsAnalysisRunning.mockReturnValue(false);
			mockGetDebugAnalysisByRunId.mockResolvedValue(null);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.getDebugAnalysisStatus({ runId: RUN_UUID });

			expect(result).toEqual({ status: 'idle' });
		});

		it('throws UNAUTHORIZED when unauthenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.getDebugAnalysisStatus({ runId: RUN_UUID })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});

	describe('triggerDebugAnalysis', () => {
		it('triggers analysis for a valid run', async () => {
			mockGetRunById.mockResolvedValue({
				id: RUN_UUID,
				projectId: 'p1',
				agentType: 'implementation',
				cardId: 'card-1',
			});
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockIsAnalysisRunning.mockReturnValue(false);
			mockLoadProjectConfigById.mockResolvedValue({
				project: { id: 'p1', name: 'Test' },
				config: {},
			});
			mockDeleteDebugAnalysisByRunId.mockResolvedValue(undefined);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.triggerDebugAnalysis({ runId: RUN_UUID });

			expect(result).toEqual({ triggered: true });
			expect(mockDeleteDebugAnalysisByRunId).toHaveBeenCalledWith(RUN_UUID);
			expect(mockTriggerDebugAnalysis).toHaveBeenCalledWith(
				RUN_UUID,
				{ id: 'p1', name: 'Test' },
				{},
				'card-1',
			);
		});

		it('passes undefined cardId when run has no card', async () => {
			mockGetRunById.mockResolvedValue({
				id: RUN_UUID,
				projectId: 'p1',
				agentType: 'implementation',
				cardId: null,
			});
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockIsAnalysisRunning.mockReturnValue(false);
			mockLoadProjectConfigById.mockResolvedValue({
				project: { id: 'p1', name: 'Test' },
				config: {},
			});
			mockDeleteDebugAnalysisByRunId.mockResolvedValue(undefined);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await caller.triggerDebugAnalysis({ runId: RUN_UUID });

			expect(mockTriggerDebugAnalysis).toHaveBeenCalledWith(
				RUN_UUID,
				expect.anything(),
				expect.anything(),
				undefined,
			);
		});

		it('throws NOT_FOUND when run does not exist', async () => {
			mockGetRunById.mockResolvedValue(null);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.triggerDebugAnalysis({ runId: RUN_UUID })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws NOT_FOUND when org does not match', async () => {
			mockGetRunById.mockResolvedValue({
				id: RUN_UUID,
				projectId: 'p1',
				agentType: 'implementation',
			});
			mockDbWhere.mockResolvedValue([{ orgId: 'different-org' }]);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.triggerDebugAnalysis({ runId: RUN_UUID })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws BAD_REQUEST for debug agent type', async () => {
			mockGetRunById.mockResolvedValue({
				id: RUN_UUID,
				projectId: 'p1',
				agentType: 'debug',
			});
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.triggerDebugAnalysis({ runId: RUN_UUID })).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});

		it('throws CONFLICT when analysis is already running', async () => {
			mockGetRunById.mockResolvedValue({
				id: RUN_UUID,
				projectId: 'p1',
				agentType: 'implementation',
			});
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockIsAnalysisRunning.mockReturnValue(true);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.triggerDebugAnalysis({ runId: RUN_UUID })).rejects.toMatchObject({
				code: 'CONFLICT',
			});
		});

		it('throws BAD_REQUEST when run has no projectId', async () => {
			mockGetRunById.mockResolvedValue({
				id: RUN_UUID,
				projectId: null,
				agentType: 'implementation',
			});
			mockIsAnalysisRunning.mockReturnValue(false);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.triggerDebugAnalysis({ runId: RUN_UUID })).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});

		it('throws NOT_FOUND when project not found', async () => {
			mockGetRunById.mockResolvedValue({
				id: RUN_UUID,
				projectId: 'p-missing',
				agentType: 'implementation',
			});
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockIsAnalysisRunning.mockReturnValue(false);
			mockLoadProjectConfigById.mockResolvedValue(undefined);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.triggerDebugAnalysis({ runId: RUN_UUID })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws UNAUTHORIZED when unauthenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.triggerDebugAnalysis({ runId: RUN_UUID })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});

	describe('trigger', () => {
		it('fires a manual run and returns triggered:true', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockLoadProjectConfigById.mockResolvedValue({
				project: { id: 'p1', name: 'Test Project' },
				config: {},
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.trigger({
				projectId: 'p1',
				agentType: 'implementation',
				cardId: 'card-abc',
			});

			expect(result).toEqual({ triggered: true });
			expect(mockTriggerManualRun).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: 'p1',
					agentType: 'implementation',
					cardId: 'card-abc',
				}),
				{ id: 'p1', name: 'Test Project' },
				{},
			);
		});

		it('passes optional fields when provided', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockLoadProjectConfigById.mockResolvedValue({
				project: { id: 'p1', name: 'Test Project' },
				config: {},
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await caller.trigger({
				projectId: 'p1',
				agentType: 'review',
				prNumber: 42,
				prBranch: 'feature/my-branch',
				model: 'claude-opus-4-5',
			});

			expect(mockTriggerManualRun).toHaveBeenCalledWith(
				expect.objectContaining({
					prNumber: 42,
					prBranch: 'feature/my-branch',
					modelOverride: 'claude-opus-4-5',
				}),
				expect.anything(),
				expect.anything(),
			);
		});

		it('throws NOT_FOUND when project does not exist in DB', async () => {
			mockDbWhere.mockResolvedValue([]);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.trigger({ projectId: 'missing', agentType: 'implementation' }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});

		it('throws NOT_FOUND when project belongs to different org', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'other-org' }]);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.trigger({ projectId: 'p1', agentType: 'implementation' }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});

		it('throws NOT_FOUND when project config not found', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockLoadProjectConfigById.mockResolvedValue(undefined);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.trigger({ projectId: 'p1', agentType: 'implementation' }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});

		it('throws UNAUTHORIZED when unauthenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(
				caller.trigger({ projectId: 'p1', agentType: 'implementation' }),
			).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});

		it('throws CONFLICT when work item has an active run', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockHasActiveRunForWorkItem.mockResolvedValueOnce(true);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.trigger({ projectId: 'p1', agentType: 'implementation', cardId: 'card-1' }),
			).rejects.toMatchObject({ code: 'CONFLICT' });
			expect(mockHasActiveRunForWorkItem).toHaveBeenCalledWith('p1', 'card-1', 2 * 60 * 60 * 1000);
		});

		it('succeeds when work item has no active run', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockHasActiveRunForWorkItem.mockResolvedValueOnce(false);
			mockLoadProjectConfigById.mockResolvedValue({
				project: { id: 'p1', name: 'Test' },
				config: {},
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.trigger({
				projectId: 'p1',
				agentType: 'implementation',
				cardId: 'card-1',
			});
			expect(result).toEqual({ triggered: true });
			expect(mockHasActiveRunForWorkItem).toHaveBeenCalledWith('p1', 'card-1', 2 * 60 * 60 * 1000);
		});

		it('skips lock check when no cardId is provided', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockLoadProjectConfigById.mockResolvedValue({
				project: { id: 'p1', name: 'Test' },
				config: {},
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.trigger({ projectId: 'p1', agentType: 'implementation' });
			expect(result).toEqual({ triggered: true });
			expect(mockHasActiveRunForWorkItem).not.toHaveBeenCalled();
		});

		it('skips lock check for debug agent type', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockLoadProjectConfigById.mockResolvedValue({
				project: { id: 'p1', name: 'Test' },
				config: {},
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.trigger({
				projectId: 'p1',
				agentType: 'debug',
				cardId: 'card-1',
			});
			expect(result).toEqual({ triggered: true });
			expect(mockHasActiveRunForWorkItem).not.toHaveBeenCalled();
		});
	});

	describe('retry', () => {
		it('fires a retry run and returns triggered:true', async () => {
			mockGetRunById.mockResolvedValue({
				id: RUN_UUID,
				projectId: 'p1',
				agentType: 'implementation',
			});
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockLoadProjectConfigById.mockResolvedValue({
				project: { id: 'p1', name: 'Test Project' },
				config: {},
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.retry({ runId: RUN_UUID });

			expect(result).toEqual({ triggered: true });
			expect(mockTriggerRetryRun).toHaveBeenCalledWith(
				RUN_UUID,
				{ id: 'p1', name: 'Test Project' },
				{},
				undefined,
			);
		});

		it('passes model override when provided', async () => {
			mockGetRunById.mockResolvedValue({
				id: RUN_UUID,
				projectId: 'p1',
				agentType: 'implementation',
			});
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockLoadProjectConfigById.mockResolvedValue({
				project: { id: 'p1', name: 'Test Project' },
				config: {},
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await caller.retry({ runId: RUN_UUID, model: 'claude-opus-4-5' });

			expect(mockTriggerRetryRun).toHaveBeenCalledWith(
				RUN_UUID,
				expect.anything(),
				expect.anything(),
				'claude-opus-4-5',
			);
		});

		it('throws NOT_FOUND when run does not exist', async () => {
			mockGetRunById.mockResolvedValue(null);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.retry({ runId: RUN_UUID })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws NOT_FOUND when org does not match', async () => {
			mockGetRunById.mockResolvedValue({
				id: RUN_UUID,
				projectId: 'p1',
				agentType: 'implementation',
			});
			mockDbWhere.mockResolvedValue([{ orgId: 'different-org' }]);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.retry({ runId: RUN_UUID })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws BAD_REQUEST when run has no projectId', async () => {
			mockGetRunById.mockResolvedValue({
				id: RUN_UUID,
				projectId: null,
				agentType: 'implementation',
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.retry({ runId: RUN_UUID })).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});

		it('throws NOT_FOUND when project config not found', async () => {
			mockGetRunById.mockResolvedValue({
				id: RUN_UUID,
				projectId: 'p-missing',
				agentType: 'implementation',
			});
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockLoadProjectConfigById.mockResolvedValue(undefined);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.retry({ runId: RUN_UUID })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws UNAUTHORIZED when unauthenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.retry({ runId: RUN_UUID })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});

		it('throws CONFLICT when work item has an active run', async () => {
			mockGetRunById.mockResolvedValue({
				id: RUN_UUID,
				projectId: 'p1',
				agentType: 'implementation',
				cardId: 'card-1',
			});
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockHasActiveRunForWorkItem.mockResolvedValueOnce(true);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.retry({ runId: RUN_UUID })).rejects.toMatchObject({
				code: 'CONFLICT',
			});
			expect(mockHasActiveRunForWorkItem).toHaveBeenCalledWith('p1', 'card-1', 2 * 60 * 60 * 1000);
		});

		it('skips lock check for debug agent type on retry', async () => {
			mockGetRunById.mockResolvedValue({
				id: RUN_UUID,
				projectId: 'p1',
				agentType: 'debug',
				cardId: 'card-1',
			});
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockLoadProjectConfigById.mockResolvedValue({
				project: { id: 'p1', name: 'Test' },
				config: {},
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.retry({ runId: RUN_UUID });
			expect(result).toEqual({ triggered: true });
			expect(mockHasActiveRunForWorkItem).not.toHaveBeenCalled();
		});
	});

	describe('cancel', () => {
		it('cancels a running run and returns cancelled:true', async () => {
			mockGetRunById.mockResolvedValue({
				id: RUN_UUID,
				projectId: 'p1',
				status: 'running',
			});
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockCancelRunById.mockResolvedValue(true);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.cancel({ runId: RUN_UUID });

			expect(result).toEqual({ cancelled: true });
			expect(mockCancelRunById).toHaveBeenCalledWith(RUN_UUID, 'Manually cancelled via API');
		});

		it('uses custom reason when provided', async () => {
			mockGetRunById.mockResolvedValue({
				id: RUN_UUID,
				projectId: 'p1',
				status: 'running',
			});
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockCancelRunById.mockResolvedValue(true);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await caller.cancel({ runId: RUN_UUID, reason: 'Orphaned worker' });

			expect(mockCancelRunById).toHaveBeenCalledWith(RUN_UUID, 'Orphaned worker');
		});

		it('throws NOT_FOUND when run does not exist', async () => {
			mockGetRunById.mockResolvedValue(null);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.cancel({ runId: RUN_UUID })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws BAD_REQUEST when run is not running', async () => {
			mockGetRunById.mockResolvedValue({
				id: RUN_UUID,
				projectId: 'p1',
				status: 'completed',
			});
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.cancel({ runId: RUN_UUID })).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});

		it('throws NOT_FOUND when org does not match', async () => {
			mockGetRunById.mockResolvedValue({
				id: RUN_UUID,
				projectId: 'p1',
				status: 'running',
			});
			mockDbWhere.mockResolvedValue([{ orgId: 'different-org' }]);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.cancel({ runId: RUN_UUID })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws UNAUTHORIZED when unauthenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.cancel({ runId: RUN_UUID })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});
});
