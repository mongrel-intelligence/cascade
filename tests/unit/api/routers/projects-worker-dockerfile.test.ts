import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeContentHash } from '../../../../src/router/worker-dockerfile-compose.js';
import { createMockSuperAdmin, createMockUser } from '../../../helpers/factories.js';
import {
	createCallerFor,
	expectTRPCError,
	setupOwnershipCheckMock,
} from '../../../helpers/trpcTestHarness.js';

/**
 * Spec 023 plan 4 — per-project worker Dockerfile: tRPC set/clear + rebuild.
 *
 * Pins the superadmin gate, synchronous content validation, mutual exclusivity
 * with a referenced image (both directions), byte-identical idempotency, clear
 * revert, the grep-stable audit line, and the explicit-rebuild mutation.
 */

const {
	mockUpdateProject,
	mockCreateProject,
	mockEnqueueValidation,
	mockEnqueueBuild,
	mockLoggerInfo,
} = vi.hoisted(() => ({
	mockUpdateProject: vi.fn(),
	mockCreateProject: vi.fn(),
	mockEnqueueValidation: vi.fn(),
	mockEnqueueBuild: vi.fn(),
	mockLoggerInfo: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/runsRepository.js', () => ({
	listProjectsForOrg: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/configRepository.js', () => ({
	// Spec 024: create/update now consult the repository's siblings to settle
	// primacy. These suites are not about topology — no siblings, no conflict.
	findRepoSiblingsFromDb: vi.fn().mockResolvedValue([]),
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
	enqueueWorkerImageValidationJob: mockEnqueueValidation,
	enqueueWorkerImageBuildJob: mockEnqueueBuild,
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
	projects: {
		id: 'id',
		orgId: 'org_id',
		workerImage: 'worker_image',
		workerDockerfile: 'worker_dockerfile',
		workerImageBuildHash: 'worker_image_build_hash',
		workerImageStatus: 'worker_image_status',
	},
}));

import { projectsRouter } from '../../../../src/api/routers/projects.js';

const createCaller = createCallerFor(projectsRouter);
const superAdmin = createMockSuperAdmin();
const admin = createMockUser();

const DOCKERFILE = 'RUN apt-get update && apt-get install -y jq\nCOPY ./tools /opt/tools';
const DOCKERFILE_HASH = computeContentHash(DOCKERFILE);
const VALID_REF = 'ghcr.io/acme/cascade-worker:latest';

/** Base ownership row — override per test to model the existing worker state. */
function ownershipRow(overrides: Record<string, unknown> = {}) {
	return [
		{
			orgId: 'org-1',
			workerImage: null,
			workerDockerfile: null,
			workerImageBuildHash: null,
			workerImageStatus: null,
			...overrides,
		},
	];
}

