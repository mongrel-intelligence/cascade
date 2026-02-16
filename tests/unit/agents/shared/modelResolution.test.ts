import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CascadeConfig, ProjectConfig } from '../../../../src/types/index.js';

// Mock readContextFiles
vi.mock('../../../../src/agents/utils/setup.js', () => ({
	readContextFiles: vi.fn().mockResolvedValue([]),
}));

import { resolveModelConfig } from '../../../../src/agents/shared/modelResolution.js';

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
	return {
		id: 'test-proj',
		orgId: 'org-1',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		pm: { type: 'trello' },
		...overrides,
	} as ProjectConfig;
}

function makeConfig(overrides: Partial<CascadeConfig['defaults']> = {}): CascadeConfig {
	return {
		defaults: {
			model: 'default-model',
			agentModels: {},
			maxIterations: 50,
			agentIterations: {},
			watchdogTimeoutMs: 1800000,
			cardBudgetUsd: 5,
			agentBackend: 'llmist',
			progressModel: 'progress-model',
			progressIntervalMinutes: 5,
			prompts: {},
			...overrides,
		},
		projects: [],
	};
}

describe('resolveModelConfig', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('prompt resolution chain', () => {
		it('uses .eta file when no custom prompts configured', async () => {
			const result = await resolveModelConfig({
				agentType: 'briefing',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
			});

			expect(result.systemPrompt).toContain('product manager');
			expect(result.systemPrompt).toContain('DO NOT IMPLEMENT');
		});

		it('uses project prompt when configured', async () => {
			const project = makeProject({
				prompts: { briefing: 'You are a custom briefing agent for <%= it.baseBranch %>.' },
			});

			const result = await resolveModelConfig({
				agentType: 'briefing',
				project,
				config: makeConfig(),
				repoDir: '/tmp/test',
				promptContext: { baseBranch: 'develop' },
			});

			expect(result.systemPrompt).toBe('You are a custom briefing agent for develop.');
		});

		it('uses defaults prompt when no project prompt', async () => {
			const config = makeConfig({
				prompts: { briefing: 'Global custom briefing for <%= it.projectId %>.' },
			});

			const result = await resolveModelConfig({
				agentType: 'briefing',
				project: makeProject(),
				config,
				repoDir: '/tmp/test',
				promptContext: { projectId: 'p1' },
			});

			expect(result.systemPrompt).toBe('Global custom briefing for p1.');
		});

		it('prefers project prompt over defaults prompt', async () => {
			const project = makeProject({
				prompts: { briefing: 'Project-level prompt.' },
			});
			const config = makeConfig({
				prompts: { briefing: 'Defaults-level prompt.' },
			});

			const result = await resolveModelConfig({
				agentType: 'briefing',
				project,
				config,
				repoDir: '/tmp/test',
			});

			expect(result.systemPrompt).toBe('Project-level prompt.');
		});

		it('falls back to .eta when agent type has no custom prompt', async () => {
			const config = makeConfig({
				prompts: { planning: 'Only planning has a custom prompt.' },
			});

			const result = await resolveModelConfig({
				agentType: 'briefing',
				project: makeProject(),
				config,
				repoDir: '/tmp/test',
			});

			// Should fall back to .eta file for briefing
			expect(result.systemPrompt).toContain('product manager');
		});

		it('resolves includes in custom prompts via dbPartials', async () => {
			const project = makeProject({
				prompts: { briefing: 'Custom: <%~ include("partials/custom") %>' },
			});
			const dbPartials = new Map([['custom', 'Injected partial content']]);

			const result = await resolveModelConfig({
				agentType: 'briefing',
				project,
				config: makeConfig(),
				repoDir: '/tmp/test',
				dbPartials,
			});

			expect(result.systemPrompt).toContain('Injected partial content');
		});

		it('passes dbPartials to .eta file rendering', async () => {
			const dbPartials = new Map([['git', 'Custom git instructions from DB']]);

			const result = await resolveModelConfig({
				agentType: 'implementation',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
				dbPartials,
			});

			expect(result.systemPrompt).toContain('Custom git instructions from DB');
		});
	});

	describe('model resolution', () => {
		it('uses default model when no overrides', async () => {
			const result = await resolveModelConfig({
				agentType: 'briefing',
				project: makeProject(),
				config: makeConfig({ model: 'my-default' }),
				repoDir: '/tmp/test',
			});

			expect(result.model).toBe('my-default');
		});

		it('prefers modelOverride over project and default', async () => {
			const project = makeProject({ model: 'project-model' });

			const result = await resolveModelConfig({
				agentType: 'briefing',
				project,
				config: makeConfig({ model: 'default-model' }),
				repoDir: '/tmp/test',
				modelOverride: 'override-model',
			});

			expect(result.model).toBe('override-model');
		});

		it('uses agent-specific model from project', async () => {
			const project = makeProject({
				agentModels: { briefing: 'agent-specific-model' },
			});

			const result = await resolveModelConfig({
				agentType: 'briefing',
				project,
				config: makeConfig(),
				repoDir: '/tmp/test',
			});

			expect(result.model).toBe('agent-specific-model');
		});

		it('uses configKey for model lookup when provided', async () => {
			const config = makeConfig({
				agentModels: { review: 'review-model' },
			});

			const result = await resolveModelConfig({
				agentType: 'respond-to-review',
				project: makeProject(),
				config,
				repoDir: '/tmp/test',
				configKey: 'review',
			});

			expect(result.model).toBe('review-model');
		});
	});

	describe('iterations resolution', () => {
		it('uses default maxIterations', async () => {
			const result = await resolveModelConfig({
				agentType: 'briefing',
				project: makeProject(),
				config: makeConfig({ maxIterations: 42 }),
				repoDir: '/tmp/test',
			});

			expect(result.maxIterations).toBe(42);
		});

		it('uses agent-specific iterations', async () => {
			const config = makeConfig({
				agentIterations: { briefing: 10 },
				maxIterations: 50,
			});

			const result = await resolveModelConfig({
				agentType: 'briefing',
				project: makeProject(),
				config,
				repoDir: '/tmp/test',
			});

			expect(result.maxIterations).toBe(10);
		});
	});
});
