import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBuiltInEngines } from '../../../../src/backends/bootstrap.js';
import { CLAUDE_CODE_SETTING_DEFAULTS } from '../../../../src/backends/claude-code/settings.js';
import { CODEX_SETTING_DEFAULTS } from '../../../../src/backends/codex/settings.js';
import { OPENCODE_SETTING_DEFAULTS } from '../../../../src/backends/opencode/settings.js';
import { PROJECT_DEFAULTS } from '../../../../src/config/schema.js';
import { createMockUser } from '../../../helpers/factories.js';
import {
	createCallerFor,
	expectTRPCError,
	setupOwnershipCheckMock,
} from '../../../helpers/trpcTestHarness.js';

const {
	mockListProjectsForOrg,
	mockListProjectsFull,
	mockGetProjectFull,
	mockCreateProject,
	mockUpdateProject,
	mockDeleteProject,
	mockListProjectIntegrations,
	mockUpsertProjectIntegration,
	mockDeleteProjectIntegration,
	mockListProjectCredentials,
	mockListProjectCredentialsMeta,
	mockWriteProjectCredential,
	mockDeleteProjectCredential,
	mockCaptureException,
} = vi.hoisted(() => ({
	mockListProjectsForOrg: vi.fn(),
	mockListProjectsFull: vi.fn(),
	mockGetProjectFull: vi.fn(),
	mockCreateProject: vi.fn(),
	mockUpdateProject: vi.fn(),
	mockDeleteProject: vi.fn(),
	mockListProjectIntegrations: vi.fn(),
	mockUpsertProjectIntegration: vi.fn(),
	mockDeleteProjectIntegration: vi.fn(),
	mockListProjectCredentials: vi.fn(),
	mockListProjectCredentialsMeta: vi.fn(),
	mockWriteProjectCredential: vi.fn(),
	mockDeleteProjectCredential: vi.fn(),
	mockCaptureException: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/runsRepository.js', () => ({
	listProjectsForOrg: mockListProjectsForOrg,
}));

vi.mock('../../../../src/db/repositories/settingsRepository.js', () => ({
	listProjectsFull: mockListProjectsFull,
	getProjectFull: mockGetProjectFull,
	createProject: mockCreateProject,
	updateProject: mockUpdateProject,
	deleteProject: mockDeleteProject,
	listProjectIntegrations: mockListProjectIntegrations,
	upsertProjectIntegration: mockUpsertProjectIntegration,
	deleteProjectIntegration: mockDeleteProjectIntegration,
}));

vi.mock('../../../../src/db/repositories/credentialsRepository.js', () => ({
	listProjectCredentials: mockListProjectCredentials,
	listProjectCredentialsMeta: mockListProjectCredentialsMeta,
	writeProjectCredential: mockWriteProjectCredential,
	deleteProjectCredential: mockDeleteProjectCredential,
}));

vi.mock('../../../../src/sentry.js', () => ({
	captureException: mockCaptureException,
}));

// Mock getDb for ownership checks
const { mockDbSelect, mockDbFrom, mockDbWhere, configureOwnership } = setupOwnershipCheckMock();

vi.mock('../../../../src/db/client.js', () => ({
	getDb: () => ({
		select: mockDbSelect,
	}),
}));

vi.mock('../../../../src/db/schema/index.js', () => ({
	projects: { id: 'id', orgId: 'org_id' },
}));

import { projectsRouter } from '../../../../src/api/routers/projects.js';

const createCaller = createCallerFor(projectsRouter);

const mockUser = createMockUser();

beforeAll(() => {
	registerBuiltInEngines();
});

