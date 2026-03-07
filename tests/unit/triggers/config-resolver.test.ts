import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks before any imports
const { mockResolveAgentDefinition, mockGetTriggerConfig, mockGetTriggerConfigsByProjectAndAgent } =
	vi.hoisted(() => ({
		mockResolveAgentDefinition: vi.fn(),
		mockGetTriggerConfig: vi.fn(),
		mockGetTriggerConfigsByProjectAndAgent: vi.fn(),
	}));

vi.mock('../../../src/agents/definitions/index.js', () => ({
	resolveAgentDefinition: mockResolveAgentDefinition,
}));

vi.mock('../../../src/db/repositories/agentTriggerConfigsRepository.js', () => ({
	getTriggerConfig: mockGetTriggerConfig,
	getTriggerConfigsByProjectAndAgent: mockGetTriggerConfigsByProjectAndAgent,
}));

import {
	getResolvedTriggerConfig,
	getTriggerParameters,
	isTriggerEnabled,
	resolveTriggerConfigs,
} from '../../../src/triggers/config-resolver.js';

const PROJECT_ID = 'project-1';
const AGENT_TYPE = 'implementation';
const TRIGGER_EVENT = 'pm:status-changed';

function makeDefinition(overrides: Record<string, unknown> = {}) {
	return {
		triggers: [
			{
				event: TRIGGER_EVENT,
				label: 'Status Changed',
				description: 'Triggered when status changes',
				defaultEnabled: true,
				parameters: [
					{ name: 'targetList', defaultValue: 'todo' },
					{ name: 'authorMode', defaultValue: 'own' },
				],
				providers: ['trello'],
			},
			{
				event: 'pm:label-added',
				label: 'Label Added',
				defaultEnabled: false,
				parameters: [],
			},
		],
		...overrides,
	};
}

function makeDbConfig(overrides: Record<string, unknown> = {}) {
	return {
		id: 'config-1',
		projectId: PROJECT_ID,
		agentType: AGENT_TYPE,
		triggerEvent: TRIGGER_EVENT,
		enabled: true,
		parameters: {},
		...overrides,
	};
}

describe('resolveTriggerConfigs', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('returns empty array when agent definition is not found', async () => {
		mockResolveAgentDefinition.mockResolvedValue(null);
		const result = await resolveTriggerConfigs(PROJECT_ID, AGENT_TYPE);
		expect(result).toEqual([]);
	});

	it('returns empty array when agent has no triggers', async () => {
		mockResolveAgentDefinition.mockResolvedValue({ triggers: [] });
		mockGetTriggerConfigsByProjectAndAgent.mockResolvedValue([]);
		const result = await resolveTriggerConfigs(PROJECT_ID, AGENT_TYPE);
		expect(result).toEqual([]);
	});

	it('returns definition defaults when no DB overrides exist', async () => {
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());
		mockGetTriggerConfigsByProjectAndAgent.mockResolvedValue([]);

		const result = await resolveTriggerConfigs(PROJECT_ID, AGENT_TYPE);

		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({
			event: TRIGGER_EVENT,
			label: 'Status Changed',
			enabled: true,
			parameters: { targetList: 'todo', authorMode: 'own' },
			isCustomized: false,
		});
		expect(result[1]).toMatchObject({
			event: 'pm:label-added',
			enabled: false,
			isCustomized: false,
		});
	});

	it('merges DB override with definition defaults', async () => {
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());
		mockGetTriggerConfigsByProjectAndAgent.mockResolvedValue([
			makeDbConfig({ enabled: false, parameters: { authorMode: 'external' } }),
		]);

		const result = await resolveTriggerConfigs(PROJECT_ID, AGENT_TYPE);

		expect(result[0]).toMatchObject({
			event: TRIGGER_EVENT,
			enabled: false,
			parameters: { targetList: 'todo', authorMode: 'external' },
			isCustomized: true,
		});
	});

	it('marks triggers with DB overrides as isCustomized=true', async () => {
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());
		mockGetTriggerConfigsByProjectAndAgent.mockResolvedValue([makeDbConfig()]);

		const result = await resolveTriggerConfigs(PROJECT_ID, AGENT_TYPE);

		expect(result[0].isCustomized).toBe(true);
		expect(result[1].isCustomized).toBe(false);
	});

	it('includes providers from definition', async () => {
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());
		mockGetTriggerConfigsByProjectAndAgent.mockResolvedValue([]);

		const result = await resolveTriggerConfigs(PROJECT_ID, AGENT_TYPE);

		expect(result[0].providers).toEqual(['trello']);
	});
});

