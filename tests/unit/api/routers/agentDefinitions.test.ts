import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDefinition } from '../../../../src/agents/definitions/schema.js';
import type { TRPCContext } from '../../../../src/api/trpc.js';
import { createMockSuperAdmin, createMockUser } from '../../../helpers/factories.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetKnownAgentTypes = vi.fn<() => string[]>();
const mockInvalidateDefinitionCache = vi.fn();
const mockLoadAgentDefinition = vi.fn<(agentType: string) => AgentDefinition>();
const mockResolveAgentDefinition = vi.fn<(agentType: string) => Promise<AgentDefinition>>();
const mockResolveKnownAgentTypes = vi.fn<() => Promise<string[]>>();

vi.mock('../../../../src/agents/definitions/loader.js', () => ({
	getKnownAgentTypes: (...args: unknown[]) => mockGetKnownAgentTypes(...(args as [])),
	invalidateDefinitionCache: (...args: unknown[]) => mockInvalidateDefinitionCache(...(args as [])),
	loadAgentDefinition: (...args: unknown[]) => mockLoadAgentDefinition(...(args as [string])),
	resolveAgentDefinition: (...args: unknown[]) => mockResolveAgentDefinition(...(args as [string])),
	resolveKnownAgentTypes: (...args: unknown[]) => mockResolveKnownAgentTypes(...(args as [])),
}));

const mockListAgentDefinitions = vi.fn();
const mockGetAgentDefinition = vi.fn();
const mockUpsertAgentDefinition = vi.fn();
const mockDeleteAgentDefinition = vi.fn();

vi.mock('../../../../src/db/repositories/agentDefinitionsRepository.js', () => ({
	listAgentDefinitions: (...args: unknown[]) => mockListAgentDefinitions(...args),
	getAgentDefinition: (...args: unknown[]) => mockGetAgentDefinition(...args),
	upsertAgentDefinition: (...args: unknown[]) => mockUpsertAgentDefinition(...args),
	deleteAgentDefinition: (...args: unknown[]) => mockDeleteAgentDefinition(...args),
}));

// Re-export schema values (these are pure constants, not functions to mock)
vi.mock('../../../../src/agents/definitions/schema.js', async (importOriginal) => {
	const original = (await importOriginal()) as Record<string, unknown>;
	return {
		...original,
	};
});

import { agentDefinitionsRouter } from '../../../../src/api/routers/agentDefinitions.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCaller(ctx: TRPCContext) {
	return agentDefinitionsRouter.createCaller(ctx);
}

const mockUser = createMockUser();
const mockSuperAdmin = createMockSuperAdmin();

