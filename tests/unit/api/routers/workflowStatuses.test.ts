import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDefinition } from '../../../../src/agents/definitions/schema.js';
import { createMockSuperAdmin, createMockUser } from '../../../helpers/factories.js';
import { createCallerFor, expectTRPCError } from '../../../helpers/trpcTestHarness.js';

const {
	mockResolveAgentDefinition,
	mockCreateCustomWorkflowStatusDefinition,
	mockDeleteCustomWorkflowStatusDefinition,
	mockGetCustomWorkflowStatusDefinition,
	mockListCustomWorkflowStatusDefinitions,
	mockUpdateCustomWorkflowStatusDefinition,
} = vi.hoisted(() => ({
	mockResolveAgentDefinition: vi.fn(),
	mockCreateCustomWorkflowStatusDefinition: vi.fn(),
	mockDeleteCustomWorkflowStatusDefinition: vi.fn(),
	mockGetCustomWorkflowStatusDefinition: vi.fn(),
	mockListCustomWorkflowStatusDefinitions: vi.fn(),
	mockUpdateCustomWorkflowStatusDefinition: vi.fn(),
}));

vi.mock('../../../../src/agents/definitions/loader.js', () => ({
	resolveAgentDefinition: mockResolveAgentDefinition,
}));

vi.mock('../../../../src/db/repositories/workflowStatusDefinitionsRepository.js', () => ({
	createCustomWorkflowStatusDefinition: mockCreateCustomWorkflowStatusDefinition,
	deleteCustomWorkflowStatusDefinition: mockDeleteCustomWorkflowStatusDefinition,
	getCustomWorkflowStatusDefinition: mockGetCustomWorkflowStatusDefinition,
	listCustomWorkflowStatusDefinitions: mockListCustomWorkflowStatusDefinitions,
	updateCustomWorkflowStatusDefinition: mockUpdateCustomWorkflowStatusDefinition,
}));

import { workflowStatusesRouter } from '../../../../src/api/routers/workflowStatuses.js';

const createCaller = createCallerFor(workflowStatusesRouter);
const user = createMockUser();
const superAdmin = createMockSuperAdmin();

function mockAgentDefinition(): AgentDefinition {
	return {
		identity: {
			emoji: 'P',
			label: 'PRD',
			roleHint: 'Writes PRDs',
			initialMessage: 'Writing PRD',
		},
		integrations: { required: ['pm'], optional: [] },
		capabilities: {
			required: ['fs:read', 'shell:exec', 'session:ctrl', 'pm:read', 'pm:write'],
			optional: [],
		},
		triggers: [
			{
				event: 'pm:status-changed',
				label: 'Status Changed',
				defaultEnabled: false,
				parameters: [],
			},
		],
		strategies: {},
		hint: 'Write a PRD.',
		prompts: { taskPrompt: 'Write a PRD for <%= it.workItemId %>.' },
		requiredContext: [],
	};
}

function mockAgentDefinitionWithoutStatusTrigger(): AgentDefinition {
	return {
		...mockAgentDefinition(),
		triggers: [],
	};
}

