import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDefinition } from '../../../../src/agents/definitions/schema.js';
import type { TRPCContext } from '../../../../src/api/trpc.js';
import { createMockSuperAdmin, createMockUser } from '../../../helpers/factories.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetKnownAgentTypes = vi.fn<() => string[]>();
const mockIsBuiltinAgentType = vi.fn<(agentType: string) => boolean>();
const mockInvalidateDefinitionCache = vi.fn();
const mockLoadAgentDefinition = vi.fn<(agentType: string) => AgentDefinition>();
const mockResolveAgentDefinition = vi.fn<(agentType: string) => Promise<AgentDefinition>>();
const mockResolveKnownAgentTypes = vi.fn<() => Promise<string[]>>();

vi.mock('../../../../src/agents/definitions/loader.js', () => ({
	getKnownAgentTypes: (...args: unknown[]) => mockGetKnownAgentTypes(...(args as [])),
	isBuiltinAgentType: (...args: unknown[]) => mockIsBuiltinAgentType(...(args as [string])),
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

const mockGetRawTemplate = vi.fn<(agentType: string) => string>();
const mockValidateTemplate = vi.fn();
const mockLoadPartials = vi.fn();

vi.mock('../../../../src/agents/prompts/index.js', () => ({
	getRawTemplate: (...args: unknown[]) => mockGetRawTemplate(...(args as [string])),
	validateTemplate: (...args: unknown[]) => mockValidateTemplate(...args),
}));

vi.mock('../../../../src/db/repositories/partialsRepository.js', () => ({
	loadPartials: (...args: unknown[]) => mockLoadPartials(...args),
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
		strategies: {},
		hint: 'A test agent',
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
		mockIsBuiltinAgentType.mockImplementation((agentType: string) =>
			['implementation', 'review'].includes(agentType),
		);
		mockValidateTemplate.mockReturnValue({ valid: true });
		mockLoadPartials.mockResolvedValue(new Map());
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

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
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

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
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

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
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

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
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

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
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

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			const result = await caller.get({ agentType: 'custom-agent' });

			expect(result.isBuiltin).toBe(false);
		});

		it('throws NOT_FOUND when definition does not exist', async () => {
			mockResolveAgentDefinition.mockRejectedValue(new Error('not found'));

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
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
	// getPrompt
	// =====================================================================
	describe('getPrompt', () => {
		it('returns system and task prompts for an existing definition', async () => {
			const def = createMockDefinition({
				prompts: {
					taskPrompt: 'Do the task <%= it.cardId %>',
					systemPrompt: 'You are a helpful agent.',
				},
			});
			mockResolveAgentDefinition.mockResolvedValue(def);

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			const result = await caller.getPrompt({ agentType: 'implementation' });

			expect(result.agentType).toBe('implementation');
			expect(result.systemPrompt).toBe('You are a helpful agent.');
			expect(result.taskPrompt).toBe('Do the task <%= it.cardId %>');
		});

		it('returns null for prompts that are not set', async () => {
			const def = createMockDefinition({ prompts: { taskPrompt: 'task only' } });
			mockResolveAgentDefinition.mockResolvedValue(def);

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			const result = await caller.getPrompt({ agentType: 'implementation' });

			expect(result.systemPrompt).toBeNull();
		});

		it('throws NOT_FOUND when definition does not exist', async () => {
			mockResolveAgentDefinition.mockRejectedValue(new Error('not found'));

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			await expect(caller.getPrompt({ agentType: 'missing' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws FORBIDDEN for non-superadmin', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.getPrompt({ agentType: 'implementation' })).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
		});
	});

	// =====================================================================
	// updatePrompt
	// =====================================================================
	describe('updatePrompt', () => {
		it('updates system prompt and preserves existing task prompt', async () => {
			const current = createMockDefinition({
				prompts: { taskPrompt: 'existing task', systemPrompt: 'old system' },
			});
			mockResolveAgentDefinition.mockResolvedValue(current);
			mockUpsertAgentDefinition.mockResolvedValue(undefined);

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			const result = await caller.updatePrompt({
				agentType: 'implementation',
				systemPrompt: 'new system prompt',
			});

			expect(result).toEqual({ agentType: 'implementation' });
			expect(mockUpsertAgentDefinition).toHaveBeenCalledWith(
				'implementation',
				expect.objectContaining({
					prompts: expect.objectContaining({ systemPrompt: 'new system prompt' }),
				}),
				true,
			);
		});

		it('clears system prompt when null is passed', async () => {
			const current = createMockDefinition({
				prompts: { taskPrompt: 'task', systemPrompt: 'to be cleared' },
			});
			mockResolveAgentDefinition.mockResolvedValue(current);
			mockUpsertAgentDefinition.mockResolvedValue(undefined);

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			await caller.updatePrompt({ agentType: 'implementation', systemPrompt: null });

			expect(mockUpsertAgentDefinition).toHaveBeenCalledWith(
				'implementation',
				expect.objectContaining({
					prompts: expect.objectContaining({ systemPrompt: undefined }),
				}),
				true,
			);
		});

		it('validates systemPrompt template before saving', async () => {
			mockValidateTemplate.mockReturnValue({ valid: false, error: 'bad syntax' });
			mockLoadPartials.mockResolvedValue(new Map());

			const current = createMockDefinition();
			mockResolveAgentDefinition.mockResolvedValue(current);

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			await expect(
				caller.updatePrompt({ agentType: 'implementation', systemPrompt: '<% bad %>' }),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		});

		it('throws NOT_FOUND when definition does not exist', async () => {
			mockResolveAgentDefinition.mockRejectedValue(new Error('not found'));

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			await expect(
				caller.updatePrompt({ agentType: 'missing', systemPrompt: 'x' }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});

		it('throws FORBIDDEN for non-superadmin', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.updatePrompt({ agentType: 'implementation', systemPrompt: 'x' }),
			).rejects.toMatchObject({ code: 'FORBIDDEN' });
		});
	});

	// =====================================================================
	// resetPrompt
	// =====================================================================
	describe('resetPrompt', () => {
		it('restores system prompt from .eta file when YAML has none', async () => {
			const current = createMockDefinition({
				prompts: { taskPrompt: 'custom task', systemPrompt: 'custom system' },
			});
			mockResolveAgentDefinition.mockResolvedValue(current);
			const yamlDef = createMockDefinition({ prompts: { taskPrompt: 'yaml task' } });
			mockLoadAgentDefinition.mockReturnValue(yamlDef);
			mockGetRawTemplate.mockReturnValue('## System prompt from .eta');
			mockUpsertAgentDefinition.mockResolvedValue(undefined);

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			const result = await caller.resetPrompt({ agentType: 'implementation' });

			expect(result).toEqual({ agentType: 'implementation' });
			expect(mockUpsertAgentDefinition).toHaveBeenCalledWith(
				'implementation',
				expect.objectContaining({
					prompts: expect.objectContaining({
						taskPrompt: 'yaml task',
						systemPrompt: '## System prompt from .eta',
					}),
				}),
				true,
			);
		});

		it('uses systemPrompt from YAML if present (does not call getRawTemplate)', async () => {
			const current = createMockDefinition();
			mockResolveAgentDefinition.mockResolvedValue(current);
			const yamlDef = createMockDefinition({
				prompts: { taskPrompt: 'yaml task', systemPrompt: 'yaml system' },
			});
			mockLoadAgentDefinition.mockReturnValue(yamlDef);
			mockUpsertAgentDefinition.mockResolvedValue(undefined);

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			await caller.resetPrompt({ agentType: 'implementation' });

			expect(mockGetRawTemplate).not.toHaveBeenCalled();
			expect(mockUpsertAgentDefinition).toHaveBeenCalledWith(
				'implementation',
				expect.objectContaining({
					prompts: expect.objectContaining({ systemPrompt: 'yaml system' }),
				}),
				true,
			);
		});

		it('leaves systemPrompt undefined when YAML and .eta both absent', async () => {
			const current = createMockDefinition();
			mockResolveAgentDefinition.mockResolvedValue(current);
			const yamlDef = createMockDefinition({ prompts: { taskPrompt: 'yaml task' } });
			mockLoadAgentDefinition.mockReturnValue(yamlDef);
			mockGetRawTemplate.mockImplementation(() => {
				throw new Error('no .eta file');
			});
			mockUpsertAgentDefinition.mockResolvedValue(undefined);

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			await caller.resetPrompt({ agentType: 'implementation' });

			expect(mockUpsertAgentDefinition).toHaveBeenCalledWith(
				'implementation',
				expect.objectContaining({
					prompts: expect.objectContaining({ systemPrompt: undefined }),
				}),
				true,
			);
		});

		it('throws NOT_FOUND when definition does not exist', async () => {
			mockResolveAgentDefinition.mockRejectedValue(new Error('not found'));

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			await expect(caller.resetPrompt({ agentType: 'missing' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws NOT_FOUND when YAML default does not exist', async () => {
			const current = createMockDefinition();
			mockResolveAgentDefinition.mockResolvedValue(current);
			mockLoadAgentDefinition.mockImplementation(() => {
				throw new Error('yaml not found');
			});

			// 'implementation' is in knownAgentTypes so it's a valid builtin
			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			await expect(caller.resetPrompt({ agentType: 'implementation' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws FORBIDDEN for non-superadmin', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.resetPrompt({ agentType: 'implementation' })).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.resetPrompt({ agentType: 'implementation' })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});

		it('invalidates cache after reset', async () => {
			const current = createMockDefinition();
			mockResolveAgentDefinition.mockResolvedValue(current);
			const yamlDef = createMockDefinition({ prompts: { taskPrompt: 'yaml task' } });
			mockLoadAgentDefinition.mockReturnValue(yamlDef);
			mockGetRawTemplate.mockReturnValue('system prompt');
			mockUpsertAgentDefinition.mockResolvedValue(undefined);

			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });
			await caller.resetPrompt({ agentType: 'implementation' });

			expect(mockInvalidateDefinitionCache).toHaveBeenCalled();
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
			expect(result).toHaveProperty('triggerRegistry');
			// Verify they're arrays/objects
			expect(Array.isArray(result.capabilities)).toBe(true);
			expect(typeof result.triggerRegistry).toBe('object');
		});
	});
});