/** Minimal valid AgentDefinition for test fixtures */
function createMockDefinition(overrides?: Partial<AgentDefinition>): AgentDefinition {
	return {
		identity: {
			emoji: '🤖',
			label: 'Test Agent',
			roleHint: 'test',
			initialMessage: 'Hello',
		},
		capabilities: {
			required: ['fs:read', 'fs:write', 'shell:exec', 'session:ctrl', 'scm:pr'],
			optional: [],
		},
		triggers: [],
		strategies: {
			contextPipeline: ['directoryListing'],
		},
		backend: {
			enableStopHooks: true,
			needsGitHubToken: true,
		},
		compaction: 'default',
		hint: 'A test agent',
		trailingMessage: undefined,
		prompts: {
			taskPrompt:
				'Analyze and process the work item with ID: <%= it.cardId %>. The work item data has been pre-loaded.',
		},
		...overrides,
	} as AgentDefinition;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agentDefinitionsRouter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetKnownAgentTypes.mockReturnValue(['implementation', 'review']);
	});

	// =====================================================================
	// list
	// =====================================================================
	describe('list', () => {
		it('returns DB definitions merged with YAML fallback for missing types', async () => {
			const dbDef = createMockDefinition();
			mockListAgentDefinitions.mockResolvedValue([
				{ agentType: 'implementation', definition: dbDef, isBuiltin: true },
			]);
			const yamlDef = createMockDefinition({ hint: 'from yaml' });
			mockLoadAgentDefinition.mockReturnValue(yamlDef);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.list();

			expect(result).toHaveLength(2);
			// DB entry comes first
			expect(result[0]).toEqual({
				agentType: 'implementation',
				definition: dbDef,
				isBuiltin: true,
			});
			// YAML fallback for 'review' (not in DB)
			expect(result[1]).toEqual({
				agentType: 'review',
				definition: yamlDef,
				isBuiltin: true,
			});
		});

		it('falls back to YAML only when DB fails', async () => {
			mockListAgentDefinitions.mockRejectedValue(new Error('DB down'));
			const yamlDef = createMockDefinition();
			mockLoadAgentDefinition.mockReturnValue(yamlDef);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.list();

			// Should have all YAML types
			expect(result).toHaveLength(2);
			expect(result[0]).toMatchObject({ agentType: 'implementation', isBuiltin: true });
			expect(result[1]).toMatchObject({ agentType: 'review', isBuiltin: true });
		});

		it('includes DB-only types not in YAML', async () => {
			const customDef = createMockDefinition({ hint: 'custom' });
			mockListAgentDefinitions.mockResolvedValue([
				{ agentType: 'custom-agent', definition: customDef, isBuiltin: false },
			]);
			const yamlDef = createMockDefinition();
			mockLoadAgentDefinition.mockReturnValue(yamlDef);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.list();

			expect(result).toHaveLength(3); // 1 DB-only + 2 YAML fallback
			expect(result[0]).toEqual({
				agentType: 'custom-agent',
				definition: customDef,
				isBuiltin: false,
			});
		});

		it('does not call listAgentDefinitions twice (no redundant DB query)', async () => {
			mockListAgentDefinitions.mockResolvedValue([]);
			mockLoadAgentDefinition.mockReturnValue(createMockDefinition());

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await caller.list();

			expect(mockListAgentDefinitions).toHaveBeenCalledTimes(1);
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});
	});

	// =====================================================================
	// get
	// =====================================================================
	describe('get', () => {
		it('returns a single definition by agentType', async () => {
			const def = createMockDefinition();
			mockResolveAgentDefinition.mockResolvedValue(def);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.get({ agentType: 'implementation' });

			expect(result).toEqual({
				agentType: 'implementation',
				definition: def,
				isBuiltin: true,
			});
		});

		it('marks non-YAML types as not builtin', async () => {
			const def = createMockDefinition();
			mockResolveAgentDefinition.mockResolvedValue(def);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.get({ agentType: 'custom-agent' });

			expect(result.isBuiltin).toBe(false);
		});

		it('throws NOT_FOUND when definition does not exist', async () => {
			mockResolveAgentDefinition.mockRejectedValue(new Error('not found'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.get({ agentType: 'missing' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.get({ agentType: 'implementation' })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});

	// =====================================================================
	// create
	// =====================================================================
	describe('create', () => {
		it('creates a new definition (superadmin)', async () => {
			mockGetAgentDefinition.mockResolvedValue(null);
			mockUpsertAgentDefinition.mockResolvedValue(undefined);
			const def = createMockDefinition();

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			const result = await caller.create({ agentType: 'new-agent', definition: def });

			expect(result).toEqual({ agentType: 'new-agent' });
			expect(mockUpsertAgentDefinition).toHaveBeenCalledWith('new-agent', def, false);
			expect(mockInvalidateDefinitionCache).toHaveBeenCalled();
		});

		it('marks YAML-backed type as builtin on create', async () => {
			mockGetAgentDefinition.mockResolvedValue(null);
			mockUpsertAgentDefinition.mockResolvedValue(undefined);
			const def = createMockDefinition();

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			await caller.create({ agentType: 'implementation', definition: def });

			expect(mockUpsertAgentDefinition).toHaveBeenCalledWith('implementation', def, true);
		});

		it('throws CONFLICT when agent type already exists', async () => {
			mockGetAgentDefinition.mockResolvedValue(createMockDefinition());
			const def = createMockDefinition();

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			await expect(caller.create({ agentType: 'existing', definition: def })).rejects.toMatchObject(
				{ code: 'CONFLICT' },
			);
		});

		it('throws FORBIDDEN when non-superadmin tries to create', async () => {
			const def = createMockDefinition();
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.create({ agentType: 'new', definition: def })).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const def = createMockDefinition();
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.create({ agentType: 'new', definition: def })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});

	// =====================================================================
	// update
	// =====================================================================
	describe('update', () => {
		it('merges patch and updates (superadmin)', async () => {
			const current = createMockDefinition();
			mockResolveAgentDefinition.mockResolvedValue(current);
			mockUpsertAgentDefinition.mockResolvedValue(undefined);

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			const result = await caller.update({
				agentType: 'implementation',
				patch: { hint: 'updated hint' },
			});

			expect(result).toEqual({ agentType: 'implementation' });
			expect(mockUpsertAgentDefinition).toHaveBeenCalledWith(
				'implementation',
				expect.objectContaining({ hint: 'updated hint' }),
				true,
			);
			expect(mockInvalidateDefinitionCache).toHaveBeenCalled();
		});

		it('throws NOT_FOUND when definition does not exist', async () => {
			mockResolveAgentDefinition.mockRejectedValue(new Error('not found'));

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			await expect(
				caller.update({ agentType: 'missing', patch: { hint: 'x' } }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});

		it('throws FORBIDDEN when non-superadmin tries to update', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.update({ agentType: 'implementation', patch: { hint: 'x' } }),
			).rejects.toMatchObject({ code: 'FORBIDDEN' });
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(
				caller.update({ agentType: 'implementation', patch: { hint: 'x' } }),
			).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});
	});

	// =====================================================================
	// delete
	// =====================================================================
	describe('delete', () => {
		it('deletes a non-builtin definition (superadmin)', async () => {
			mockGetAgentDefinition.mockResolvedValue(createMockDefinition());
			mockGetKnownAgentTypes.mockReturnValue(['implementation', 'review']); // custom-agent is NOT in this list
			mockDeleteAgentDefinition.mockResolvedValue(undefined);

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			const result = await caller.delete({ agentType: 'custom-agent' });

			expect(result).toEqual({ agentType: 'custom-agent' });
			expect(mockDeleteAgentDefinition).toHaveBeenCalledWith('custom-agent');
			expect(mockInvalidateDefinitionCache).toHaveBeenCalled();
		});

		it('throws NOT_FOUND when definition not in DB', async () => {
			mockGetAgentDefinition.mockResolvedValue(null);

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			await expect(caller.delete({ agentType: 'missing' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws FORBIDDEN when trying to delete a builtin (YAML-backed) type', async () => {
			mockGetAgentDefinition.mockResolvedValue(createMockDefinition());

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			await expect(caller.delete({ agentType: 'implementation' })).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
		});

		it('throws FORBIDDEN when non-superadmin tries to delete', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.delete({ agentType: 'custom' })).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.delete({ agentType: 'custom' })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});

	// =====================================================================
	// reset
	// =====================================================================
	describe('reset', () => {
		it('resets a builtin definition to YAML default (superadmin)', async () => {
			const yamlDef = createMockDefinition({ hint: 'yaml default' });
			mockLoadAgentDefinition.mockReturnValue(yamlDef);
			mockUpsertAgentDefinition.mockResolvedValue(undefined);

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			const result = await caller.reset({ agentType: 'implementation' });

			expect(result).toEqual({ agentType: 'implementation' });
			expect(mockLoadAgentDefinition).toHaveBeenCalledWith('implementation');
			expect(mockUpsertAgentDefinition).toHaveBeenCalledWith('implementation', yamlDef, true);
			// Cache should be invalidated twice (before YAML reload and after upsert)
			expect(mockInvalidateDefinitionCache).toHaveBeenCalledTimes(2);
		});

		it('throws BAD_REQUEST when trying to reset a non-builtin type', async () => {
			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			await expect(caller.reset({ agentType: 'custom-agent' })).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});

		it('throws FORBIDDEN when non-superadmin tries to reset', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.reset({ agentType: 'implementation' })).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.reset({ agentType: 'implementation' })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});

	// =====================================================================
	// knownTypes
	// =====================================================================
	describe('knownTypes', () => {
		it('returns all known agent types (public)', async () => {
			mockResolveKnownAgentTypes.mockResolvedValue(['implementation', 'review', 'custom']);

			const caller = createCaller({ user: null, effectiveOrgId: null });
			const result = await caller.knownTypes();

			expect(result).toEqual(['implementation', 'review', 'custom']);
		});
	});

	// =====================================================================
	// schema
	// =====================================================================
	describe('schema', () => {
		it('returns enum arrays for form dropdowns (public)', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			const result = await caller.schema();

			expect(result).toHaveProperty('capabilities');
			expect(result).toHaveProperty('contextStepNames');
			expect(result).toHaveProperty('compactionNames');
			// Verify they're arrays
			expect(Array.isArray(result.capabilities)).toBe(true);
			expect(Array.isArray(result.compactionNames)).toBe(true);
		});
	});
});
