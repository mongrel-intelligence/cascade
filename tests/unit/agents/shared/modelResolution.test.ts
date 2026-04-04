import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDefinition } from '../../../../src/agents/definitions/schema.js';
import type { CascadeConfig, ProjectConfig } from '../../../../src/types/index.js';

/**
 * Creates a valid mock AgentDefinition with optional prompt overrides.
 * Uses minimal valid values for all required fields.
 */
function mockAgentDefinition(prompts?: AgentDefinition['prompts']): AgentDefinition {
	return {
		identity: { emoji: '🤖', label: 'Test', roleHint: 'test', initialMessage: 'Hi' },
		capabilities: {
			required: ['fs:read', 'session:ctrl'],
			optional: [],
		},
		strategies: {
			contextPipeline: [],
		},
		backend: { enableStopHooks: false, needsGitHubToken: false },
		hint: 'test',
		trailingMessage: undefined,
		prompts,
	};
}

// Mock readContextFiles
vi.mock('../../../../src/agents/utils/setup.js', () => ({
	readContextFiles: vi.fn().mockResolvedValue([]),
}));

// Mock resolveAgentDefinition and related functions
vi.mock('../../../../src/agents/definitions/loader.js', () => ({
	resolveAgentDefinition: vi.fn().mockResolvedValue({ prompts: undefined }),
	resolveKnownAgentTypes: vi
		.fn()
		.mockResolvedValue([
			'splitting',
			'planning',
			'implementation',
			'review',
			'respond-to-review',
			'respond-to-ci',
			'respond-to-pr-comment',
			'respond-to-planning-comment',
			'debug',
		]),
	getBuiltinAgentTypes: vi.fn().mockReturnValue([]),
}));

// Also mock the index re-export
vi.mock('../../../../src/agents/definitions/index.js', () => ({
	resolveAgentDefinition: vi.fn().mockResolvedValue({ prompts: undefined }),
	resolveKnownAgentTypes: vi
		.fn()
		.mockResolvedValue([
			'splitting',
			'planning',
			'implementation',
			'review',
			'respond-to-review',
			'respond-to-ci',
			'respond-to-pr-comment',
			'respond-to-planning-comment',
			'debug',
		]),
	getBuiltinAgentTypes: vi.fn().mockReturnValue([]),
}));

// Mock getAgentConfigPrompts (project-level prompt lookup)
vi.mock('../../../../src/db/repositories/agentConfigsRepository.js', () => ({
	getAgentConfigPrompts: vi.fn().mockResolvedValue({ systemPrompt: null, taskPrompt: null }),
}));

import { resolveAgentDefinition } from '../../../../src/agents/definitions/loader.js';
import { initPrompts } from '../../../../src/agents/prompts/index.js';
import { resolveModelConfig } from '../../../../src/agents/shared/modelResolution.js';
import { getAgentConfigPrompts } from '../../../../src/db/repositories/agentConfigsRepository.js';

// Initialize prompts before tests so validTypes is populated
beforeAll(async () => {
	await initPrompts();
});

beforeEach(() => {
	// Reset to default (no custom prompt)
	vi.mocked(resolveAgentDefinition).mockResolvedValue(mockAgentDefinition(undefined));
	// Reset project-level prompts to empty (no project overrides)
	vi.mocked(getAgentConfigPrompts).mockResolvedValue({ systemPrompt: null, taskPrompt: null });
});

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

function makeConfig(_overrides: Record<string, unknown> = {}): CascadeConfig {
	return {
		projects: [],
	};
}

