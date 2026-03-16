/**
 * Integration tests: Trigger Config Resolver
 *
 * Tests the full resolution chain for trigger configurations:
 *   definition defaults → DB overrides → merged output
 *
 * Functions tested:
 *   - isTriggerEnabled()
 *   - getTriggerParameters()
 *   - resolveTriggerConfigs()
 *   - getResolvedTriggerConfig()
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearDefinitionCache } from '../../src/agents/definitions/loader.js';
import type { AgentDefinition } from '../../src/agents/definitions/schema.js';
import {
	getResolvedTriggerConfig,
	getTriggerParameters,
	isTriggerEnabled,
	resolveTriggerConfigs,
} from '../../src/triggers/config-resolver.js';
import { truncateAll } from './helpers/db.js';
import {
	seedAgentConfig,
	seedAgentDefinition,
	seedOrg,
	seedProject,
	seedTriggerConfig,
} from './helpers/seed.js';

// ============================================================================
// Test fixtures
// ============================================================================

const PROJECT_ID = 'test-project';
const AGENT_TYPE = 'test-resolver-agent';

/** A definition with two triggers, one enabled and one disabled by default */
const AGENT_DEFINITION_WITH_TRIGGERS: Partial<AgentDefinition> = {
	triggers: [
		{
			event: 'pm:status-changed',
			label: 'Status Changed',
			description: 'Fires when a work item status changes',
			defaultEnabled: true,
			parameters: [
				{
					name: 'authorMode',
					type: 'select',
					label: 'Author Mode',
					description: 'Which author PRs to review',
					required: false,
					defaultValue: 'own',
					options: ['own', 'external'],
				},
			],
		},
		{
			event: 'scm:check-suite-success',
			label: 'CI Passed',
			description: 'Fires when CI checks pass',
			defaultEnabled: false,
			parameters: [],
		},
	],
};

/** A definition with no triggers */
const AGENT_DEFINITION_NO_TRIGGERS: Partial<AgentDefinition> = {
	triggers: [],
};

// ============================================================================
// Setup
// ============================================================================

beforeAll(async () => {
	await truncateAll();
});

beforeEach(async () => {
	await truncateAll();
	clearDefinitionCache();
	await seedOrg();
	await seedProject();
});

// ============================================================================
// isTriggerEnabled
// ============================================================================

describe('isTriggerEnabled()', () => {
	it('returns definition default (true) when no DB override exists', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });

		const enabled = await isTriggerEnabled(PROJECT_ID, AGENT_TYPE, 'pm:status-changed');
		expect(enabled).toBe(true);
	});

	it('returns definition default (false) when no DB override exists', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });

		const enabled = await isTriggerEnabled(PROJECT_ID, AGENT_TYPE, 'scm:check-suite-success');
		expect(enabled).toBe(false);
	});

	it('returns DB override (false) when definition default is true', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });
		await seedTriggerConfig({
			projectId: PROJECT_ID,
			agentType: AGENT_TYPE,
			triggerEvent: 'pm:status-changed',
			enabled: false,
		});

		const enabled = await isTriggerEnabled(PROJECT_ID, AGENT_TYPE, 'pm:status-changed');
		expect(enabled).toBe(false);
	});

	it('returns DB override (true) when definition default is false', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });
		await seedTriggerConfig({
			projectId: PROJECT_ID,
			agentType: AGENT_TYPE,
			triggerEvent: 'scm:check-suite-success',
			enabled: true,
		});

		const enabled = await isTriggerEnabled(PROJECT_ID, AGENT_TYPE, 'scm:check-suite-success');
		expect(enabled).toBe(true);
	});

	it('returns false when agent is not enabled for project (no agent_config row)', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		// No seedAgentConfig() call — agent not enabled for this project

		const enabled = await isTriggerEnabled(PROJECT_ID, AGENT_TYPE, 'pm:status-changed');
		expect(enabled).toBe(false);
	});

	it('returns false for unknown agent type', async () => {
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });

		const enabled = await isTriggerEnabled(PROJECT_ID, 'nonexistent-agent', 'pm:status-changed');
		expect(enabled).toBe(false);
	});

	it('returns false for unknown trigger event on a known agent', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });

		const enabled = await isTriggerEnabled(PROJECT_ID, AGENT_TYPE, 'pm:unknown-event');
		expect(enabled).toBe(false);
	});
});