describe('workflowStatusesRouter', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mockListCustomWorkflowStatusDefinitions.mockResolvedValue([]);
		mockGetCustomWorkflowStatusDefinition.mockResolvedValue(null);
		mockResolveAgentDefinition.mockResolvedValue(mockAgentDefinition());
	});

	it('lists builtin statuses and custom statuses', async () => {
		mockListCustomWorkflowStatusDefinitions.mockResolvedValue([
			{
				id: 1,
				key: 'prd',
				label: 'PRD',
				agentType: 'prd',
				sortOrder: 1000,
				createdAt: null,
				updatedAt: null,
			},
		]);

		const caller = createCaller({ user, effectiveOrgId: user.orgId });
		const result = await caller.list();

		expect(result[0]).toMatchObject({ key: 'backlog', isBuiltin: true });
		expect(result).toContainEqual({
			key: 'prd',
			label: 'PRD',
			agentType: 'prd',
			sortOrder: 1000,
			isBuiltin: false,
		});
	});

	it('creates a custom workflow status', async () => {
		mockCreateCustomWorkflowStatusDefinition.mockResolvedValue({
			id: 1,
			key: 'prd',
			label: 'PRD',
			agentType: 'prd',
			sortOrder: 1000,
			createdAt: null,
			updatedAt: null,
		});

		const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });
		await caller.create({ key: 'prd', label: 'PRD', agentType: 'prd', sortOrder: 1000 });

		expect(mockResolveAgentDefinition).toHaveBeenCalledWith('prd');
		expect(mockCreateCustomWorkflowStatusDefinition).toHaveBeenCalledWith({
			key: 'prd',
			label: 'PRD',
			agentType: 'prd',
			sortOrder: 1000,
		});
	});

	it('creates a custom workflow status without a dispatch agent', async () => {
		mockCreateCustomWorkflowStatusDefinition.mockResolvedValue({
			id: 1,
			key: 'qa',
			label: 'QA',
			agentType: null,
			sortOrder: 1000,
			createdAt: null,
			updatedAt: null,
		});

		const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });
		await caller.create({ key: 'qa', label: 'QA', agentType: '' });

		expect(mockResolveAgentDefinition).not.toHaveBeenCalled();
		expect(mockCreateCustomWorkflowStatusDefinition).toHaveBeenCalledWith({
			key: 'qa',
			label: 'QA',
			agentType: null,
		});
	});

	it('rejects builtin key collisions', async () => {
		const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });

		await expectTRPCError(
			caller.create({ key: 'todo', label: 'Todo override', agentType: 'prd' }),
			'CONFLICT',
		);
	});

	it('rejects duplicate custom status keys', async () => {
		mockGetCustomWorkflowStatusDefinition.mockResolvedValue({
			id: 1,
			key: 'prd',
			label: 'PRD',
			agentType: 'prd',
			sortOrder: 1000,
			createdAt: null,
			updatedAt: null,
		});
		const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });

		await expectTRPCError(caller.create({ key: 'prd', label: 'PRD' }), 'CONFLICT');
		expect(mockCreateCustomWorkflowStatusDefinition).not.toHaveBeenCalled();
	});

	it('rejects unknown agent types', async () => {
		mockResolveAgentDefinition.mockRejectedValue(new Error('not found'));
		const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });

		await expectTRPCError(
			caller.create({ key: 'prd', label: 'PRD', agentType: 'missing-agent' }),
			'BAD_REQUEST',
		);
	});

	it('rejects agents that do not support status-changed dispatch on create', async () => {
		mockResolveAgentDefinition.mockResolvedValue(mockAgentDefinitionWithoutStatusTrigger());
		const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });

		await expectTRPCError(
			caller.create({ key: 'prd', label: 'PRD', agentType: 'prd' }),
			'BAD_REQUEST',
		);
		expect(mockCreateCustomWorkflowStatusDefinition).not.toHaveBeenCalled();
	});

	it('rejects mutation from non-superadmin users', async () => {
		const caller = createCaller({ user, effectiveOrgId: user.orgId });

		await expectTRPCError(caller.create({ key: 'prd', label: 'PRD' }), 'FORBIDDEN');
	});

	it('updates a custom workflow status', async () => {
		mockUpdateCustomWorkflowStatusDefinition.mockResolvedValue({
			id: 1,
			key: 'prd',
			label: 'Product Requirements',
			agentType: null,
			sortOrder: 1010,
			createdAt: null,
			updatedAt: null,
		});
		const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });

		const result = await caller.update({
			key: 'prd',
			label: 'Product Requirements',
			agentType: null,
			sortOrder: 1010,
		});

		expect(result.label).toBe('Product Requirements');
		expect(mockUpdateCustomWorkflowStatusDefinition).toHaveBeenCalledWith('prd', {
			label: 'Product Requirements',
			agentType: null,
			sortOrder: 1010,
		});
	});

	it('updates only provided custom workflow status fields', async () => {
		mockUpdateCustomWorkflowStatusDefinition.mockResolvedValue({
			id: 1,
			key: 'prd',
			label: 'PRD',
			agentType: 'prd-v2',
			sortOrder: 1000,
			createdAt: null,
			updatedAt: null,
		});
		const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });

		await caller.update({ key: 'prd', agentType: 'prd-v2' });

		expect(mockUpdateCustomWorkflowStatusDefinition).toHaveBeenCalledWith('prd', {
			agentType: 'prd-v2',
		});
	});

	it('rejects agents that do not support status-changed dispatch on update', async () => {
		mockResolveAgentDefinition.mockResolvedValue(mockAgentDefinitionWithoutStatusTrigger());
		const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });

		await expectTRPCError(caller.update({ key: 'prd', agentType: 'debug' }), 'BAD_REQUEST');
		expect(mockUpdateCustomWorkflowStatusDefinition).not.toHaveBeenCalled();
	});

	it('rejects builtin workflow status updates', async () => {
		const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });

		await expectTRPCError(caller.update({ key: 'todo', label: 'Todo' }), 'FORBIDDEN');
		expect(mockUpdateCustomWorkflowStatusDefinition).not.toHaveBeenCalled();
	});

	it('returns not found when updating a missing custom status', async () => {
		mockUpdateCustomWorkflowStatusDefinition.mockResolvedValue(null);
		const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });

		await expectTRPCError(caller.update({ key: 'prd', label: 'PRD' }), 'NOT_FOUND');
	});

	it('deletes a custom workflow status', async () => {
		mockDeleteCustomWorkflowStatusDefinition.mockResolvedValue(true);
		const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });

		await expect(caller.delete({ key: 'prd' })).resolves.toEqual({ key: 'prd' });
	});

	it('rejects builtin workflow status deletes', async () => {
		const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });

		await expectTRPCError(caller.delete({ key: 'todo' }), 'FORBIDDEN');
		expect(mockDeleteCustomWorkflowStatusDefinition).not.toHaveBeenCalled();
	});

	it('returns not found when deleting a missing custom status', async () => {
		mockDeleteCustomWorkflowStatusDefinition.mockResolvedValue(false);
		const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });

		await expectTRPCError(caller.delete({ key: 'prd' }), 'NOT_FOUND');
	});
});