describe('resolveModelConfig', () => {
	describe('prompt resolution chain', () => {
		it('uses .eta file when no custom prompts in definition', async () => {
			vi.mocked(resolveAgentDefinition).mockResolvedValue(mockAgentDefinition(undefined));

			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
			});

			expect(result.systemPrompt).toContain('product manager');
			expect(result.systemPrompt).toContain('DO NOT IMPLEMENT');
		});

		it('uses definition systemPrompt when configured', async () => {
			vi.mocked(resolveAgentDefinition).mockResolvedValue(
				mockAgentDefinition({
					systemPrompt: 'You are a custom splitting agent for <%= it.baseBranch %>.',
				}),
			);

			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
				promptContext: { baseBranch: 'develop' },
			});

			expect(result.systemPrompt).toBe('You are a custom splitting agent for develop.');
		});

		it('falls back to .eta when definition has no systemPrompt', async () => {
			vi.mocked(resolveAgentDefinition).mockResolvedValue(
				mockAgentDefinition({ taskPrompt: 'Only task prompt configured.' }),
			);

			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
			});

			// Should fall back to .eta file for splitting
			expect(result.systemPrompt).toContain('product manager');
		});

		it('falls back to .eta when definition lookup fails', async () => {
			vi.mocked(resolveAgentDefinition).mockRejectedValue(new Error('not found'));

			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
			});

			// Should fall back to .eta file
			expect(result.systemPrompt).toContain('product manager');
		});

		it('resolves includes in custom prompts via dbPartials', async () => {
			vi.mocked(resolveAgentDefinition).mockResolvedValue(
				mockAgentDefinition({ systemPrompt: 'Custom: <%~ include("partials/custom") %>' }),
			);
			const dbPartials = new Map([['custom', 'Injected partial content']]);

			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject(),
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

	describe('3-tier prompt resolution chain (project → definition → .eta)', () => {
		it('project-level systemPrompt takes priority over definition systemPrompt', async () => {
			vi.mocked(getAgentConfigPrompts).mockResolvedValue({
				systemPrompt: 'Project override: custom system prompt for <%= it.projectId %>.',
				taskPrompt: null,
			});
			vi.mocked(resolveAgentDefinition).mockResolvedValue(
				mockAgentDefinition({ systemPrompt: 'Definition system prompt (should not be used).' }),
			);

			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject({ id: 'my-proj' }),
				config: makeConfig(),
				repoDir: '/tmp/test',
				promptContext: { projectId: 'my-proj' },
			});

			expect(result.systemPrompt).toBe('Project override: custom system prompt for my-proj.');
		});

		it('project-level systemPrompt takes priority over .eta file defaults', async () => {
			vi.mocked(getAgentConfigPrompts).mockResolvedValue({
				systemPrompt: 'Project-level system prompt — no .eta.',
				taskPrompt: null,
			});
			// No definition override
			vi.mocked(resolveAgentDefinition).mockResolvedValue(mockAgentDefinition(undefined));

			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
			});

			expect(result.systemPrompt).toBe('Project-level system prompt — no .eta.');
		});

		it('project-level taskPrompt takes priority over definition taskPrompt', async () => {
			vi.mocked(getAgentConfigPrompts).mockResolvedValue({
				systemPrompt: null,
				taskPrompt: 'Project task: work on <%= it.workItemId %>.',
			});
			vi.mocked(resolveAgentDefinition).mockResolvedValue(
				mockAgentDefinition({ taskPrompt: 'Definition task prompt (should not be used).' }),
			);

			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
				agentInput: { workItemId: 'card-77' },
			});

			expect(result.taskPrompt).toBe('Project task: work on card-77.');
		});

		it('project-level taskPrompt takes priority over undefined (no .eta task prompt)', async () => {
			vi.mocked(getAgentConfigPrompts).mockResolvedValue({
				systemPrompt: null,
				taskPrompt: 'Project-specific task override.',
			});
			vi.mocked(resolveAgentDefinition).mockResolvedValue(mockAgentDefinition(undefined));

			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
			});

			expect(result.taskPrompt).toBe('Project-specific task override.');
		});

		it('definition systemPrompt wins when no project override', async () => {
			vi.mocked(getAgentConfigPrompts).mockResolvedValue({
				systemPrompt: null,
				taskPrompt: null,
			});
			vi.mocked(resolveAgentDefinition).mockResolvedValue(
				mockAgentDefinition({ systemPrompt: 'Definition-level system prompt.' }),
			);

			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
			});

			expect(result.systemPrompt).toBe('Definition-level system prompt.');
		});

		it('definition taskPrompt wins when no project task override', async () => {
			vi.mocked(getAgentConfigPrompts).mockResolvedValue({
				systemPrompt: null,
				taskPrompt: null,
			});
			vi.mocked(resolveAgentDefinition).mockResolvedValue(
				mockAgentDefinition({ taskPrompt: 'Definition task: item <%= it.workItemId %>.' }),
			);

			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
				agentInput: { workItemId: 'item-55' },
			});

			expect(result.taskPrompt).toBe('Definition task: item item-55.');
		});

		it('.eta file is used when no project override and no definition systemPrompt', async () => {
			vi.mocked(getAgentConfigPrompts).mockResolvedValue({
				systemPrompt: null,
				taskPrompt: null,
			});
			vi.mocked(resolveAgentDefinition).mockResolvedValue(mockAgentDefinition(undefined));

			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
			});

			// .eta file for splitting contains "product manager"
			expect(result.systemPrompt).toContain('product manager');
			expect(result.taskPrompt).toBeUndefined();
		});

		it('project systemPrompt and definition taskPrompt can coexist independently', async () => {
			vi.mocked(getAgentConfigPrompts).mockResolvedValue({
				systemPrompt: 'Project system override.',
				taskPrompt: null,
			});
			vi.mocked(resolveAgentDefinition).mockResolvedValue(
				mockAgentDefinition({ taskPrompt: 'Definition task for <%= it.workItemId %>.' }),
			);

			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
				agentInput: { workItemId: 'card-10' },
			});

			expect(result.systemPrompt).toBe('Project system override.');
			expect(result.taskPrompt).toBe('Definition task for card-10.');
		});

		it('falls through to defaults when project config lookup fails', async () => {
			vi.mocked(getAgentConfigPrompts).mockRejectedValue(new Error('DB unavailable'));
			vi.mocked(resolveAgentDefinition).mockResolvedValue(mockAgentDefinition(undefined));

			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
			});

			// Falls back to .eta file
			expect(result.systemPrompt).toContain('product manager');
		});

		it('project prompt uses renderCustomPrompt with dbPartials for include resolution', async () => {
			vi.mocked(getAgentConfigPrompts).mockResolvedValue({
				systemPrompt: 'Project: <%~ include("partials/custom") %>',
				taskPrompt: null,
			});
			const dbPartials = new Map([['custom', 'Injected from project prompt']]);

			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
				dbPartials,
			});

			expect(result.systemPrompt).toContain('Injected from project prompt');
		});

		it('project task prompt uses renderInlineTaskPrompt with agentInput context', async () => {
			vi.mocked(getAgentConfigPrompts).mockResolvedValue({
				systemPrompt: null,
				taskPrompt: 'Comment by @<%= it.commentAuthor %>: <%= it.commentText %>',
			});

			const result = await resolveModelConfig({
				agentType: 'respond-to-planning-comment',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
				agentInput: {
					triggerCommentText: 'Please refactor',
					triggerCommentAuthor: 'bob',
				},
			});

			expect(result.taskPrompt).toBe('Comment by @bob: Please refactor');
		});
	});

	describe('model resolution', () => {
		it('uses project model when no overrides', async () => {
			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject({ model: 'my-default' }),
				repoDir: '/tmp/test',
			});

			expect(result.model).toBe('my-default');
		});

		it('prefers modelOverride over project model', async () => {
			const project = makeProject({ model: 'project-model' });

			const result = await resolveModelConfig({
				agentType: 'splitting',
				project,
				repoDir: '/tmp/test',
				modelOverride: 'override-model',
			});

			expect(result.model).toBe('override-model');
		});

		it('uses agent-specific model from project', async () => {
			const project = makeProject({
				agentModels: { splitting: 'agent-specific-model' },
			});

			const result = await resolveModelConfig({
				agentType: 'splitting',
				project,
				config: makeConfig(),
				repoDir: '/tmp/test',
			});

			expect(result.model).toBe('agent-specific-model');
		});

		it('uses configKey for model lookup when provided (project-level)', async () => {
			const config = makeConfig();
			const project = makeProject({ agentModels: { review: 'review-model' } });

			const result = await resolveModelConfig({
				agentType: 'respond-to-review',
				project,
				config,
				repoDir: '/tmp/test',
				configKey: 'review',
			});

			expect(result.model).toBe('review-model');
		});
	});

	describe('task prompt override resolution', () => {
		it('returns undefined taskPrompt when no override configured', async () => {
			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
			});

			expect(result.taskPrompt).toBeUndefined();
		});

		it('renders task prompt from definition', async () => {
			vi.mocked(resolveAgentDefinition).mockResolvedValue(
				mockAgentDefinition({ taskPrompt: 'Custom task for <%= it.workItemId %>.' }),
			);

			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
				agentInput: { workItemId: 'card-42' },
			});

			expect(result.taskPrompt).toBe('Custom task for card-42.');
		});

		it('renders task-specific variables from agentInput', async () => {
			vi.mocked(resolveAgentDefinition).mockResolvedValue(
				mockAgentDefinition({
					taskPrompt: 'Comment by @<%= it.commentAuthor %>: <%= it.commentText %>',
				}),
			);

			const result = await resolveModelConfig({
				agentType: 'respond-to-planning-comment',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
				agentInput: {
					triggerCommentText: 'Add more tests',
					triggerCommentAuthor: 'alice',
				},
			});

			expect(result.taskPrompt).toBe('Comment by @alice: Add more tests');
		});

		it('renders PR-specific variables from agentInput in task prompt override', async () => {
			vi.mocked(resolveAgentDefinition).mockResolvedValue(
				mockAgentDefinition({
					taskPrompt:
						'PR #<%= it.prNumber %>, file: <%= it.commentPath %>, body: <%= it.commentBody %>',
				}),
			);

			const result = await resolveModelConfig({
				agentType: 'respond-to-pr-comment',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
				agentInput: {
					prNumber: 55,
					triggerCommentBody: 'Fix this line',
					triggerCommentPath: 'src/utils.ts',
				},
				promptContext: { prNumber: 55 },
			});

			expect(result.taskPrompt).toContain('PR #55');
			expect(result.taskPrompt).toContain('src/utils.ts');
			expect(result.taskPrompt).toContain('Fix this line');
		});

		it('forwards promptContext fields to task prompt rendering', async () => {
			vi.mocked(resolveAgentDefinition).mockResolvedValue(
				mockAgentDefinition({
					taskPrompt:
						'Backlog: <%= it.backlogListId %>, TODO: <%= it.todoListId %>, PM: <%= it.pmName %>',
				}),
			);

			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
				promptContext: {
					backlogListId: 'list-abc',
					todoListId: 'list-def',
					pmName: 'Trello',
				},
			});

			expect(result.taskPrompt).toBe('Backlog: list-abc, TODO: list-def, PM: Trello');
		});

		it('returns undefined taskPrompt when definition has no taskPrompt', async () => {
			vi.mocked(resolveAgentDefinition).mockResolvedValue(
				mockAgentDefinition({ systemPrompt: 'Only system prompt configured.' }),
			);

			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject(),
				config: makeConfig(),
				repoDir: '/tmp/test',
				agentInput: { workItemId: 'card-99' },
			});

			expect(result.taskPrompt).toBeUndefined();
		});
	});

	describe('iterations resolution', () => {
		it('uses project maxIterations', async () => {
			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject({ maxIterations: 42 }),
				repoDir: '/tmp/test',
			});

			expect(result.maxIterations).toBe(42);
		});

		it('uses project maxIterations (default from schema)', async () => {
			const result = await resolveModelConfig({
				agentType: 'splitting',
				project: makeProject({ maxIterations: 50 }),
				repoDir: '/tmp/test',
			});

			expect(result.maxIterations).toBe(50);
		});
	});
});
