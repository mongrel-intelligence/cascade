import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';
import { createMockUser } from '../../../helpers/factories.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockListAgentDefinitions = vi.fn();
const mockGetTriggerConfigsByProject = vi.fn();
const mockListProjectIntegrations = vi.fn();
const mockGetKnownAgentTypes = vi.fn();
const mockLoadAgentDefinition = vi.fn();

vi.mock('../../../../src/db/repositories/agentDefinitionsRepository.js', () => ({
	listAgentDefinitions: (...args: unknown[]) => mockListAgentDefinitions(...args),
}));

vi.mock('../../../../src/db/repositories/agentTriggerConfigsRepository.js', () => ({
	getTriggerConfigById: vi.fn(),
	getTriggerConfig: vi.fn(),
	getTriggerConfigsByProject: (...args: unknown[]) => mockGetTriggerConfigsByProject(...args),
	getTriggerConfigsByProjectAndAgent: vi.fn(),
	upsertTriggerConfig: vi.fn(),
	updateTriggerConfig: vi.fn(),
	deleteTriggerConfig: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/settingsRepository.js', () => ({
	listProjectIntegrations: (...args: unknown[]) => mockListProjectIntegrations(...args),
}));

vi.mock('../../../../src/agents/definitions/loader.js', () => ({
	getKnownAgentTypes: (...args: unknown[]) => mockGetKnownAgentTypes(...args),
	loadAgentDefinition: (...args: unknown[]) => mockLoadAgentDefinition(...args),
}));

const mockVerifyProjectOrgAccess = vi.fn();