describe('isTriggerEnabled', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('returns DB override enabled value when config exists', async () => {
		mockGetTriggerConfig.mockResolvedValue(makeDbConfig({ enabled: false }));

		const result = await isTriggerEnabled(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT);

		expect(result).toBe(false);
		// Should not call resolveAgentDefinition since DB config is used
		expect(mockResolveAgentDefinition).not.toHaveBeenCalled();
	});

	it('falls back to definition default when no DB config', async () => {
		mockGetTriggerConfig.mockResolvedValue(null);
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());

		const result = await isTriggerEnabled(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT);

		expect(result).toBe(true);
	});

	it('returns false when agent definition not found', async () => {
		mockGetTriggerConfig.mockResolvedValue(null);
		mockResolveAgentDefinition.mockResolvedValue(null);

		const result = await isTriggerEnabled(PROJECT_ID, 'unknown-agent', TRIGGER_EVENT);

		expect(result).toBe(false);
	});

	it('returns false for unknown trigger event not in definition', async () => {
		mockGetTriggerConfig.mockResolvedValue(null);
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());

		const result = await isTriggerEnabled(PROJECT_ID, AGENT_TYPE, 'scm:unknown-event');

		expect(result).toBe(false);
	});

	it('returns defaultEnabled=false from definition when trigger is disabled by default', async () => {
		mockGetTriggerConfig.mockResolvedValue(null);
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());

		const result = await isTriggerEnabled(PROJECT_ID, AGENT_TYPE, 'pm:label-added');

		expect(result).toBe(false);
	});
});

describe('getTriggerParameters', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('returns empty object when agent definition not found', async () => {
		mockResolveAgentDefinition.mockResolvedValue(null);
		mockGetTriggerConfig.mockResolvedValue(null);

		const result = await getTriggerParameters(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT);

		expect(result).toEqual({});
	});

	it('returns empty object for unknown trigger event', async () => {
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());
		mockGetTriggerConfig.mockResolvedValue(null);

		const result = await getTriggerParameters(PROJECT_ID, AGENT_TYPE, 'scm:unknown');

		expect(result).toEqual({});
	});

	it('returns default parameters when no DB override', async () => {
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());
		mockGetTriggerConfig.mockResolvedValue(null);

		const result = await getTriggerParameters(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT);

		expect(result).toEqual({ targetList: 'todo', authorMode: 'own' });
	});

	it('merges DB override parameters with defaults (DB takes precedence)', async () => {
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());
		mockGetTriggerConfig.mockResolvedValue(
			makeDbConfig({ parameters: { authorMode: 'external', extraParam: 'value' } }),
		);

		const result = await getTriggerParameters(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT);

		expect(result).toEqual({
			targetList: 'todo',
			authorMode: 'external',
			extraParam: 'value',
		});
	});

	it('ignores parameters without defaultValue', async () => {
		mockResolveAgentDefinition.mockResolvedValue({
			triggers: [
				{
					event: TRIGGER_EVENT,
					label: 'Test',
					defaultEnabled: true,
					parameters: [{ name: 'withDefault', defaultValue: 'yes' }, { name: 'noDefault' }],
				},
			],
		});
		mockGetTriggerConfig.mockResolvedValue(null);

		const result = await getTriggerParameters(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT);

		expect(result).toEqual({ withDefault: 'yes' });
	});
});

describe('getResolvedTriggerConfig', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('returns null when agent definition not found', async () => {
		mockResolveAgentDefinition.mockResolvedValue(null);

		const result = await getResolvedTriggerConfig(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT);

		expect(result).toBeNull();
	});

	it('returns null when trigger event not in definition', async () => {
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());
		mockGetTriggerConfig.mockResolvedValue(null);

		const result = await getResolvedTriggerConfig(PROJECT_ID, AGENT_TYPE, 'scm:unknown');

		expect(result).toBeNull();
	});

	it('returns merged config for known trigger without DB override', async () => {
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());
		mockGetTriggerConfig.mockResolvedValue(null);

		const result = await getResolvedTriggerConfig(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT);

		expect(result).not.toBeNull();
		expect(result).toMatchObject({
			event: TRIGGER_EVENT,
			label: 'Status Changed',
			enabled: true,
			parameters: { targetList: 'todo', authorMode: 'own' },
			isCustomized: false,
		});
	});

	it('returns merged config with DB override applied', async () => {
		mockResolveAgentDefinition.mockResolvedValue(makeDefinition());
		mockGetTriggerConfig.mockResolvedValue(makeDbConfig({ enabled: false, parameters: {} }));

		const result = await getResolvedTriggerConfig(PROJECT_ID, AGENT_TYPE, TRIGGER_EVENT);

		expect(result).not.toBeNull();
		expect(result?.enabled).toBe(false);
		expect(result?.isCustomized).toBe(true);
	});
});
