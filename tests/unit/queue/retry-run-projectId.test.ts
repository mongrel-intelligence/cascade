/**
 * Test that retry-run jobs include projectId when submitted via queue.
 *
 * This tests the fix for the credential resolution bug where retry-run jobs
 * failed because projectId wasn't passed to the router, so credentials
 * couldn't be resolved.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Set REDIS_URL before any imports to enable queue path
vi.stubEnv('REDIS_URL', 'redis://localhost:6379');

// Mock the queue client to capture job submissions
const mockSubmitDashboardJob = vi.fn().mockResolvedValue('job-id-123');
vi.mock('../../../src/queue/client.js', () => ({
	submitDashboardJob: (...args: unknown[]) => mockSubmitDashboardJob(...args),
}));

// Mock repository functions
const mockGetRunById = vi.fn();
vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	listRuns: vi.fn(),
	getRunById: (...args: unknown[]) => mockGetRunById(...args),
	getRunLogs: vi.fn(),
	listLlmCallsMeta: vi.fn(),
	getLlmCallByNumber: vi.fn(),
	getDebugAnalysisByRunId: vi.fn(),
	deleteDebugAnalysisByRunId: vi.fn(),
}));

// Mock DB for org access check
const mockDbSelect = vi.fn();
const mockDbFrom = vi.fn();
const mockDbWhere = vi.fn();
vi.mock('../../../src/db/client.js', () => ({
	getDb: () => ({
		select: mockDbSelect,
	}),
}));

vi.mock('../../../src/db/schema/index.js', () => ({
	projects: { id: 'id', orgId: 'org_id' },
}));

// Mock config provider
const mockLoadProjectConfigById = vi.fn();
vi.mock('../../../src/config/provider.js', () => ({
	loadProjectConfigById: (...args: unknown[]) => mockLoadProjectConfigById(...args),
}));

// Mock debug-status
vi.mock('../../../src/triggers/shared/debug-status.js', () => ({
	isAnalysisRunning: vi.fn().mockReturnValue(false),
}));

// Mock logger
vi.mock('../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import type { TRPCContext } from '../../../src/api/trpc.js';

// Import router after mocks
const { runsRouter } = await import('../../../src/api/routers/runs.js');

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

const RUN_UUID = 'aaaaaaaa-1111-2222-3333-444444444444';

describe('retry-run job submission with projectId', () => {
	beforeEach(() => {
		mockDbSelect.mockReturnValue({ from: mockDbFrom });
		mockDbFrom.mockReturnValue({ where: mockDbWhere });
	});

	it('includes projectId when submitting retry-run job to queue', async () => {
		const projectId = 'test-project-id';
		mockGetRunById.mockResolvedValue({
			id: RUN_UUID,
			projectId,
			agentType: 'implementation',
		});
		mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
		mockLoadProjectConfigById.mockResolvedValue({
			project: { id: projectId, name: 'Test Project' },
			config: {},
		});

		const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
		await caller.retry({ runId: RUN_UUID });

		expect(mockSubmitDashboardJob).toHaveBeenCalledWith({
			type: 'retry-run',
			runId: RUN_UUID,
			projectId,
			modelOverride: undefined,
		});
	});

	it('includes projectId and modelOverride when submitting retry-run with model', async () => {
		const projectId = 'another-project';
		mockGetRunById.mockResolvedValue({
			id: RUN_UUID,
			projectId,
			agentType: 'review',
		});
		mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
		mockLoadProjectConfigById.mockResolvedValue({
			project: { id: projectId, name: 'Another Project' },
			config: {},
		});

		const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
		await caller.retry({ runId: RUN_UUID, model: 'claude-opus-4-5' });

		expect(mockSubmitDashboardJob).toHaveBeenCalledWith({
			type: 'retry-run',
			runId: RUN_UUID,
			projectId,
			modelOverride: 'claude-opus-4-5',
		});
	});
});

describe('RetryRunJob interface', () => {
	it('requires projectId field (compile-time check)', () => {
		// This test verifies the interface at compile time.
		// If projectId were missing from the interface, TypeScript would fail here.
		const job: import('../../../src/queue/client.js').RetryRunJob = {
			type: 'retry-run',
			runId: 'some-run-id',
			projectId: 'some-project-id',
		};
		expect(job.projectId).toBe('some-project-id');
	});
});
