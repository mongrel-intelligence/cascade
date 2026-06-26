import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSuperAdmin, createMockUser } from '../../../helpers/factories.js';
import {
	createCallerFor,
	expectTRPCError,
	setupOwnershipCheckMock,
} from '../../../helpers/trpcTestHarness.js';

/**
 * Spec 022 plan 3/4 — per-project worker image: tRPC set/clear surface.
 *
 * Pins the superadmin gate, synchronous ref-grammar validation, pending+enqueue
 * persistence, clear-to-default, and the structured audit log line.
 */

const { mockUpdateProject, mockCreateProject, mockEnqueue, mockLoggerInfo } = vi.hoisted(() => ({
	mockUpdateProject: vi.fn(),
	mockCreateProject: vi.fn(),
	mockEnqueue: vi.fn(),
	mockLoggerInfo: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/runsRepository.js', () => ({
	listProjectsForOrg: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/settingsRepository.js', () => ({
	listProjectsFull: vi.fn(),
	getProjectFull: vi.fn(),
	createProject: mockCreateProject,
	updateProject: mockUpdateProject,
	deleteProject: vi.fn(),
	listProjectIntegrations: vi.fn(),
	upsertProjectIntegration: vi.fn(),
	deleteProjectIntegration: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/credentialsRepository.js', () => ({
	listProjectCredentials: vi.fn(),
	listProjectCredentialsMeta: vi.fn(),
	writeProjectCredential: vi.fn(),
	deleteProjectCredential: vi.fn(),
}));

vi.mock('../../../../src/sentry.js', () => ({ captureException: vi.fn() }));

vi.mock('../../../../src/queue/client.js', () => ({
	enqueueWorkerImageValidationJob: mockEnqueue,
}));