vi.mock('../../../../src/api/routers/_shared/projectAccess.js', () => ({
	verifyProjectOrgAccess: (...args: unknown[]) => mockVerifyProjectOrgAccess(...args),
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { agentTriggerConfigsRouter } from '../../../../src/api/routers/agentTriggerConfigs.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCaller(ctx: TRPCContext) {
	return agentTriggerConfigsRouter.createCaller(ctx);
}

const mockUser = createMockUser();
const mockCtx: TRPCContext = { user: mockUser, effectiveOrgId: mockUser.orgId };

function makeAgentDefinition(overrides: Record<string, unknown> = {}) {
	return {
		triggers: [
			{
				event: 'pm:status-changed',
				label: 'Status Changed',
				description: 'When card moves',
				providers: ['trello'],
				defaultEnabled: false,
				parameters: [],
			},
		],
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agentTriggerConfigsRouter — getProjectTriggersView', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockVerifyProjectOrgAccess.mockResolvedValue(undefined);
		mockGetTriggerConfigsByProject.mockResolvedValue([]);
		mockListProjectIntegrations.mockResolvedValue([]);
		mockListAgentDefinitions.mockResolvedValue([]);
		mockGetKnownAgentTypes.mockReturnValue([]);
		mockLoadAgentDefinition.mockReturnValue(makeAgentDefinition());
	});

	it('throws UNAUTHORIZED when not authenticated', async () => {
		const caller = createCaller({ user: null, effectiveOrgId: null });
		await expect(
			caller.getProjectTriggersView({ projectId: 'test-project' }),
		).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
	});

	it('returns empty agents and null integrations when nothing is configured', async () => {
		const caller = createCaller(mockCtx);
		const result = await caller.getProjectTriggersView({ projectId: 'test-project' });

		expect(result.agents).toEqual([]);
		expect(result.integrations).toEqual({ pm: null, scm: null });
	});

	it('merges DB definitions with project trigger configs', async () => {
		const definition = makeAgentDefinition();
		mockListAgentDefinitions.mockResolvedValue([{ agentType: 'implementation', definition }]);
		mockGetTriggerConfigsByProject.mockResolvedValue([
			{
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
				enabled: true,
				parameters: {},
			},
		]);

		const caller = createCaller(mockCtx);
		const result = await caller.getProjectTriggersView({ projectId: 'test-project' });

		expect(result.agents).toHaveLength(1);
		expect(result.agents[0].agentType).toBe('implementation');
		expect(result.agents[0].triggers[0].event).toBe('pm:status-changed');
		expect(result.agents[0].triggers[0].enabled).toBe(true);
		expect(result.agents[0].triggers[0].isCustomized).toBe(true);
	});

	it('uses defaultEnabled when no config exists (isCustomized=false)', async () => {
		const definition = makeAgentDefinition();
		mockListAgentDefinitions.mockResolvedValue([{ agentType: 'implementation', definition }]);
		// No trigger configs

		const caller = createCaller(mockCtx);
		const result = await caller.getProjectTriggersView({ projectId: 'test-project' });

		expect(result.agents[0].triggers[0].enabled).toBe(false); // defaultEnabled
		expect(result.agents[0].triggers[0].isCustomized).toBe(false);
	});

	it('merges parameter values — configured value overrides default', async () => {
		const definitionWithParams = makeAgentDefinition({
			triggers: [
				{
					event: 'scm:check-suite-success',
					label: 'CI Passed',
					description: null,
					providers: ['github'],
					defaultEnabled: false,
					parameters: [
						{
							name: 'authorMode',
							type: 'select',
							label: 'Author Mode',
							description: 'Which PRs to review',
							required: false,
							defaultValue: 'own',
							options: ['own', 'external', 'all'],
						},
					],
				},
			],
		});

		mockListAgentDefinitions.mockResolvedValue([
			{ agentType: 'review', definition: definitionWithParams },
		]);
		mockGetTriggerConfigsByProject.mockResolvedValue([
			{
				agentType: 'review',
				triggerEvent: 'scm:check-suite-success',
				enabled: true,
				parameters: { authorMode: 'external' },
			},
		]);

		const caller = createCaller(mockCtx);
		const result = await caller.getProjectTriggersView({ projectId: 'test-project' });

		const trigger = result.agents[0].triggers[0];
		expect(trigger.parameters.authorMode).toBe('external');
		expect(trigger.parameterDefs).toHaveLength(1);
		expect(trigger.parameterDefs[0].defaultValue).toBe('own');
	});

	it('uses parameter default when config has no value', async () => {
		const definitionWithParams = makeAgentDefinition({
			triggers: [
				{
					event: 'scm:check-suite-success',
					label: 'CI Passed',
					description: null,
					providers: ['github'],
					defaultEnabled: false,
					parameters: [
						{
							name: 'authorMode',
							type: 'select',
							label: 'Author Mode',
							description: null,
							required: false,
							defaultValue: 'own',
							options: ['own', 'external'],
						},
					],
				},
			],
		});

		mockListAgentDefinitions.mockResolvedValue([
			{ agentType: 'review', definition: definitionWithParams },
		]);
		mockGetTriggerConfigsByProject.mockResolvedValue([
			{
				agentType: 'review',
				triggerEvent: 'scm:check-suite-success',
				enabled: true,
				parameters: {}, // no authorMode set
			},
		]);

		const caller = createCaller(mockCtx);
		const result = await caller.getProjectTriggersView({ projectId: 'test-project' });

		const trigger = result.agents[0].triggers[0];
		expect(trigger.parameters.authorMode).toBe('own'); // default value
	});

	it('builds integrations map from project integrations (pm + scm)', async () => {
		mockListProjectIntegrations.mockResolvedValue([
			{ category: 'pm', provider: 'trello' },
			{ category: 'scm', provider: 'github' },
		]);

		const caller = createCaller(mockCtx);
		const result = await caller.getProjectTriggersView({ projectId: 'test-project' });

		expect(result.integrations.pm).toBe('trello');
		expect(result.integrations.scm).toBe('github');
	});

	it('builds integrations map with only pm integration', async () => {
		mockListProjectIntegrations.mockResolvedValue([{ category: 'pm', provider: 'jira' }]);

		const caller = createCaller(mockCtx);
		const result = await caller.getProjectTriggersView({ projectId: 'test-project' });

		expect(result.integrations.pm).toBe('jira');
		expect(result.integrations.scm).toBeNull();
	});

	it('is resilient to DB failure when loading agent definitions', async () => {
		mockListAgentDefinitions.mockRejectedValue(new Error('DB connection failed'));
		// Falls back to YAML — need some types for that
		mockGetKnownAgentTypes.mockReturnValue(['implementation']);
		mockLoadAgentDefinition.mockReturnValue(makeAgentDefinition());

		const caller = createCaller(mockCtx);
		const result = await caller.getProjectTriggersView({ projectId: 'test-project' });

		// Should not throw; falls back to YAML
		expect(result.agents).toHaveLength(1);
		expect(result.agents[0].agentType).toBe('implementation');
	});

	it('skips YAML definitions when DB already has that agent type', async () => {
		const definition = makeAgentDefinition();
		mockListAgentDefinitions.mockResolvedValue([{ agentType: 'implementation', definition }]);
		// YAML also has 'implementation'
		mockGetKnownAgentTypes.mockReturnValue(['implementation']);

		const caller = createCaller(mockCtx);
		const result = await caller.getProjectTriggersView({ projectId: 'test-project' });

		// Should only have one entry (DB takes precedence, YAML skipped)
		expect(result.agents).toHaveLength(1);
	});

	it('includes YAML-only agents not in DB', async () => {
		mockListAgentDefinitions.mockResolvedValue([]); // no DB definitions
		mockGetKnownAgentTypes.mockReturnValue(['splitting', 'planning']);
		mockLoadAgentDefinition.mockReturnValue(makeAgentDefinition());

		const caller = createCaller(mockCtx);
		const result = await caller.getProjectTriggersView({ projectId: 'test-project' });

		expect(result.agents).toHaveLength(2);
		expect(result.agents.map((a) => a.agentType)).toContain('splitting');
		expect(result.agents.map((a) => a.agentType)).toContain('planning');
	});

	it('handles YAML load failure gracefully (skips that agent)', async () => {
		mockGetKnownAgentTypes.mockReturnValue(['implementation', 'failing-agent']);
		mockLoadAgentDefinition
			.mockReturnValueOnce(makeAgentDefinition())
			.mockImplementationOnce(() => {
				throw new Error('YAML parse error');
			});

		const caller = createCaller(mockCtx);
		const result = await caller.getProjectTriggersView({ projectId: 'test-project' });

		// 'failing-agent' should be skipped; 'implementation' included
		expect(result.agents).toHaveLength(1);
		expect(result.agents[0].agentType).toBe('implementation');
	});

	it('includes parameterDefs with all fields mapped correctly', async () => {
		const definition = {
			triggers: [
				{
					event: 'pm:status-changed',
					label: 'Status Changed',
					description: 'When status changes',
					providers: null,
					defaultEnabled: true,
					parameters: [
						{
							name: 'myParam',
							type: 'string',
							label: 'My Param',
							description: 'A parameter',
							required: true,
							defaultValue: 'foo',
							options: ['foo', 'bar'],
						},
					],
				},
			],
		};
		mockListAgentDefinitions.mockResolvedValue([{ agentType: 'implementation', definition }]);

		const caller = createCaller(mockCtx);
		const result = await caller.getProjectTriggersView({ projectId: 'test-project' });

		const paramDef = result.agents[0].triggers[0].parameterDefs[0];
		expect(paramDef.name).toBe('myParam');
		expect(paramDef.type).toBe('string');
		expect(paramDef.label).toBe('My Param');
		expect(paramDef.description).toBe('A parameter');
		expect(paramDef.required).toBe(true);
		expect(paramDef.defaultValue).toBe('foo');
		expect(paramDef.options).toEqual(['foo', 'bar']);
	});

	it('handles trigger with no parameters (empty parameterDefs and parameters)', async () => {
		const definition = makeAgentDefinition();
		mockListAgentDefinitions.mockResolvedValue([{ agentType: 'implementation', definition }]);

		const caller = createCaller(mockCtx);
		const result = await caller.getProjectTriggersView({ projectId: 'test-project' });

		const trigger = result.agents[0].triggers[0];
		expect(trigger.parameterDefs).toEqual([]);
		expect(trigger.parameters).toEqual({});
	});
});
