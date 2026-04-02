import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ==========================================================================
// Shared mock declarations — single vi.mock per module
// ==========================================================================

const mockGetOrganization = vi.fn();
const mockListAllOrganizations = vi.fn();
const mockUpdateOrganization = vi.fn();
const mockListProjectsFull = vi.fn();
const mockGetProjectFull = vi.fn();
const mockCreateProject = vi.fn();
const mockUpdateProject = vi.fn();
const mockDeleteProject = vi.fn();
const mockListProjectIntegrations = vi.fn();
const mockUpsertProjectIntegration = vi.fn();
const mockDeleteProjectIntegration = vi.fn();
const mockListAgentConfigs = vi.fn();
const mockCreateAgentConfig = vi.fn();
const mockUpdateAgentConfig = vi.fn();
const mockDeleteAgentConfig = vi.fn();

vi.mock('../../../src/db/repositories/settingsRepository.js', () => ({
	getOrganization: (...args: unknown[]) => mockGetOrganization(...args),
	listAllOrganizations: (...args: unknown[]) => mockListAllOrganizations(...args),
	updateOrganization: (...args: unknown[]) => mockUpdateOrganization(...args),
	listProjectsFull: (...args: unknown[]) => mockListProjectsFull(...args),
	getProjectFull: (...args: unknown[]) => mockGetProjectFull(...args),
	createProject: (...args: unknown[]) => mockCreateProject(...args),
	updateProject: (...args: unknown[]) => mockUpdateProject(...args),
	deleteProject: (...args: unknown[]) => mockDeleteProject(...args),
	listProjectIntegrations: (...args: unknown[]) => mockListProjectIntegrations(...args),
	upsertProjectIntegration: (...args: unknown[]) => mockUpsertProjectIntegration(...args),
	deleteProjectIntegration: (...args: unknown[]) => mockDeleteProjectIntegration(...args),
	listAgentConfigs: (...args: unknown[]) => mockListAgentConfigs(...args),
	createAgentConfig: (...args: unknown[]) => mockCreateAgentConfig(...args),
	updateAgentConfig: (...args: unknown[]) => mockUpdateAgentConfig(...args),
	deleteAgentConfig: (...args: unknown[]) => mockDeleteAgentConfig(...args),
}));

const mockListProjectsForOrg = vi.fn();
const mockListRuns = vi.fn();

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	listProjectsForOrg: (...args: unknown[]) => mockListProjectsForOrg(...args),
	listRuns: (...args: unknown[]) => mockListRuns(...args),
}));

vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	listProjectCredentials: vi.fn().mockResolvedValue([]),
	writeProjectCredential: vi.fn(),
	deleteProjectCredential: vi.fn(),
}));

const mockDbSelect = vi.fn();
const mockDbFrom = vi.fn();
const mockDbWhere = vi.fn();

vi.mock('../../../src/db/client.js', () => ({
	getDb: () => ({
		select: (...args: unknown[]) => mockDbSelect(...args),
	}),
}));

vi.mock('../../../src/db/schema/index.js', () => ({
	credentials: { id: 'id', orgId: 'org_id', value: 'value' },
	projects: { id: 'id', orgId: 'org_id' },
	agentConfigs: { id: 'id', projectId: 'project_id' },
	organizations: { id: 'id', name: 'name' },
}));

// Mocks required by runsRouter (dynamically imported in Section 4)
vi.mock('../../../src/db/crypto.js', () => ({
	decryptCredential: (v: string) => v,
	encryptCredential: (v: string) => v,
}));