// ============================================================================
// getTriggerParameters
// ============================================================================

describe('getTriggerParameters()', () => {
	it('returns definition default parameters when no DB override exists', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });

		const params = await getTriggerParameters(PROJECT_ID, AGENT_TYPE, 'pm:status-changed');
		expect(params).toEqual({ authorMode: 'own' });
	});

	it('returns empty object when trigger has no parameters', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });

		const params = await getTriggerParameters(PROJECT_ID, AGENT_TYPE, 'scm:check-suite-success');
		expect(params).toEqual({});
	});

	it('returns DB override parameters (DB wins over definition default)', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });
		await seedTriggerConfig({
			projectId: PROJECT_ID,
			agentType: AGENT_TYPE,
			triggerEvent: 'pm:status-changed',
			enabled: true,
			parameters: { authorMode: 'external' },
		});

		const params = await getTriggerParameters(PROJECT_ID, AGENT_TYPE, 'pm:status-changed');
		expect(params).toEqual({ authorMode: 'external' });
	});

	it('merges definition defaults with DB overrides (DB wins on conflicts, both keys included)', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });
		await seedTriggerConfig({
			projectId: PROJECT_ID,
			agentType: AGENT_TYPE,
			triggerEvent: 'pm:status-changed',
			enabled: true,
			// DB adds a new key `threshold` while also overriding `authorMode`
			parameters: { authorMode: 'external', threshold: 0.5 },
		});

		const params = await getTriggerParameters(PROJECT_ID, AGENT_TYPE, 'pm:status-changed');
		// definition default `authorMode: 'own'` is overridden by DB `authorMode: 'external'`
		// DB-only key `threshold: 0.5` is included in the merge
		expect(params).toEqual({ authorMode: 'external', threshold: 0.5 });
	});

	it('returns empty object when agent is not enabled for project', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		// No seedAgentConfig() call

		const params = await getTriggerParameters(PROJECT_ID, AGENT_TYPE, 'pm:status-changed');
		expect(params).toEqual({});
	});

	it('returns empty object for unknown agent type', async () => {
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });

		const params = await getTriggerParameters(PROJECT_ID, 'nonexistent-agent', 'pm:status-changed');
		expect(params).toEqual({});
	});

	it('returns empty object for unknown trigger event', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });

		const params = await getTriggerParameters(PROJECT_ID, AGENT_TYPE, 'pm:unknown-event');
		expect(params).toEqual({});
	});
});

// ============================================================================
// resolveTriggerConfigs
// ============================================================================