describe('projectsRouter — worker Dockerfile (spec 023)', () => {
	beforeEach(() => {
		mockDbSelect.mockReturnValue({ from: mockDbFrom });
		mockDbFrom.mockReturnValue({ where: mockDbWhere });
		mockUpdateProject.mockResolvedValue(undefined);
		mockCreateProject.mockResolvedValue({ id: 'p1' });
		mockEnqueueBuild.mockResolvedValue('worker-image-build-p1');
		mockEnqueueValidation.mockResolvedValue('worker-image-validation-p1');
	});

	function superAdminCaller() {
		return createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });
	}
	function adminCaller() {
		return createCaller({ user: admin, effectiveOrgId: admin.orgId });
	}

	describe('update — authorization', () => {
		it('rejects a non-superadmin with FORBIDDEN and persists nothing', async () => {
			mockDbWhere.mockResolvedValue(ownershipRow());

			await expectTRPCError(
				adminCaller().update({ id: 'p1', workerDockerfile: DOCKERFILE }),
				'FORBIDDEN',
			);
			expect(mockUpdateProject).not.toHaveBeenCalled();
			expect(mockEnqueueBuild).not.toHaveBeenCalled();
		});
	});

	describe('update — validation', () => {
		it('rejects content declaring its own FROM synchronously (BAD_REQUEST, nothing persisted)', async () => {
			mockDbWhere.mockResolvedValue(ownershipRow());

			await expectTRPCError(
				superAdminCaller().update({ id: 'p1', workerDockerfile: 'FROM node:20\nRUN echo hi' }),
				'BAD_REQUEST',
			);
			expect(mockUpdateProject).not.toHaveBeenCalled();
			expect(mockEnqueueBuild).not.toHaveBeenCalled();
		});

		it('rejects empty content with BAD_REQUEST', async () => {
			mockDbWhere.mockResolvedValue(ownershipRow());

			await expectTRPCError(
				superAdminCaller().update({ id: 'p1', workerDockerfile: '   ' }),
				'BAD_REQUEST',
			);
			expect(mockUpdateProject).not.toHaveBeenCalled();
			expect(mockEnqueueBuild).not.toHaveBeenCalled();
		});
	});

	describe('update — set', () => {
		it('persists content + content-hash + building and enqueues a build (default-sourced project)', async () => {
			mockDbWhere.mockResolvedValue(ownershipRow());

			await superAdminCaller().update({ id: 'p1', workerDockerfile: DOCKERFILE });

			expect(mockUpdateProject).toHaveBeenCalledWith('p1', 'org-1', {
				workerDockerfile: DOCKERFILE,
				workerImageBuildHash: DOCKERFILE_HASH,
				workerImageBuildStatus: 'building',
				workerImage: null,
				workerImageError: null,
				workerImageStatus: 'building',
				workerImageDigest: null,
			});
			expect(mockEnqueueBuild).toHaveBeenCalledWith({
				projectId: 'p1',
				buildHash: DOCKERFILE_HASH,
			});
		});

		it('clears a referenced image when a Dockerfile is set (mutual exclusivity)', async () => {
			mockDbWhere.mockResolvedValue(
				ownershipRow({ workerImage: 'old:ref', workerImageStatus: 'pending' }),
			);

			await superAdminCaller().update({ id: 'p1', workerDockerfile: DOCKERFILE });

			expect(mockUpdateProject).toHaveBeenCalledWith(
				'p1',
				'org-1',
				expect.objectContaining({ workerImage: null, workerDockerfile: DOCKERFILE }),
			);
		});

		it('keeps the verified pin (status verified, digest untouched) when replacing content on a verified project', async () => {
			mockDbWhere.mockResolvedValue(
				ownershipRow({
					workerDockerfile: 'RUN echo old',
					workerImageBuildHash: 'old-hash',
					workerImageStatus: 'verified',
				}),
			);

			await superAdminCaller().update({ id: 'p1', workerDockerfile: DOCKERFILE });

			const columns = mockUpdateProject.mock.calls[0][2];
			expect(columns).toMatchObject({
				workerDockerfile: DOCKERFILE,
				workerImageBuildHash: DOCKERFILE_HASH,
				workerImageBuildStatus: 'building',
				workerImageStatus: 'verified',
			});
			// No-strand: the launchable pin must NOT be cleared while the rebuild runs.
			expect(columns).not.toHaveProperty('workerImageDigest');
			expect(mockEnqueueBuild).toHaveBeenCalledWith({
				projectId: 'p1',
				buildHash: DOCKERFILE_HASH,
			});
		});

		it('treats a verified reference project switching to a Dockerfile as a FIRST build (clears the registry pin, does not preserve it)', async () => {
			// A verified *reference* project also has workerImageStatus === 'verified',
			// but its workerImageDigest is a REGISTRY digest — it must NOT be relabeled
			// as a local-only Dockerfile pin. Switching to a Dockerfile is a first build.
			mockDbWhere.mockResolvedValue(
				ownershipRow({
					workerImage: 'ghcr.io/acme/cascade-worker:pinned',
					workerImageStatus: 'verified',
					workerDockerfile: null,
					workerImageBuildHash: null,
				}),
			);

			await superAdminCaller().update({ id: 'p1', workerDockerfile: DOCKERFILE });

			// Identical shape to the default-sourced first-build path: launchable status
			// is `building` and the (foreign registry) digest is explicitly cleared.
			expect(mockUpdateProject).toHaveBeenCalledWith('p1', 'org-1', {
				workerDockerfile: DOCKERFILE,
				workerImageBuildHash: DOCKERFILE_HASH,
				workerImageBuildStatus: 'building',
				workerImage: null,
				workerImageError: null,
				workerImageStatus: 'building',
				workerImageDigest: null,
			});
			expect(mockEnqueueBuild).toHaveBeenCalledWith({
				projectId: 'p1',
				buildHash: DOCKERFILE_HASH,
			});
		});
	});

	describe('update — mutual exclusivity (reference clears dockerfile)', () => {
		it('clears the Dockerfile + build columns when a referenced image is set', async () => {
			mockDbWhere.mockResolvedValue(
				ownershipRow({
					workerDockerfile: DOCKERFILE,
					workerImageBuildHash: DOCKERFILE_HASH,
					workerImageStatus: 'verified',
				}),
			);

			await superAdminCaller().update({ id: 'p1', workerImage: VALID_REF });

			expect(mockUpdateProject).toHaveBeenCalledWith(
				'p1',
				'org-1',
				expect.objectContaining({
					workerImage: VALID_REF,
					workerImageStatus: 'pending',
					workerDockerfile: null,
					workerImageBuildHash: null,
					workerImageBuildStatus: null,
				}),
			);
			expect(mockEnqueueValidation).toHaveBeenCalledWith({ projectId: 'p1', ref: VALID_REF });
			expect(mockEnqueueBuild).not.toHaveBeenCalled();
		});
	});

	describe('update — both sources set (mutual exclusivity at the tRPC boundary)', () => {
		it('rejects setting workerImage + workerDockerfile in one update with BAD_REQUEST (nothing persisted)', async () => {
			mockDbWhere.mockResolvedValue(ownershipRow());

			await expectTRPCError(
				superAdminCaller().update({
					id: 'p1',
					workerImage: VALID_REF,
					workerDockerfile: DOCKERFILE,
				}),
				'BAD_REQUEST',
			);
			expect(mockUpdateProject).not.toHaveBeenCalled();
			expect(mockEnqueueBuild).not.toHaveBeenCalled();
			expect(mockEnqueueValidation).not.toHaveBeenCalled();
		});
	});

	describe('update — idempotency', () => {
		it('does NOT enqueue or persist Dockerfile columns on a byte-identical re-save of a verified project', async () => {
			mockDbWhere.mockResolvedValue(
				ownershipRow({
					workerDockerfile: DOCKERFILE,
					workerImageBuildHash: DOCKERFILE_HASH,
					workerImageStatus: 'verified',
				}),
			);

			await superAdminCaller().update({ id: 'p1', workerDockerfile: DOCKERFILE });

			// updateProject is still invoked for the (empty) rest of the update, but it
			// must carry no Dockerfile/build columns and must not enqueue or audit.
			const columns = mockUpdateProject.mock.calls[0][2];
			expect(columns).not.toHaveProperty('workerDockerfile');
			expect(columns).not.toHaveProperty('workerImageBuildHash');
			expect(mockEnqueueBuild).not.toHaveBeenCalled();
			expect(mockLoggerInfo).not.toHaveBeenCalledWith(
				'[audit] project worker dockerfile changed',
				expect.anything(),
			);
		});

		it('DOES rebuild when the content changes on a verified project', async () => {
			mockDbWhere.mockResolvedValue(
				ownershipRow({
					workerDockerfile: DOCKERFILE,
					workerImageBuildHash: DOCKERFILE_HASH,
					workerImageStatus: 'verified',
				}),
			);

			await superAdminCaller().update({
				id: 'p1',
				workerDockerfile: `${DOCKERFILE}\nRUN echo more`,
			});

			expect(mockEnqueueBuild).toHaveBeenCalledTimes(1);
		});
	});

	describe('update — clear', () => {
		it('reverts a dockerfile-sourced project and does not enqueue', async () => {
			mockDbWhere.mockResolvedValue(
				ownershipRow({
					workerDockerfile: DOCKERFILE,
					workerImageBuildHash: DOCKERFILE_HASH,
					workerImageStatus: 'verified',
				}),
			);

			await superAdminCaller().update({ id: 'p1', workerDockerfile: null });

			expect(mockUpdateProject).toHaveBeenCalledWith('p1', 'org-1', {
				workerDockerfile: null,
				workerImageBuildHash: null,
				workerImageBuildStatus: null,
				workerImageStatus: null,
				workerImageDigest: null,
				workerImageError: null,
			});
			expect(mockEnqueueBuild).not.toHaveBeenCalled();
		});

		it('does not touch launchable columns when clearing on a non-dockerfile project', async () => {
			mockDbWhere.mockResolvedValue(
				ownershipRow({ workerImage: 'some:ref', workerImageStatus: 'verified' }),
			);

			await superAdminCaller().update({ id: 'p1', workerDockerfile: null });

			expect(mockUpdateProject).toHaveBeenCalledWith('p1', 'org-1', {
				workerDockerfile: null,
				workerImageBuildHash: null,
				workerImageBuildStatus: null,
			});
		});
	});

	describe('audit log', () => {
		it('emits a grep-stable audit line on set (actor + project + from→to content-hash)', async () => {
			mockDbWhere.mockResolvedValue(ownershipRow({ workerImageBuildHash: 'prev-hash' }));

			await superAdminCaller().update({ id: 'p1', workerDockerfile: DOCKERFILE });

			expect(mockLoggerInfo).toHaveBeenCalledWith('[audit] project worker dockerfile changed', {
				event: 'project_worker_dockerfile_changed',
				actorId: superAdmin.id,
				projectId: 'p1',
				from: 'prev-hash',
				to: DOCKERFILE_HASH,
			});
		});

		it('emits a grep-stable audit line on clear (to: null)', async () => {
			mockDbWhere.mockResolvedValue(
				ownershipRow({ workerDockerfile: DOCKERFILE, workerImageBuildHash: DOCKERFILE_HASH }),
			);

			await superAdminCaller().update({ id: 'p1', workerDockerfile: null });

			expect(mockLoggerInfo).toHaveBeenCalledWith('[audit] project worker dockerfile changed', {
				event: 'project_worker_dockerfile_changed',
				actorId: superAdmin.id,
				projectId: 'p1',
				from: DOCKERFILE_HASH,
				to: null,
			});
		});

		it('still audits a persisted change when the build enqueue throws (Redis down)', async () => {
			mockDbWhere.mockResolvedValue(ownershipRow());
			mockEnqueueBuild.mockRejectedValueOnce(new Error('Redis unavailable'));

			await expect(
				superAdminCaller().update({ id: 'p1', workerDockerfile: DOCKERFILE }),
			).rejects.toThrow('Redis unavailable');

			expect(mockUpdateProject).toHaveBeenCalledWith(
				'p1',
				'org-1',
				expect.objectContaining({ workerDockerfile: DOCKERFILE }),
			);
			expect(mockLoggerInfo).toHaveBeenCalledWith(
				'[audit] project worker dockerfile changed',
				expect.objectContaining({ to: DOCKERFILE_HASH }),
			);
		});
	});

	describe('create', () => {
		it('rejects a non-superadmin Dockerfile create with FORBIDDEN', async () => {
			await expectTRPCError(
				adminCaller().create({
					id: 'p2',
					name: 'P2',
					repo: 'owner/repo',
					workerDockerfile: DOCKERFILE,
				}),
				'FORBIDDEN',
			);
			expect(mockCreateProject).not.toHaveBeenCalled();
		});

		it('persists building + content-hash and enqueues when a superadmin creates with a Dockerfile', async () => {
			await superAdminCaller().create({
				id: 'p2',
				name: 'P2',
				repo: 'owner/repo',
				workerDockerfile: DOCKERFILE,
			});

			expect(mockCreateProject).toHaveBeenCalledWith(
				'org-1',
				expect.objectContaining({
					id: 'p2',
					workerDockerfile: DOCKERFILE,
					workerImageBuildHash: DOCKERFILE_HASH,
					workerImageBuildStatus: 'building',
					workerImageStatus: 'building',
				}),
			);
			expect(mockEnqueueBuild).toHaveBeenCalledWith({
				projectId: 'p2',
				buildHash: DOCKERFILE_HASH,
			});
		});

		it('rejects setting workerImage + workerDockerfile in one create with BAD_REQUEST (nothing persisted)', async () => {
			await expectTRPCError(
				superAdminCaller().create({
					id: 'p2',
					name: 'P2',
					repo: 'owner/repo',
					workerImage: VALID_REF,
					workerDockerfile: DOCKERFILE,
				}),
				'BAD_REQUEST',
			);
			expect(mockCreateProject).not.toHaveBeenCalled();
			expect(mockEnqueueBuild).not.toHaveBeenCalled();
			expect(mockEnqueueValidation).not.toHaveBeenCalled();
		});
	});

	describe('rebuildWorkerImage', () => {
		it('rejects a non-superadmin with FORBIDDEN', async () => {
			await expectTRPCError(adminCaller().rebuildWorkerImage({ projectId: 'p1' }), 'FORBIDDEN');
			expect(mockUpdateProject).not.toHaveBeenCalled();
			expect(mockEnqueueBuild).not.toHaveBeenCalled();
		});

		it('re-enqueues a build for a dockerfile project even when unchanged', async () => {
			mockDbWhere.mockResolvedValue(
				ownershipRow({
					workerDockerfile: DOCKERFILE,
					workerImageBuildHash: DOCKERFILE_HASH,
					workerImageStatus: 'verified',
				}),
			);

			await superAdminCaller().rebuildWorkerImage({ projectId: 'p1' });

			expect(mockUpdateProject).toHaveBeenCalledWith('p1', 'org-1', {
				workerImageBuildStatus: 'building',
			});
			expect(mockEnqueueBuild).toHaveBeenCalledWith({
				projectId: 'p1',
				buildHash: DOCKERFILE_HASH,
			});
			expect(mockLoggerInfo).toHaveBeenCalledWith(
				'[audit] project worker dockerfile changed',
				expect.objectContaining({ rebuild: true }),
			);
		});

		it('rejects a rebuild on a non-dockerfile project with BAD_REQUEST', async () => {
			mockDbWhere.mockResolvedValue(ownershipRow({ workerImage: 'some:ref' }));

			await expectTRPCError(
				superAdminCaller().rebuildWorkerImage({ projectId: 'p1' }),
				'BAD_REQUEST',
			);
			expect(mockUpdateProject).not.toHaveBeenCalled();
			expect(mockEnqueueBuild).not.toHaveBeenCalled();
		});
	});
});