vi.mock('../../../src/triggers/shared/debug-status.js', () => ({
	isAnalysisRunning: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../src/config/provider.js', () => ({
	loadProjectConfigById: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ==========================================================================
// Imports (after mocks)
// ==========================================================================

import { computeEffectiveOrgId } from '../../../src/api/context.js';
import { authRouter } from '../../../src/api/routers/auth.js';
import { organizationRouter } from '../../../src/api/routers/organization.js';
import { projectsRouter } from '../../../src/api/routers/projects.js';
import {
	adminProcedure,
	protectedProcedure,
	router,
	type TRPCContext,
} from '../../../src/api/trpc.js';
import { createMockUser } from '../../helpers/factories.js';

// ==========================================================================
// Shared test users
// ==========================================================================

const adminUser = createMockUser({ email: 'admin@example.com', name: 'Admin' });

const memberUser = createMockUser({
	id: 'user-2',
	email: 'member@example.com',
	name: 'Member',
	role: 'member',
});

// ==========================================================================
// Section 1: computeEffectiveOrgId
// ==========================================================================

describe('computeEffectiveOrgId', () => {
	it('returns null when user is null', async () => {
		const result = await computeEffectiveOrgId(null, undefined);
		expect(result).toBeNull();
	});

	it('returns user.orgId when no header provided', async () => {
		const result = await computeEffectiveOrgId(adminUser, undefined);
		expect(result).toBe('org-1');
	});

	it('ignores header for member user requesting different org', async () => {
		const result = await computeEffectiveOrgId(memberUser, 'org-2');
		expect(result).toBe('org-1');
		expect(mockGetOrganization).not.toHaveBeenCalled();
	});

	it('returns user.orgId when admin requests same org', async () => {
		const result = await computeEffectiveOrgId(adminUser, 'org-1');
		expect(result).toBe('org-1');
		expect(mockGetOrganization).not.toHaveBeenCalled();
	});

	it('ignores header for admin user requesting different org (admin cannot cross-org switch)', async () => {
		const result = await computeEffectiveOrgId(adminUser, 'org-2');
		expect(result).toBe('org-1');
		expect(mockGetOrganization).not.toHaveBeenCalled();
	});

	it('returns requested org when superadmin requests valid different org', async () => {
		const superAdmin = createMockUser({ role: 'superadmin' });
		mockGetOrganization.mockResolvedValue({ id: 'org-2', name: 'Org Two' });
		const result = await computeEffectiveOrgId(superAdmin, 'org-2');
		expect(result).toBe('org-2');
		expect(mockGetOrganization).toHaveBeenCalledWith('org-2');
	});

	it('falls back to user.orgId when superadmin requests nonexistent org', async () => {
		const superAdmin = createMockUser({ role: 'superadmin' });
		mockGetOrganization.mockResolvedValue(null);
		const result = await computeEffectiveOrgId(superAdmin, 'nonexistent');
		expect(result).toBe('org-1');
		expect(mockGetOrganization).toHaveBeenCalledWith('nonexistent');
	});

	it('returns user.orgId when admin sends empty header', async () => {
		const result = await computeEffectiveOrgId(adminUser, '');
		expect(result).toBe('org-1');
		expect(mockGetOrganization).not.toHaveBeenCalled();
	});

	it('returns user.orgId when admin sends undefined header', async () => {
		const result = await computeEffectiveOrgId(adminUser, undefined);
		expect(result).toBe('org-1');
	});

	it('returns user.orgId when member sends header matching own org', async () => {
		const result = await computeEffectiveOrgId(memberUser, 'org-1');
		expect(result).toBe('org-1');
	});
});

// ==========================================================================
// Section 2: Middleware edge cases
// ==========================================================================

const testRouter = router({
	protectedTest: protectedProcedure.query(({ ctx }) => ({
		effectiveOrgId: ctx.effectiveOrgId,
	})),
	adminTest: adminProcedure.query(({ ctx }) => ({
		effectiveOrgId: ctx.effectiveOrgId,
	})),
});

function createMiddlewareCaller(ctx: TRPCContext) {
	return testRouter.createCaller(ctx);
}

describe('Middleware edge cases', () => {
	it('protectedProcedure rejects when user present but effectiveOrgId null', async () => {
		const caller = createMiddlewareCaller({ user: memberUser, effectiveOrgId: null });
		await expect(caller.protectedTest()).rejects.toThrow(TRPCError);
		await expect(caller.protectedTest()).rejects.toMatchObject({
			code: 'UNAUTHORIZED',
		});
	});

	it('adminProcedure rejects when user present but effectiveOrgId null', async () => {
		const caller = createMiddlewareCaller({ user: adminUser, effectiveOrgId: null });
		await expect(caller.adminTest()).rejects.toThrow(TRPCError);
		await expect(caller.adminTest()).rejects.toMatchObject({
			code: 'UNAUTHORIZED',
		});
	});

	it('protectedProcedure propagates effectiveOrgId to ctx', async () => {
		const caller = createMiddlewareCaller({ user: memberUser, effectiveOrgId: 'org-2' });
		const result = await caller.protectedTest();
		expect(result.effectiveOrgId).toBe('org-2');
	});

	it('adminProcedure propagates effectiveOrgId to ctx', async () => {
		const caller = createMiddlewareCaller({ user: adminUser, effectiveOrgId: 'org-2' });
		const result = await caller.adminTest();
		expect(result.effectiveOrgId).toBe('org-2');
	});
});

// ==========================================================================
// Section 3: Auth router — role-based data exposure
// ==========================================================================

describe('Auth router — role-based data exposure', () => {
	it('member user gets no availableOrgs', async () => {
		const caller = authRouter.createCaller({ user: memberUser, effectiveOrgId: 'org-1' });
		const result = await caller.me();

		expect(result.availableOrgs).toBeUndefined();
		expect(mockListAllOrganizations).not.toHaveBeenCalled();
		expect(result.role).toBe('member');
	});

	it('admin gets no availableOrgs (only superadmin sees org list)', async () => {
		const caller = authRouter.createCaller({ user: adminUser, effectiveOrgId: 'org-1' });
		const result = await caller.me();

		expect(result.availableOrgs).toBeUndefined();
		expect(mockListAllOrganizations).not.toHaveBeenCalled();
	});

	it('superadmin with switched org returns correct effectiveOrgId and availableOrgs', async () => {
		mockListAllOrganizations.mockResolvedValue([
			{ id: 'org-1', name: 'Org One' },
			{ id: 'org-2', name: 'Org Two' },
		]);

		const superAdmin = createMockUser({ role: 'superadmin' });
		const caller = authRouter.createCaller({ user: superAdmin, effectiveOrgId: 'org-2' });
		const result = await caller.me();

		expect(result.effectiveOrgId).toBe('org-2');
		expect(result.orgId).toBe('org-1');
		expect(result.availableOrgs).toHaveLength(2);
	});

	it('member effectiveOrgId always matches user.orgId', async () => {
		const caller = authRouter.createCaller({ user: memberUser, effectiveOrgId: 'org-1' });
		const result = await caller.me();

		expect(result.effectiveOrgId).toBe('org-1');
		expect(result.orgId).toBe('org-1');
	});
});

// ==========================================================================
// Section 4: Router org-isolation with admin org-switching
// ==========================================================================

describe('Router org-isolation with admin org-switching', () => {
	beforeEach(() => {
		mockDbSelect.mockReturnValue({ from: mockDbFrom });
		mockDbFrom.mockReturnValue({ where: mockDbWhere });
	});

	it('projects.list uses effectiveOrgId (not user.orgId)', async () => {
		mockListProjectsForOrg.mockResolvedValue([{ id: 'p1', name: 'Damisa Project' }]);
		const caller = projectsRouter.createCaller({
			user: adminUser,
			effectiveOrgId: 'org-2',
		});

		await caller.list();

		expect(mockListProjectsForOrg).toHaveBeenCalledWith('org-2');
	});

	it('organization.get uses effectiveOrgId (not user.orgId)', async () => {
		mockGetOrganization.mockResolvedValue({ id: 'org-2', name: 'Org Two' });
		const caller = organizationRouter.createCaller({
			user: adminUser,
			effectiveOrgId: 'org-2',
		});

		await caller.get();

		expect(mockGetOrganization).toHaveBeenCalledWith('org-2');
	});

	it('runs.list uses effectiveOrgId (not user.orgId)', async () => {
		mockListRuns.mockResolvedValue({ data: [], total: 0 });

		// Import runsRouter here to avoid circular issues with the many mocks
		const { runsRouter } = await import('../../../src/api/routers/runs.js');
		const caller = runsRouter.createCaller({
			user: adminUser,
			effectiveOrgId: 'org-2',
		});

		await caller.list({});

		expect(mockListRuns).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-2' }));
	});

	it('projects.create uses effectiveOrgId (not user.orgId)', async () => {
		mockCreateProject.mockResolvedValue({
			id: 'new-proj',
			orgId: 'org-2',
			name: 'New',
			repo: 'owner/repo',
		});
		const caller = projectsRouter.createCaller({
			user: adminUser,
			effectiveOrgId: 'org-2',
		});

		await caller.create({ id: 'new-proj', name: 'New', repo: 'owner/repo' });

		expect(mockCreateProject).toHaveBeenCalledWith(
			'org-2',
			expect.objectContaining({
				id: 'new-proj',
				name: 'New',
				repo: 'owner/repo',
			}),
		);
	});
});

// ==========================================================================
// Section 5: Cross-org ownership checks
// ==========================================================================

describe('Cross-org ownership checks', () => {
	beforeEach(() => {
		mockDbSelect.mockReturnValue({ from: mockDbFrom });
		mockDbFrom.mockReturnValue({ where: mockDbWhere });
	});

	it('admin switched to org-2 can update org-2 project', async () => {
		mockDbWhere.mockResolvedValue([{ orgId: 'org-2' }]);
		mockUpdateProject.mockResolvedValue(undefined);

		const caller = projectsRouter.createCaller({
			user: adminUser,
			effectiveOrgId: 'org-2',
		});

		await caller.update({ id: 'p1', name: 'Updated' });

		expect(mockUpdateProject).toHaveBeenCalledWith('p1', 'org-2', { name: 'Updated' });
	});

	it('admin switched to org-2 cannot access org-1 project', async () => {
		mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);

		const caller = projectsRouter.createCaller({
			user: adminUser,
			effectiveOrgId: 'org-2',
		});

		await expect(caller.update({ id: 'p1', name: 'X' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
		expect(mockUpdateProject).not.toHaveBeenCalled();
	});
});
