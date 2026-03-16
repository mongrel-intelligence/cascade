import { beforeEach, describe, expect, it } from 'vitest';
import {
	createAgentConfig,
	deleteAgentConfig,
	getAgentConfigPrompts,
	getMaxConcurrency,
	listAgentConfigs,
	updateAgentConfig,
} from '../../../src/db/repositories/agentConfigsRepository.js';
import { truncateAll } from '../helpers/db.js';
import { seedAgentConfig, seedOrg, seedProject } from '../helpers/seed.js';

describe('agentConfigsRepository (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// createAgentConfig
	// =========================================================================

	describe('createAgentConfig', () => {
		it('creates a config with all fields and returns its ID', async () => {
			const result = await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				model: 'claude-opus-4-5',
				maxIterations: 25,
				agentEngine: 'claude-code',
				engineSettings: { 'claude-code': { maxTokens: 4096 } },
				maxConcurrency: 3,
				systemPrompt: 'You are a helpful coding assistant.',
				taskPrompt: 'Implement the feature described in the card.',
			});

			expect(result).toBeDefined();
			expect(typeof result.id).toBe('number');
		});

		it('creates a config with only required fields', async () => {
			const result = await createAgentConfig({
				projectId: 'test-project',
				agentType: 'review',
			});

			expect(result).toBeDefined();
			expect(typeof result.id).toBe('number');
		});

		it('allows null for optional fields', async () => {
			const result = await createAgentConfig({
				projectId: 'test-project',
				agentType: 'splitting',
				model: null,
				maxIterations: null,
				agentEngine: null,
				engineSettings: null,
				maxConcurrency: null,
				systemPrompt: null,
				taskPrompt: null,
			});

			expect(result).toBeDefined();
			expect(typeof result.id).toBe('number');
		});
	});

	// =========================================================================
	// listAgentConfigs
	// =========================================================================

	describe('listAgentConfigs', () => {
		it('returns all configs for a project', async () => {
			await createAgentConfig({ projectId: 'test-project', agentType: 'implementation' });
			await createAgentConfig({ projectId: 'test-project', agentType: 'review' });

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			expect(configs).toHaveLength(2);
			const agentTypes = configs.map((c) => c.agentType).sort();
			expect(agentTypes).toEqual(['implementation', 'review']);
		});

		it('returns empty array when no configs exist for a project', async () => {
			const configs = await listAgentConfigs({ projectId: 'test-project' });
			expect(configs).toHaveLength(0);
		});

		it('does not return configs from other projects', async () => {
			await seedOrg('other-org', 'Other Org');
			await seedProject({
				id: 'other-project',
				orgId: 'other-org',
				repo: 'other-owner/other-repo',
			});

			await createAgentConfig({ projectId: 'test-project', agentType: 'implementation' });
			await createAgentConfig({ projectId: 'other-project', agentType: 'implementation' });

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			expect(configs).toHaveLength(1);
			expect(configs[0].projectId).toBe('test-project');
		});

		it('returns config fields correctly', async () => {
			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				model: 'claude-opus-4-5',
				maxIterations: 20,
				agentEngine: 'claude-code',
				maxConcurrency: 2,
				systemPrompt: 'System prompt text',
				taskPrompt: 'Task prompt text',
			});

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			expect(configs).toHaveLength(1);
			const config = configs[0];
			expect(config.projectId).toBe('test-project');
			expect(config.agentType).toBe('implementation');
			expect(config.model).toBe('claude-opus-4-5');
			expect(config.maxIterations).toBe(20);
			expect(config.agentEngine).toBe('claude-code');
			expect(config.maxConcurrency).toBe(2);
			expect(config.systemPrompt).toBe('System prompt text');
			expect(config.taskPrompt).toBe('Task prompt text');
		});
	});

	// =========================================================================
	// updateAgentConfig
	// =========================================================================

	describe('updateAgentConfig', () => {
		it('updates model and maxIterations fields', async () => {
			const { id } = await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				model: 'claude-haiku-4-5-20251001',
				maxIterations: 10,
			});

			await updateAgentConfig(id, {
				model: 'claude-opus-4-5',
				maxIterations: 30,
			});

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			expect(configs[0].model).toBe('claude-opus-4-5');
			expect(configs[0].maxIterations).toBe(30);
		});

		it('maps engineSettings input to agentEngineSettings column', async () => {
			const { id } = await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
			});

			const engineSettings = { 'claude-code': { maxTokens: 8192 } };
			await updateAgentConfig(id, { engineSettings });

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			// Column is stored as agentEngineSettings but value should match
			expect(configs[0].agentEngineSettings).toEqual(engineSettings);
		});

		it('performs partial updates without affecting other fields', async () => {
			const { id } = await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				model: 'claude-opus-4-5',
				maxIterations: 20,
				agentEngine: 'claude-code',
			});

			await updateAgentConfig(id, { model: 'claude-haiku-4-5-20251001' });

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			expect(configs[0].model).toBe('claude-haiku-4-5-20251001');
			expect(configs[0].maxIterations).toBe(20);
			expect(configs[0].agentEngine).toBe('claude-code');
		});

		it('can set fields to null', async () => {
			const { id } = await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				model: 'claude-opus-4-5',
				maxConcurrency: 5,
			});

			await updateAgentConfig(id, { model: null, maxConcurrency: null });

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			expect(configs[0].model).toBeNull();
			expect(configs[0].maxConcurrency).toBeNull();
		});
	});

	// =========================================================================
	// deleteAgentConfig
	// =========================================================================

	describe('deleteAgentConfig', () => {
		it('removes the config by ID', async () => {
			const { id } = await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
			});

			await deleteAgentConfig(id);

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			expect(configs).toHaveLength(0);
		});

		it('does not affect other configs when deleting one', async () => {
			const { id: id1 } = await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
			});
			await createAgentConfig({ projectId: 'test-project', agentType: 'review' });

			await deleteAgentConfig(id1);

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			expect(configs).toHaveLength(1);
			expect(configs[0].agentType).toBe('review');
		});

		it('is idempotent — deleting a non-existent ID does not throw', async () => {
			await expect(deleteAgentConfig(999999)).resolves.not.toThrow();
		});
	});

	// =========================================================================
	// JSONB engine settings round-trip
	// =========================================================================

	describe('engineSettings JSONB round-trip', () => {
		it('stores and retrieves complex engineSettings via createAgentConfig', async () => {
			const engineSettings = {
				'claude-code': { maxTokens: 4096, temperature: 0.7 },
			};

			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				engineSettings,
			});

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			expect(configs[0].agentEngineSettings).toEqual(engineSettings);
		});

		it('round-trips engineSettings through updateAgentConfig', async () => {
			const { id } = await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
			});

			const engineSettings = {
				'claude-code': { maxTokens: 8192, topP: 0.9 },
			};
			await updateAgentConfig(id, { engineSettings });

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			expect(configs[0].agentEngineSettings).toEqual(engineSettings);
		});

		it('can update engineSettings to null', async () => {
			const engineSettings = { 'claude-code': { maxTokens: 4096 } };
			const { id } = await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				engineSettings,
			});

			await updateAgentConfig(id, { engineSettings: null });

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			expect(configs[0].agentEngineSettings).toBeNull();
		});
	});

	// =========================================================================
	// getAgentConfigPrompts
	// =========================================================================

	describe('getAgentConfigPrompts', () => {
		it('returns systemPrompt and taskPrompt for a (projectId, agentType) pair', async () => {
			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				systemPrompt: 'You are a coding expert.',
				taskPrompt: 'Implement the feature.',
			});

			const result = await getAgentConfigPrompts('test-project', 'implementation');
			expect(result.systemPrompt).toBe('You are a coding expert.');
			expect(result.taskPrompt).toBe('Implement the feature.');
		});

		it('returns null for both prompts when no config exists', async () => {
			const result = await getAgentConfigPrompts('test-project', 'implementation');
			expect(result.systemPrompt).toBeNull();
			expect(result.taskPrompt).toBeNull();
		});

		it('returns null systemPrompt when only taskPrompt is set', async () => {
			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'review',
				systemPrompt: null,
				taskPrompt: 'Review this PR carefully.',
			});

			const result = await getAgentConfigPrompts('test-project', 'review');
			expect(result.systemPrompt).toBeNull();
			expect(result.taskPrompt).toBe('Review this PR carefully.');
		});

		it('returns null taskPrompt when only systemPrompt is set', async () => {
			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'review',
				systemPrompt: 'You are a senior engineer.',
				taskPrompt: null,
			});

			const result = await getAgentConfigPrompts('test-project', 'review');
			expect(result.systemPrompt).toBe('You are a senior engineer.');
			expect(result.taskPrompt).toBeNull();
		});

		it('returns null/null for an unknown projectId', async () => {
			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				systemPrompt: 'Prompt',
			});

			const result = await getAgentConfigPrompts('unknown-project', 'implementation');
			expect(result.systemPrompt).toBeNull();
			expect(result.taskPrompt).toBeNull();
		});

		it('returns null/null for an unknown agentType', async () => {
			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				systemPrompt: 'Prompt',
			});

			const result = await getAgentConfigPrompts('test-project', 'nonexistent-agent');
			expect(result.systemPrompt).toBeNull();
			expect(result.taskPrompt).toBeNull();
		});
	});

	// =========================================================================
	// getMaxConcurrency
	// =========================================================================

	describe('getMaxConcurrency', () => {
		it('returns the configured maxConcurrency value', async () => {
			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				maxConcurrency: 5,
			});

			const result = await getMaxConcurrency('test-project', 'implementation');
			expect(result).toBe(5);
		});

		it('returns null when maxConcurrency is not set', async () => {
			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				maxConcurrency: null,
			});

			const result = await getMaxConcurrency('test-project', 'implementation');
			expect(result).toBeNull();
		});

		it('returns null when no config exists for the (projectId, agentType) pair', async () => {
			const result = await getMaxConcurrency('test-project', 'implementation');
			expect(result).toBeNull();
		});

		it('returns null for unknown agentType', async () => {
			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				maxConcurrency: 3,
			});

			const result = await getMaxConcurrency('test-project', 'nonexistent-agent');
			expect(result).toBeNull();
		});
	});

	// =========================================================================
	// Multiple agent types per project
	// =========================================================================

	describe('multiple agent types', () => {
		it('maintains independent configs for different agent types within the same project', async () => {
			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				model: 'claude-opus-4-5',
				maxIterations: 25,
				maxConcurrency: 2,
				systemPrompt: 'Implementation system prompt.',
				taskPrompt: 'Implement the card.',
			});

			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'review',
				model: 'claude-haiku-4-5-20251001',
				maxIterations: 10,
				maxConcurrency: 5,
				systemPrompt: 'Review system prompt.',
				taskPrompt: 'Review this PR.',
			});

			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'splitting',
				model: null,
				maxIterations: 5,
			});

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			expect(configs).toHaveLength(3);

			const implConfig = configs.find((c) => c.agentType === 'implementation');
			expect(implConfig?.model).toBe('claude-opus-4-5');
			expect(implConfig?.maxIterations).toBe(25);
			expect(implConfig?.maxConcurrency).toBe(2);
			expect(implConfig?.systemPrompt).toBe('Implementation system prompt.');

			const reviewConfig = configs.find((c) => c.agentType === 'review');
			expect(reviewConfig?.model).toBe('claude-haiku-4-5-20251001');
			expect(reviewConfig?.maxIterations).toBe(10);
			expect(reviewConfig?.maxConcurrency).toBe(5);
			expect(reviewConfig?.systemPrompt).toBe('Review system prompt.');

			const splittingConfig = configs.find((c) => c.agentType === 'splitting');
			expect(splittingConfig?.model).toBeNull();
			expect(splittingConfig?.maxIterations).toBe(5);
		});

		it('prompts are resolved independently per agent type', async () => {
			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				systemPrompt: 'Impl system.',
				taskPrompt: 'Impl task.',
			});

			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'review',
				systemPrompt: 'Review system.',
				taskPrompt: 'Review task.',
			});

			const implPrompts = await getAgentConfigPrompts('test-project', 'implementation');
			expect(implPrompts.systemPrompt).toBe('Impl system.');
			expect(implPrompts.taskPrompt).toBe('Impl task.');

			const reviewPrompts = await getAgentConfigPrompts('test-project', 'review');
			expect(reviewPrompts.systemPrompt).toBe('Review system.');
			expect(reviewPrompts.taskPrompt).toBe('Review task.');
		});

		it('concurrency is resolved independently per agent type', async () => {
			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				maxConcurrency: 2,
			});

			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'review',
				maxConcurrency: 10,
			});

			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'splitting',
				maxConcurrency: null,
			});

			expect(await getMaxConcurrency('test-project', 'implementation')).toBe(2);
			expect(await getMaxConcurrency('test-project', 'review')).toBe(10);
			expect(await getMaxConcurrency('test-project', 'splitting')).toBeNull();
		});

		it('updating one agent type does not affect others', async () => {
			const { id: implId } = await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				model: 'claude-opus-4-5',
			});

			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'review',
				model: 'claude-haiku-4-5-20251001',
			});

			await updateAgentConfig(implId, { model: 'claude-sonnet-4-5-20250929' });

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			const implConfig = configs.find((c) => c.agentType === 'implementation');
			const reviewConfig = configs.find((c) => c.agentType === 'review');

			expect(implConfig?.model).toBe('claude-sonnet-4-5-20250929');
			expect(reviewConfig?.model).toBe('claude-haiku-4-5-20251001');
		});

		it('configs from different projects are isolated', async () => {
			await seedOrg('other-org', 'Other Org');
			await seedProject({
				id: 'other-project',
				orgId: 'other-org',
				repo: 'other-owner/other-repo',
			});

			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				maxConcurrency: 2,
			});

			await createAgentConfig({
				projectId: 'other-project',
				agentType: 'implementation',
				maxConcurrency: 8,
			});

			const testProjectConfigs = await listAgentConfigs({ projectId: 'test-project' });
			const otherProjectConfigs = await listAgentConfigs({ projectId: 'other-project' });

			expect(testProjectConfigs).toHaveLength(1);
			expect(testProjectConfigs[0].maxConcurrency).toBe(2);

			expect(otherProjectConfigs).toHaveLength(1);
			expect(otherProjectConfigs[0].maxConcurrency).toBe(8);
		});
	});

	// =========================================================================
	// seedAgentConfig helper
	// =========================================================================

	describe('seedAgentConfig helper', () => {
		it('seed helper creates a config that appears in listAgentConfigs', async () => {
			await seedAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				model: 'claude-opus-4-5',
				maxIterations: 20,
			});

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			expect(configs).toHaveLength(1);
			expect(configs[0].agentType).toBe('implementation');
			expect(configs[0].model).toBe('claude-opus-4-5');
			expect(configs[0].maxIterations).toBe(20);
		});
	});
});