describe('resolveTriggerConfigs()', () => {
	it('returns all triggers with definition defaults when no DB overrides exist', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });

		const configs = await resolveTriggerConfigs(PROJECT_ID, AGENT_TYPE);

		expect(configs).toHaveLength(2);

		const statusChangedConfig = configs.find((c) => c.event === 'pm:status-changed');
		expect(statusChangedConfig).toBeDefined();
		expect(statusChangedConfig?.enabled).toBe(true);
		expect(statusChangedConfig?.parameters).toEqual({ authorMode: 'own' });
		expect(statusChangedConfig?.isCustomized).toBe(false);
		expect(statusChangedConfig?.label).toBe('Status Changed');

		const ciConfig = configs.find((c) => c.event === 'scm:check-suite-success');
		expect(ciConfig).toBeDefined();
		expect(ciConfig?.enabled).toBe(false);
		expect(ciConfig?.parameters).toEqual({});
		expect(ciConfig?.isCustomized).toBe(false);
	});

	it('isCustomized is true when DB override exists', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });
		await seedTriggerConfig({
			projectId: PROJECT_ID,
			agentType: AGENT_TYPE,
			triggerEvent: 'pm:status-changed',
			enabled: false,
			parameters: { authorMode: 'external' },
		});

		const configs = await resolveTriggerConfigs(PROJECT_ID, AGENT_TYPE);

		expect(configs).toHaveLength(2);

		const statusChangedConfig = configs.find((c) => c.event === 'pm:status-changed');
		expect(statusChangedConfig?.enabled).toBe(false);
		expect(statusChangedConfig?.parameters).toEqual({ authorMode: 'external' });
		expect(statusChangedConfig?.isCustomized).toBe(true);

		// Non-overridden trigger should have isCustomized: false
		const ciConfig = configs.find((c) => c.event === 'scm:check-suite-success');
		expect(ciConfig?.isCustomized).toBe(false);
	});

	it('returns empty array when agent is not enabled for project', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		// No seedAgentConfig() call

		const configs = await resolveTriggerConfigs(PROJECT_ID, AGENT_TYPE);
		expect(configs).toEqual([]);
	});

	it('returns empty array for unknown agent type', async () => {
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });

		const configs = await resolveTriggerConfigs(PROJECT_ID, 'nonexistent-agent');
		expect(configs).toEqual([]);
	});

	it('returns empty array when definition has no triggers', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_NO_TRIGGERS,
		});
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });

		const configs = await resolveTriggerConfigs(PROJECT_ID, AGENT_TYPE);
		expect(configs).toEqual([]);
	});

	it('merges DB overrides correctly across multiple triggers', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });
		// Override both triggers
		await seedTriggerConfig({
			projectId: PROJECT_ID,
			agentType: AGENT_TYPE,
			triggerEvent: 'pm:status-changed',
			enabled: false,
			parameters: { authorMode: 'external', threshold: 0.5 },
		});
		await seedTriggerConfig({
			projectId: PROJECT_ID,
			agentType: AGENT_TYPE,
			triggerEvent: 'scm:check-suite-success',
			enabled: true,
			parameters: {},
		});

		const configs = await resolveTriggerConfigs(PROJECT_ID, AGENT_TYPE);

		expect(configs).toHaveLength(2);

		const statusChangedConfig = configs.find((c) => c.event === 'pm:status-changed');
		expect(statusChangedConfig?.enabled).toBe(false);
		expect(statusChangedConfig?.parameters).toEqual({ authorMode: 'external', threshold: 0.5 });
		expect(statusChangedConfig?.isCustomized).toBe(true);

		const ciConfig = configs.find((c) => c.event === 'scm:check-suite-success');
		expect(ciConfig?.enabled).toBe(true);
		expect(ciConfig?.isCustomized).toBe(true);
	});
});

// ============================================================================
// getResolvedTriggerConfig
// ============================================================================

describe('getResolvedTriggerConfig()', () => {
	it('returns resolved config for a known trigger event (no DB override)', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });

		const config = await getResolvedTriggerConfig(PROJECT_ID, AGENT_TYPE, 'pm:status-changed');

		expect(config).not.toBeNull();
		expect(config?.event).toBe('pm:status-changed');
		expect(config?.label).toBe('Status Changed');
		expect(config?.enabled).toBe(true);
		expect(config?.parameters).toEqual({ authorMode: 'own' });
		expect(config?.isCustomized).toBe(false);
	});

	it('returns resolved config with DB overrides when present', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });
		await seedTriggerConfig({
			projectId: PROJECT_ID,
			agentType: AGENT_TYPE,
			triggerEvent: 'pm:status-changed',
			enabled: false,
			parameters: { authorMode: 'external' },
		});

		const config = await getResolvedTriggerConfig(PROJECT_ID, AGENT_TYPE, 'pm:status-changed');

		expect(config).not.toBeNull();
		expect(config?.enabled).toBe(false);
		expect(config?.parameters).toEqual({ authorMode: 'external' });
		expect(config?.isCustomized).toBe(true);
	});

	it('returns null for unknown trigger event', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });

		const config = await getResolvedTriggerConfig(PROJECT_ID, AGENT_TYPE, 'pm:unknown-event');
		expect(config).toBeNull();
	});

	it('returns null when agent is not enabled for project', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		// No seedAgentConfig() call

		const config = await getResolvedTriggerConfig(PROJECT_ID, AGENT_TYPE, 'pm:status-changed');
		expect(config).toBeNull();
	});

	it('returns null for unknown agent type', async () => {
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });

		const config = await getResolvedTriggerConfig(
			PROJECT_ID,
			'nonexistent-agent',
			'pm:status-changed',
		);
		expect(config).toBeNull();
	});

	it('includes description and providers from definition', async () => {
		await seedAgentDefinition({
			agentType: AGENT_TYPE,
			definition: AGENT_DEFINITION_WITH_TRIGGERS,
		});
		await seedAgentConfig({ projectId: PROJECT_ID, agentType: AGENT_TYPE });

		const config = await getResolvedTriggerConfig(PROJECT_ID, AGENT_TYPE, 'pm:status-changed');

		expect(config?.description).toBe('Fires when a work item status changes');
	});
});