vi.mock('../../../../src/router/config.js', () => ({
	routerConfig: { workerImage: 'ghcr.io/mongrel-intelligence/cascade-worker:latest' },
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: { info: mockLoggerInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { mockDbSelect, mockDbFrom, mockDbWhere } = setupOwnershipCheckMock();

vi.mock('../../../../src/db/client.js', () => ({
	getDb: () => ({ select: mockDbSelect }),
}));

vi.mock('../../../../src/db/schema/index.js', () => ({
	projects: { id: 'id', orgId: 'org_id', workerImage: 'worker_image' },
}));

import { projectsRouter } from '../../../../src/api/routers/projects.js';

const createCaller = createCallerFor(projectsRouter);
const superAdmin = createMockSuperAdmin();
const admin = createMockUser();

const VALID_REF = 'ghcr.io/acme/cascade-worker:latest';

describe('projectsRouter — worker image (spec 022)', () => {
	beforeEach(() => {
		mockDbSelect.mockReturnValue({ from: mockDbFrom });
		mockDbFrom.mockReturnValue({ where: mockDbWhere });
		mockUpdateProject.mockResolvedValue(undefined);
		mockCreateProject.mockResolvedValue({ id: 'p1' });
		mockEnqueue.mockResolvedValue('worker-image-validation-p1');
	});

	function superAdminCaller() {
		return createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });
	}
	function adminCaller() {
		return createCaller({ user: admin, effectiveOrgId: admin.orgId });
	}

	describe('update — authorization', () => {
		it('rejects a non-superadmin with FORBIDDEN and persists nothing', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1', workerImage: null }]);

			await expectTRPCError(
				adminCaller().update({ id: 'p1', workerImage: VALID_REF }),
				'FORBIDDEN',
			);
			expect(mockUpdateProject).not.toHaveBeenCalled();
			expect(mockEnqueue).not.toHaveBeenCalled();
		});

		it('allows a superadmin to set the worker image', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1', workerImage: null }]);

			await superAdminCaller().update({ id: 'p1', workerImage: VALID_REF });

			expect(mockUpdateProject).toHaveBeenCalledWith(
				'p1',
				'org-1',
				expect.objectContaining({ workerImage: VALID_REF }),
			);
		});
	});

	describe('update — validation', () => {
		it('rejects a syntactically-invalid ref synchronously with BAD_REQUEST (nothing persisted)', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1', workerImage: null }]);

			await expectTRPCError(
				superAdminCaller().update({ id: 'p1', workerImage: 'Not A Ref!!' }),
				'BAD_REQUEST',
			);
			expect(mockUpdateProject).not.toHaveBeenCalled();
			expect(mockEnqueue).not.toHaveBeenCalled();
		});

		it('persists a valid ref as pending (digest/error cleared) and enqueues validation', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1', workerImage: null }]);

			await superAdminCaller().update({ id: 'p1', workerImage: VALID_REF });

			expect(mockUpdateProject).toHaveBeenCalledWith('p1', 'org-1', {
				workerImage: VALID_REF,
				workerImageStatus: 'pending',
				workerImageDigest: null,
				workerImageError: null,
			});
			expect(mockEnqueue).toHaveBeenCalledWith({ projectId: 'p1', ref: VALID_REF });
		});

		it('trims surrounding whitespace before persisting + enqueueing', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1', workerImage: null }]);

			await superAdminCaller().update({ id: 'p1', workerImage: `  ${VALID_REF}  ` });

			expect(mockUpdateProject).toHaveBeenCalledWith(
				'p1',
				'org-1',
				expect.objectContaining({ workerImage: VALID_REF }),
			);
			expect(mockEnqueue).toHaveBeenCalledWith({ projectId: 'p1', ref: VALID_REF });
		});
	});

	describe('update — clear', () => {
		it('clears all four columns and does not enqueue when workerImage is null', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1', workerImage: 'old-image:tag' }]);

			await superAdminCaller().update({ id: 'p1', workerImage: null });

			expect(mockUpdateProject).toHaveBeenCalledWith('p1', 'org-1', {
				workerImage: null,
				workerImageStatus: null,
				workerImageDigest: null,
				workerImageError: null,
			});
			expect(mockEnqueue).not.toHaveBeenCalled();
		});
	});

	describe('update — untouched', () => {
		it('does not write worker-image columns, enqueue, or audit when the field is absent', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1', workerImage: null }]);

			await adminCaller().update({ id: 'p1', name: 'Renamed' });

			const callArg = mockUpdateProject.mock.calls[0][2];
			expect(callArg).not.toHaveProperty('workerImage');
			expect(callArg).not.toHaveProperty('workerImageStatus');
			expect(mockEnqueue).not.toHaveBeenCalled();
			expect(mockLoggerInfo).not.toHaveBeenCalledWith(
				'[audit] project worker image changed',
				expect.anything(),
			);
		});
	});

	describe('audit log', () => {
		it('emits a structured audit line on set (actor + project + from→to)', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1', workerImage: 'prev:tag' }]);

			await superAdminCaller().update({ id: 'p1', workerImage: VALID_REF });

			expect(mockLoggerInfo).toHaveBeenCalledWith('[audit] project worker image changed', {
				event: 'project_worker_image_changed',
				actorId: superAdmin.id,
				projectId: 'p1',
				from: 'prev:tag',
				to: VALID_REF,
			});
		});

		it('emits a structured audit line on clear (to: null)', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1', workerImage: 'prev:tag' }]);

			await superAdminCaller().update({ id: 'p1', workerImage: null });

			expect(mockLoggerInfo).toHaveBeenCalledWith('[audit] project worker image changed', {
				event: 'project_worker_image_changed',
				actorId: superAdmin.id,
				projectId: 'p1',
				from: 'prev:tag',
				to: null,
			});
		});

		it('still audits a persisted change when the validation enqueue throws (Redis down)', async () => {
			// The column write is already committed by updateProject before the
			// enqueue runs; the audit line must be emitted regardless of whether the
			// enqueue then fails, otherwise a persisted set/clear goes unaudited.
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1', workerImage: 'prev:tag' }]);
			mockEnqueue.mockRejectedValueOnce(new Error('Redis unavailable'));

			// The enqueue failure still propagates so the operator knows validation
			// was not scheduled — but the persisted change is audited first.
			await expect(superAdminCaller().update({ id: 'p1', workerImage: VALID_REF })).rejects.toThrow(
				'Redis unavailable',
			);

			expect(mockUpdateProject).toHaveBeenCalledWith(
				'p1',
				'org-1',
				expect.objectContaining({ workerImage: VALID_REF }),
			);
			expect(mockLoggerInfo).toHaveBeenCalledWith('[audit] project worker image changed', {
				event: 'project_worker_image_changed',
				actorId: superAdmin.id,
				projectId: 'p1',
				from: 'prev:tag',
				to: VALID_REF,
			});
		});
	});

	describe('create', () => {
		it('rejects a non-superadmin worker-image create with FORBIDDEN', async () => {
			await expectTRPCError(
				adminCaller().create({
					id: 'p2',
					name: 'P2',
					repo: 'owner/repo',
					workerImage: VALID_REF,
				}),
				'FORBIDDEN',
			);
			expect(mockCreateProject).not.toHaveBeenCalled();
		});

		it('persists pending + enqueues when a superadmin creates with a worker image', async () => {
			await superAdminCaller().create({
				id: 'p2',
				name: 'P2',
				repo: 'owner/repo',
				workerImage: VALID_REF,
			});

			expect(mockCreateProject).toHaveBeenCalledWith(
				'org-1',
				expect.objectContaining({
					id: 'p2',
					workerImage: VALID_REF,
					workerImageStatus: 'pending',
					workerImageDigest: null,
					workerImageError: null,
				}),
			);
			expect(mockEnqueue).toHaveBeenCalledWith({ projectId: 'p2', ref: VALID_REF });
		});
	});

	describe('defaults', () => {
		it('exposes the global worker image as a default', async () => {
			const result = await createCaller({ user: null, effectiveOrgId: null }).defaults();
			expect(result.workerImage).toBe('ghcr.io/mongrel-intelligence/cascade-worker:latest');
		});
	});
});
