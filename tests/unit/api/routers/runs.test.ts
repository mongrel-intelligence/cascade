import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';

// Mock repository functions
const mockListRuns = vi.fn();
const mockGetRunById = vi.fn();
const mockGetRunLogs = vi.fn();
const mockListLlmCallsMeta = vi.fn();
const mockGetLlmCallByNumber = vi.fn();
const mockGetDebugAnalysisByRunId = vi.fn();

vi.mock('../../../../src/db/repositories/runsRepository.js', () => ({
	listRuns: (...args: unknown[]) => mockListRuns(...args),
	getRunById: (...args: unknown[]) => mockGetRunById(...args),
	getRunLogs: (...args: unknown[]) => mockGetRunLogs(...args),
	listLlmCallsMeta: (...args: unknown[]) => mockListLlmCallsMeta(...args),
	getLlmCallByNumber: (...args: unknown[]) => mockGetLlmCallByNumber(...args),
	getDebugAnalysisByRunId: (...args: unknown[]) => mockGetDebugAnalysisByRunId(...args),
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

import { runsRouter } from '../../../../src/api/routers/runs.js';

function createCaller(ctx: TRPCContext) {
	return runsRouter.createCaller(ctx);
}

const mockUser = {
	id: 'user-1',
	orgId: 'org-1',
	email: 'test@example.com',
	name: 'Test',
	role: 'admin',
};

describe('runsRouter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Set up DB chain for getById org check
		mockDbSelect.mockReturnValue({ from: mockDbFrom });
		mockDbFrom.mockReturnValue({ where: mockDbWhere });
	});

	describe('list', () => {
		it('calls listRuns with orgId from context and forwarded filters', async () => {
			mockListRuns.mockResolvedValue({ data: [{ id: 'run-1' }], total: 1 });
			const caller = createCaller({ user: mockUser });

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
			const caller = createCaller({ user: mockUser });

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
			const caller = createCaller({ user: mockUser });

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
			const caller = createCaller({ user: mockUser });
			await expect(caller.list({ limit: 200 })).rejects.toThrow();
		});

		it('throws UNAUTHORIZED when unauthenticated', async () => {
			const caller = createCaller({ user: null });
			await expect(caller.list({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});
	});

	describe('getById', () => {
		it('returns run when found and org matches', async () => {
			const mockRun = {
				id: 'aaaaaaaa-1111-2222-3333-444444444444',
				projectId: 'p1',
				agentType: 'implementation',
			};
			mockGetRunById.mockResolvedValue(mockRun);
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);

			const caller = createCaller({ user: mockUser });
			const result = await caller.getById({ id: 'aaaaaaaa-1111-2222-3333-444444444444' });

			expect(result).toEqual(mockRun);
		});

		it('throws NOT_FOUND when run does not exist', async () => {
			mockGetRunById.mockResolvedValue(null);
			const caller = createCaller({ user: mockUser });

			await expect(
				caller.getById({ id: 'aaaaaaaa-1111-2222-3333-444444444444' }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});

		it('throws NOT_FOUND when project org does not match user org', async () => {
			mockGetRunById.mockResolvedValue({
				id: 'aaaaaaaa-1111-2222-3333-444444444444',
				projectId: 'p1',
			});
			mockDbWhere.mockResolvedValue([{ orgId: 'different-org' }]);

			const caller = createCaller({ user: mockUser });
			await expect(
				caller.getById({ id: 'aaaaaaaa-1111-2222-3333-444444444444' }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});

		it('throws NOT_FOUND when project not found for run', async () => {
			mockGetRunById.mockResolvedValue({
				id: 'aaaaaaaa-1111-2222-3333-444444444444',
				projectId: 'p-missing',
			});
			mockDbWhere.mockResolvedValue([]);

			const caller = createCaller({ user: mockUser });
			await expect(
				caller.getById({ id: 'aaaaaaaa-1111-2222-3333-444444444444' }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});

		it('returns run when run has no projectId', async () => {
			const mockRun = {
				id: 'aaaaaaaa-1111-2222-3333-444444444444',
				projectId: null,
				agentType: 'debug',
			};
			mockGetRunById.mockResolvedValue(mockRun);

			const caller = createCaller({ user: mockUser });
			const result = await caller.getById({ id: 'aaaaaaaa-1111-2222-3333-444444444444' });

			expect(result).toEqual(mockRun);
			expect(mockDbSelect).not.toHaveBeenCalled();
		});

		it('rejects non-UUID id', async () => {
			const caller = createCaller({ user: mockUser });
			await expect(caller.getById({ id: 'not-a-uuid' })).rejects.toThrow();
		});
	});

	describe('getLogs', () => {
		it('returns logs for given runId', async () => {
			const mockLogs = { cascadeLog: 'log text', llmistLog: null };
			mockGetRunLogs.mockResolvedValue(mockLogs);

			const caller = createCaller({ user: mockUser });
			const result = await caller.getLogs({ runId: 'aaaaaaaa-1111-2222-3333-444444444444' });

			expect(mockGetRunLogs).toHaveBeenCalledWith('aaaaaaaa-1111-2222-3333-444444444444');
			expect(result).toEqual(mockLogs);
		});

		it('returns null when no logs found', async () => {
			mockGetRunLogs.mockResolvedValue(null);
			const caller = createCaller({ user: mockUser });

			const result = await caller.getLogs({ runId: 'aaaaaaaa-1111-2222-3333-444444444444' });
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

			const caller = createCaller({ user: mockUser });
			const result = await caller.listLlmCalls({ runId: 'aaaaaaaa-1111-2222-3333-444444444444' });

			expect(result).toEqual(mockMeta);
		});
	});

	describe('getLlmCall', () => {
		it('returns specific LLM call by runId + callNumber', async () => {
			const mockCall = { callNumber: 3, request: '{}', response: '{}' };
			mockGetLlmCallByNumber.mockResolvedValue(mockCall);

			const caller = createCaller({ user: mockUser });
			const result = await caller.getLlmCall({
				runId: 'aaaaaaaa-1111-2222-3333-444444444444',
				callNumber: 3,
			});

			expect(mockGetLlmCallByNumber).toHaveBeenCalledWith(
				'aaaaaaaa-1111-2222-3333-444444444444',
				3,
			);
			expect(result).toEqual(mockCall);
		});

		it('throws NOT_FOUND when call does not exist', async () => {
			mockGetLlmCallByNumber.mockResolvedValue(null);
			const caller = createCaller({ user: mockUser });

			await expect(
				caller.getLlmCall({
					runId: 'aaaaaaaa-1111-2222-3333-444444444444',
					callNumber: 999,
				}),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});
	});

	describe('getDebugAnalysis', () => {
		it('returns debug analysis for runId', async () => {
			const mockAnalysis = { summary: 'Agent failed', issues: 'Issue 1' };
			mockGetDebugAnalysisByRunId.mockResolvedValue(mockAnalysis);

			const caller = createCaller({ user: mockUser });
			const result = await caller.getDebugAnalysis({
				runId: 'aaaaaaaa-1111-2222-3333-444444444444',
			});

			expect(result).toEqual(mockAnalysis);
		});

		it('returns null when no analysis exists', async () => {
			mockGetDebugAnalysisByRunId.mockResolvedValue(null);
			const caller = createCaller({ user: mockUser });

			const result = await caller.getDebugAnalysis({
				runId: 'aaaaaaaa-1111-2222-3333-444444444444',
			});
			expect(result).toBeNull();
		});
	});
});
