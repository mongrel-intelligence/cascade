/**
 * Spec 024 plan 4 — repo-sharing validation on project create/update.
 *
 * Saving a repository another project already owned used to hit the `repo`
 * unique index and surface as a raw 500 with nothing to act on. Sharing is now
 * legal, so the save has to say which shapes are allowed and name the conflict
 * when they are not: exactly one project per repository is the PRIMARY, the one
 * that owns events carrying no PR→project link.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSuperAdmin } from '../../../helpers/factories.js';
import { createCallerFor, setupOwnershipCheckMock } from '../../../helpers/trpcTestHarness.js';

const { mockUpdateProject, mockCreateProject, mockFindRepoSiblings } = vi.hoisted(() => ({
	mockUpdateProject: vi.fn(),
	mockCreateProject: vi.fn(),
	mockFindRepoSiblings: vi.fn(),
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
vi.mock('../../../../src/db/repositories/configRepository.js', () => ({
	findRepoSiblingsFromDb: mockFindRepoSiblings,
}));
vi.mock('../../../../src/db/repositories/credentialsRepository.js', () => ({
	listProjectCredentials: vi.fn(),
	listProjectCredentialsMeta: vi.fn(),
	writeProjectCredential: vi.fn(),
	deleteProjectCredential: vi.fn(),
}));
vi.mock('../../../../src/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('../../../../src/queue/client.js', () => ({
	enqueueWorkerImageValidationJob: vi.fn(),
	enqueueWorkerImageBuildJob: vi.fn(),
}));
vi.mock('../../../../src/router/config.js', () => ({ routerConfig: { workerImage: 'img' } }));
vi.mock('../../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { mockDbSelect, mockDbFrom, mockDbWhere } = setupOwnershipCheckMock();
vi.mock('../../../../src/db/client.js', () => ({ getDb: () => ({ select: mockDbSelect }) }));
vi.mock('../../../../src/db/schema/index.js', () => ({
	projects: { id: 'id', orgId: 'org_id' },
}));

import { projectsRouter } from '../../../../src/api/routers/projects.js';

const createCaller = createCallerFor(projectsRouter);
const superAdmin = createMockSuperAdmin();
const REPO = 'acme/web';

const sibling = (id: string, repoPrimary: boolean) => ({ id, repoPrimary });

describe('projectsRouter — repository sharing (spec 024)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbSelect.mockReturnValue({ from: mockDbFrom });
		mockDbFrom.mockReturnValue({ where: mockDbWhere });
		mockCreateProject.mockResolvedValue({ id: 'p1' });
		mockUpdateProject.mockResolvedValue(undefined);
		mockFindRepoSiblings.mockResolvedValue([]);
		// The update path first checks the project belongs to the caller's org.
		mockDbWhere.mockResolvedValue([{ orgId: superAdmin.orgId }]);
	});

	const caller = () => createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });

	const create = (over: Record<string, unknown> = {}) =>
		caller().create({ id: 'newproj', name: 'New', repo: REPO, ...over } as never);

	it('makes the first project on a repository its primary', async () => {
		await create();

		expect(mockCreateProject).toHaveBeenCalledWith(
			superAdmin.orgId,
			expect.objectContaining({ repo: REPO, repoPrimary: true }),
		);
	});

	it('accepts an explicit secondary alongside an existing primary', async () => {
		mockFindRepoSiblings.mockResolvedValue([sibling('frontend', true)]);

		await create({ repoPrimary: false });

		expect(mockCreateProject).toHaveBeenCalledWith(
			superAdmin.orgId,
			expect.objectContaining({ repoPrimary: false }),
		);
	});

	it('rejects a duplicate repository, naming the project that owns it', async () => {
		// The old behaviour was a raw 500 from the unique index — nothing the
		// operator could act on, and no hint that sharing is even possible.
		mockFindRepoSiblings.mockResolvedValue([sibling('frontend', true)]);

		await expect(create()).rejects.toThrow(/frontend/);
		expect(mockCreateProject).not.toHaveBeenCalled();
	});

	it('rejects a second project claiming primary, naming the incumbent', async () => {
		mockFindRepoSiblings.mockResolvedValue([sibling('frontend', true)]);

		await expect(create({ repoPrimary: true })).rejects.toThrow(/frontend/);
	});

	it('rejects demoting the only primary while secondaries remain', async () => {
		// Would leave the repository with no owner for unlinked events — every
		// human-authored PR would stop being routed anywhere.
		mockFindRepoSiblings.mockResolvedValue([sibling('frontend', true), sibling('backend', false)]);

		await expect(
			caller().update({ id: 'frontend', repo: REPO, repoPrimary: false } as never),
		).rejects.toThrow(/primary/i);
	});

	it('allows a project to re-save its own repository unchanged', async () => {
		mockFindRepoSiblings.mockResolvedValue([sibling('frontend', true)]);

		await caller().update({ id: 'frontend', repo: REPO, repoPrimary: true } as never);

		expect(mockUpdateProject).toHaveBeenCalled();
	});

	it('maps the unique-violation race to the same named error, not a 500', async () => {
		// The pre-check can pass and still lose to a concurrent save; the DB stays
		// the authority, but the operator should see the same message either way.
		mockFindRepoSiblings.mockResolvedValue([]);
		// The shape drizzle actually produces: it wraps the pg DatabaseError, so
		// code/constraint live on .cause. Asserting the flat shape would pass
		// while production fell through to a 500.
		mockCreateProject.mockRejectedValue(
			Object.assign(new Error('DrizzleQueryError'), {
				cause: Object.assign(new Error('duplicate key value violates unique constraint'), {
					code: '23505',
					constraint: 'uq_projects_repo_primary',
				}),
			}),
		);

		await expect(create()).rejects.toThrow(/primary/i);
	});

	it('refuses to create the only project on a repository as a secondary', async () => {
		// The partial unique index forbids TWO primaries; it cannot require one.
		// A repo with zero primaries drops every event that carries no PR link.
		await expect(create({ repoPrimary: false })).rejects.toThrow(/primary/i);
		expect(mockCreateProject).not.toHaveBeenCalled();
	});

	it('refuses to demote a repository’s only project', async () => {
		mockFindRepoSiblings.mockResolvedValue([sibling('solo', true)]);

		await expect(
			caller().update({ id: 'solo', repo: REPO, repoPrimary: false } as never),
		).rejects.toThrow(/primary/i);
	});

	it('runs no topology check for a project without a repository', async () => {
		// AC #12 pin: PM-only projects must not gain a sibling query.
		await caller().create({ id: 'pmonly', name: 'PM only' } as never);

		expect(mockFindRepoSiblings).not.toHaveBeenCalled();
		expect(mockCreateProject).toHaveBeenCalled();
	});
});