describe('projectsRouter', () => {
	beforeEach(() => {
		mockDbSelect.mockReturnValue({ from: mockDbFrom });
		mockDbFrom.mockReturnValue({ where: mockDbWhere });
	});

	// ============================================================================
	// Existing list procedure
	// ============================================================================

	describe('list', () => {
		it('calls listProjectsForOrg with orgId from user context', async () => {
			mockListProjectsForOrg.mockResolvedValue([
				{ id: 'p1', name: 'Project 1' },
				{ id: 'p2', name: 'Project 2' },
			]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.list();

			expect(mockListProjectsForOrg).toHaveBeenCalledWith('org-1');
			expect(result).toEqual([
				{ id: 'p1', name: 'Project 1' },
				{ id: 'p2', name: 'Project 2' },
			]);
		});

		it('returns empty array when org has no projects', async () => {
			mockListProjectsForOrg.mockResolvedValue([]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.list();
			expect(result).toEqual([]);
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.list(), 'UNAUTHORIZED');
		});
	});

	// ============================================================================
	// New CRUD procedures
	// ============================================================================

	describe('listFull', () => {
		it('returns all project columns', async () => {
			const projects = [
				{
					id: 'p1',
					name: 'Project 1',
					repo: 'owner/repo1',
					baseBranch: 'main',
					agentEngineSettings: { codex: { approvalPolicy: 'never' } },
				},
			];
			mockListProjectsFull.mockResolvedValue(projects);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.listFull();

			expect(mockListProjectsFull).toHaveBeenCalledWith('org-1');
			expect(result).toEqual([
				{
					id: 'p1',
					name: 'Project 1',
					repo: 'owner/repo1',
					baseBranch: 'main',
					engineSettings: { codex: { approvalPolicy: 'never' } },
				},
			]);
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.listFull(), 'UNAUTHORIZED');
		});
	});

	describe('getById', () => {
		it('returns project when found', async () => {
			const project = {
				id: 'p1',
				orgId: 'org-1',
				name: 'Project 1',
				agentEngineSettings: { codex: { sandboxMode: 'read-only' } },
			};
			mockGetProjectFull.mockResolvedValue(project);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.getById({ id: 'p1' });

			expect(mockGetProjectFull).toHaveBeenCalledWith('p1', 'org-1');
			expect(result).toEqual({
				id: 'p1',
				orgId: 'org-1',
				name: 'Project 1',
				engineSettings: { codex: { sandboxMode: 'read-only' } },
			});
		});

		it('throws NOT_FOUND when project does not exist', async () => {
			mockGetProjectFull.mockResolvedValue(null);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.getById({ id: 'missing' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});
	});

	describe('create', () => {
		it('creates project with required fields', async () => {
			const created = { id: 'my-project', orgId: 'org-1', name: 'My Project', repo: 'owner/repo' };
			mockCreateProject.mockResolvedValue(created);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.create({
				id: 'my-project',
				name: 'My Project',
				repo: 'owner/repo',
				engineSettings: { codex: { approvalPolicy: 'never' } },
			});

			expect(mockCreateProject).toHaveBeenCalledWith('org-1', {
				id: 'my-project',
				name: 'My Project',
				repo: 'owner/repo',
				engineSettings: { codex: { approvalPolicy: 'never' } },
			});
			expect(result).toEqual(created);
		});

		it('rejects invalid id format', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.create({ id: 'INVALID ID!', name: 'X', repo: 'owner/repo' }),
			).rejects.toThrow();
		});

		it('rejects empty name', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.create({ id: 'valid-id', name: '', repo: 'owner/repo' }),
			).rejects.toThrow();
		});

		it('rejects unsupported engine settings on create', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(
				caller.create({
					id: 'valid-id',
					name: 'Project',
					repo: 'owner/repo',
					engineSettings: {
						unknown: { foo: 'bar' },
					},
				}),
			).rejects.toThrow('Unsupported engine settings');
		});
	});

	describe('update', () => {
		it('updates project after verifying ownership', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockUpdateProject.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.update({ id: 'p1', name: 'Updated Name', model: 'new-model' });

			expect(mockUpdateProject).toHaveBeenCalledWith('p1', 'org-1', {
				name: 'Updated Name',
				model: 'new-model',
			});
		});

		it('throws NOT_FOUND when project belongs to different org', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'different-org' }]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.update({ id: 'p1', name: 'X' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
			expect(mockUpdateProject).not.toHaveBeenCalled();
		});

		it('passes engineSettings through on update', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockUpdateProject.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.update({
				id: 'p1',
				engineSettings: { codex: { approvalPolicy: 'never', webSearch: false } },
			});

			expect(mockUpdateProject).toHaveBeenCalledWith('p1', 'org-1', {
				engineSettings: { codex: { approvalPolicy: 'never', webSearch: false } },
			});
		});

		it('rejects unsupported engine settings on update', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(
				caller.update({
					id: 'p1',
					engineSettings: {
						unknown: { foo: 'bar' },
					},
				}),
			).rejects.toThrow('Unsupported engine settings');
			expect(mockUpdateProject).not.toHaveBeenCalled();
		});
	});

	describe('delete', () => {
		it('deletes project after verifying ownership', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockDeleteProject.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.delete({ id: 'p1' });

			expect(mockDeleteProject).toHaveBeenCalledWith('p1', 'org-1');
		});

		it('throws NOT_FOUND when project belongs to different org', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'different-org' }]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.delete({ id: 'p1' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
			expect(mockDeleteProject).not.toHaveBeenCalled();
		});
	});

	// ============================================================================
	// Integrations sub-router
	// ============================================================================

	describe('integrations', () => {
		describe('list', () => {
			it('lists integrations after verifying ownership', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				const integrations = [
					{
						id: 1,
						category: 'pm',
						provider: 'trello',
						config: { boardId: 'abc' },
						triggers: {},
					},
				];
				mockListProjectIntegrations.mockResolvedValue(integrations);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				const result = await caller.integrations.list({ projectId: 'p1' });

				expect(result).toEqual(integrations);
			});

			it('throws NOT_FOUND when project not owned', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'other-org' }]);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				await expect(caller.integrations.list({ projectId: 'p1' })).rejects.toMatchObject({
					code: 'NOT_FOUND',
				});
			});
		});

		describe('upsert', () => {
			it('upserts integration after verifying ownership', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				mockUpsertProjectIntegration.mockResolvedValue(undefined);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				await caller.integrations.upsert({
					projectId: 'p1',
					category: 'pm',
					provider: 'trello',
					config: { boardId: 'abc123' },
				});

				expect(mockUpsertProjectIntegration).toHaveBeenCalledWith(
					'p1',
					'pm',
					'trello',
					{ boardId: 'abc123' },
					undefined,
				);
			});
		});

		describe('delete', () => {
			it('deletes integration after verifying ownership', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				mockDeleteProjectIntegration.mockResolvedValue(undefined);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				await caller.integrations.delete({ projectId: 'p1', category: 'pm' });

				expect(mockDeleteProjectIntegration).toHaveBeenCalledWith('p1', 'pm');
			});
		});
	});

	// ============================================================================
	// projects.credentials.* sub-router
	// ============================================================================

	describe('credentials', () => {
		describe('list', () => {
			it('throws UNAUTHORIZED when not authenticated', async () => {
				const caller = createCaller({ user: null, effectiveOrgId: null });
				await expectTRPCError(caller.credentials.list({ projectId: 'p1' }), 'UNAUTHORIZED');
			});

			it('returns masked metadata — never plaintext', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				mockListProjectCredentials.mockResolvedValue([
					{ envVarKey: 'OPENROUTER_API_KEY', name: 'OpenRouter Key', value: 'sk-or-12345678' },
					{ envVarKey: 'SHORT', name: null, value: '123' },
				]);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				const result = await caller.credentials.list({ projectId: 'p1' });

				expect(result).toEqual([
					{
						envVarKey: 'OPENROUTER_API_KEY',
						name: 'OpenRouter Key',
						isConfigured: true,
						maskedValue: '****5678',
					},
					{
						envVarKey: 'SHORT',
						name: null,
						isConfigured: true,
						maskedValue: '****',
					},
				]);
			});

			it('calls listProjectCredentials with projectId', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				mockListProjectCredentials.mockResolvedValue([]);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				await caller.credentials.list({ projectId: 'p1' });

				expect(mockListProjectCredentials).toHaveBeenCalledWith('p1');
			});

			it('returns project NOT_FOUND when project does not belong to org', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'different-org' }]);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				await expect(caller.credentials.list({ projectId: 'p1' })).rejects.toMatchObject({
					code: 'NOT_FOUND',
				});
			});

			it('falls back to meta-only query when decryption fails', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				mockListProjectCredentials.mockRejectedValueOnce(
					new Error('Decryption failed: CREDENTIAL_MASTER_KEY not set'),
				);
				mockListProjectCredentialsMeta.mockResolvedValueOnce([
					{ envVarKey: 'GITHUB_TOKEN_IMPLEMENTER', name: 'GH Implementer' },
					{ envVarKey: 'OPENROUTER_API_KEY', name: null },
				]);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				const result = await caller.credentials.list({ projectId: 'p1' });

				expect(result).toEqual([
					{
						envVarKey: 'GITHUB_TOKEN_IMPLEMENTER',
						name: 'GH Implementer',
						isConfigured: true,
						maskedValue: '****',
					},
					{
						envVarKey: 'OPENROUTER_API_KEY',
						name: null,
						isConfigured: true,
						maskedValue: '****',
					},
				]);
				expect(mockListProjectCredentialsMeta).toHaveBeenCalledWith('p1');
			});

			it('reports decryption failure to Sentry', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				const decryptionError = new Error('bad key');
				mockListProjectCredentials.mockRejectedValueOnce(decryptionError);
				mockListProjectCredentialsMeta.mockResolvedValueOnce([]);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				await caller.credentials.list({ projectId: 'p1' });

				expect(mockCaptureException).toHaveBeenCalledWith(decryptionError, {
					tags: { source: 'credentials_list' },
					extra: { projectId: 'p1' },
					level: 'warning',
				});
			});

			it('masks credential with exactly 11 chars (short — shows ****)', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				// 11 chars: 'abcdefghijk'
				mockListProjectCredentials.mockResolvedValue([
					{ envVarKey: 'KEY_11', name: null, value: 'abcdefghijk' },
				]);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				const result = await caller.credentials.list({ projectId: 'p1' });

				expect(result[0].maskedValue).toBe('****');
			});

			it('masks credential with exactly 12 chars (boundary — shows ****)', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				// 12 chars: 'abcdefghijkl'
				mockListProjectCredentials.mockResolvedValue([
					{ envVarKey: 'KEY_12', name: null, value: 'abcdefghijkl' },
				]);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				const result = await caller.credentials.list({ projectId: 'p1' });

				expect(result[0].maskedValue).toBe('****');
			});

			it('masks credential with exactly 13 chars (long — shows last 4 chars)', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				// 13 chars: 'abcdefghijklm'
				mockListProjectCredentials.mockResolvedValue([
					{ envVarKey: 'KEY_13', name: null, value: 'abcdefghijklm' },
				]);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				const result = await caller.credentials.list({ projectId: 'p1' });

				expect(result[0].maskedValue).toBe('****jklm');
			});
		});

		describe('set', () => {
			it('throws UNAUTHORIZED when not authenticated', async () => {
				const caller = createCaller({ user: null, effectiveOrgId: null });
				await expectTRPCError(
					caller.credentials.set({
						projectId: 'p1',
						envVarKey: 'OPENROUTER_API_KEY',
						value: 'sk-or-abc',
					}),
					'UNAUTHORIZED',
				);
			});

			it('calls writeProjectCredential with correct args', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				mockWriteProjectCredential.mockResolvedValue(undefined);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				await caller.credentials.set({
					projectId: 'p1',
					envVarKey: 'OPENROUTER_API_KEY',
					value: 'sk-or-abc123',
					name: 'OpenRouter',
				});

				expect(mockWriteProjectCredential).toHaveBeenCalledWith(
					'p1',
					'OPENROUTER_API_KEY',
					'sk-or-abc123',
					'OpenRouter',
				);
			});

			it('rejects envVarKey with invalid format', async () => {
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
				await expect(
					caller.credentials.set({
						projectId: 'p1',
						envVarKey: 'lower-case-key',
						value: 'value',
					}),
				).rejects.toThrow();
			});

			it('rejects empty value', async () => {
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
				await expect(
					caller.credentials.set({
						projectId: 'p1',
						envVarKey: 'OPENROUTER_API_KEY',
						value: '',
					}),
				).rejects.toThrow();
			});
		});

		describe('delete', () => {
			it('throws UNAUTHORIZED when not authenticated', async () => {
				const caller = createCaller({ user: null, effectiveOrgId: null });
				await expectTRPCError(
					caller.credentials.delete({ projectId: 'p1', envVarKey: 'OPENROUTER_API_KEY' }),
					'UNAUTHORIZED',
				);
			});

			it('calls deleteProjectCredential with correct args', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				mockDeleteProjectCredential.mockResolvedValue(undefined);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				await caller.credentials.delete({ projectId: 'p1', envVarKey: 'OPENROUTER_API_KEY' });

				expect(mockDeleteProjectCredential).toHaveBeenCalledWith('p1', 'OPENROUTER_API_KEY');
			});
		});
	});

	// ============================================================================
	// defaults procedure
	// ============================================================================

	describe('defaults', () => {
		it('returns project defaults sourced from PROJECT_DEFAULTS constants', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });

			const result = await caller.defaults();

			expect(result.model).toBe(PROJECT_DEFAULTS.model);
			expect(result.maxIterations).toBe(PROJECT_DEFAULTS.maxIterations);
			expect(result.watchdogTimeoutMs).toBe(PROJECT_DEFAULTS.watchdogTimeoutMs);
			expect(result.progressModel).toBe(PROJECT_DEFAULTS.progressModel);
			expect(result.progressIntervalMinutes).toBe(PROJECT_DEFAULTS.progressIntervalMinutes);
			expect(result.workItemBudgetUsd).toBe(PROJECT_DEFAULTS.workItemBudgetUsd);
			expect(result.agentEngine).toBe(PROJECT_DEFAULTS.agentEngine);
		});

		it('returns per-engine setting defaults', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });

			const result = await caller.defaults();

			expect(result.engineSettings['claude-code']).toEqual(CLAUDE_CODE_SETTING_DEFAULTS);
			expect(result.engineSettings.codex).toEqual(CODEX_SETTING_DEFAULTS);
			expect(result.engineSettings.opencode).toEqual(OPENCODE_SETTING_DEFAULTS);
		});

		it('is accessible without authentication (publicProcedure)', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });

			// Should not throw UNAUTHORIZED
			await expect(caller.defaults()).resolves.toBeDefined();
		});

		it('PROJECT_DEFAULTS values match the Zod schema defaults', () => {
			expect(PROJECT_DEFAULTS.model).toBe('openrouter:google/gemini-3-flash-preview');
			expect(PROJECT_DEFAULTS.maxIterations).toBe(50);
			expect(PROJECT_DEFAULTS.watchdogTimeoutMs).toBe(30 * 60 * 1000);
			expect(PROJECT_DEFAULTS.progressModel).toBe('openrouter:google/gemini-2.5-flash-lite');
			expect(PROJECT_DEFAULTS.progressIntervalMinutes).toBe(5);
			expect(PROJECT_DEFAULTS.workItemBudgetUsd).toBe(5);
			expect(PROJECT_DEFAULTS.agentEngine).toBe('claude-code');
		});

		it('CLAUDE_CODE_SETTING_DEFAULTS match the resolver fallback values', () => {
			expect(CLAUDE_CODE_SETTING_DEFAULTS.effort).toBe('high');
			expect(CLAUDE_CODE_SETTING_DEFAULTS.thinking).toBe('adaptive');
		});

		it('CODEX_SETTING_DEFAULTS match the resolver fallback values', () => {
			expect(CODEX_SETTING_DEFAULTS.approvalPolicy).toBe('never');
			expect(CODEX_SETTING_DEFAULTS.sandboxMode).toBe('danger-full-access');
			expect(CODEX_SETTING_DEFAULTS.webSearch).toBe(false);
		});

		it('OPENCODE_SETTING_DEFAULTS match the resolver fallback values', () => {
			expect(OPENCODE_SETTING_DEFAULTS.webSearch).toBe(false);
		});
	});
});
