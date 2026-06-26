/**
 * Test that retry-run jobs include projectId when submitted via queue.
 *
 * This tests the fix for the credential resolution bug where retry-run jobs
 * failed because projectId wasn't passed to the router, so credentials
 * couldn't be resolved.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Enable the queue path. The router reads REDIS_URL at call time, so the
// load-bearing stub is the per-test one in beforeEach (vitest's unstubEnvs:true
// clears env stubs before each test); this top-level stub keeps import-time
// intent clear.
vi.stubEnv('REDIS_URL', 'redis://localhost:6379');

// Mock the queue client to capture job submissions
const mockSubmitDashboardJob = vi.fn().mockResolvedValue('job-id-123');
vi.mock('../../../src/queue/client.js', () => ({
	submitDashboardJob: (...args: unknown[]) => mockSubmitDashboardJob(...args),
}));

// Mock repository functions
const mockGetRunById = vi.fn();
const mockHasActiveRunForWorkItem = vi.fn().mockResolvedValue(false);
vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	DEFAULT_STALE_RUN_THRESHOLD_MS: 2 * 60 * 60 * 1000,
	listRuns: vi.fn(),
	getRunById: (...args: unknown[]) => mockGetRunById(...args),
	getRunLogs: vi.fn(),
	listLlmCallsMeta: vi.fn(),
	getLlmCallByNumber: vi.fn(),
	getDebugAnalysisByRunId: vi.fn(),
	deleteDebugAnalysisByRunId: vi.fn(),
	hasActiveRunForWorkItem: (...args: unknown[]) => mockHasActiveRunForWorkItem(...args),
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

// Mock isAgentEnabledForProject - default: agent is enabled
const mockIsAgentEnabledForProject = vi.fn().mockResolvedValue(true);
vi.mock('../../../src/db/repositories/agentConfigsRepository.js', () => ({
	isAgentEnabledForProject: (...args: unknown[]) => mockIsAgentEnabledForProject(...args),
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
		// Queue mode is gated on REDIS_URL, read at call time by the router.
		// Re-stub each test because vitest's unstubEnvs:true clears env stubs
		// before every test.
		vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
		mockSubmitDashboardJob.mockClear();
		mockGetRunById.mockReset();
		mockLoadProjectConfigById.mockReset();
		mockHasActiveRunForWorkItem.mockResolvedValue(false);
		mockIsAgentEnabledForProject.mockResolvedValue(true);
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

	it('includes work item metadata when submitting manual-run job to queue', async () => {
		const projectId = 'test-project-id';
		mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
		mockLoadProjectConfigById.mockResolvedValue({
			project: { id: projectId, name: 'Test Project' },
			config: {},
		});

		const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
		await caller.trigger({
			projectId,
			agentType: 'implementation',
			workItemId: 'TEAM-123',
			workItemUrl: 'https://linear.app/org/issue/TEAM-123/example',
			workItemTitle: 'Implement example',
			prNumber: 42,
			prBranch: 'feature/example',
			repoFullName: 'owner/repo',
			headSha: 'abc123',
			model: 'claude-opus-4-5',
		});

		expect(mockSubmitDashboardJob).toHaveBeenCalledWith({
			type: 'manual-run',
			projectId,
			agentType: 'implementation',
			workItemId: 'TEAM-123',
			workItemUrl: 'https://linear.app/org/issue/TEAM-123/example',
			workItemTitle: 'Implement example',
			prNumber: 42,
			prBranch: 'feature/example',
			repoFullName: 'owner/repo',
			headSha: 'abc123',
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
