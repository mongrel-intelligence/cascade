import { describe, expect, it } from 'vitest';
import { resolveBackendName } from '../../../src/backends/resolution.js';
import type { CascadeConfig, ProjectConfig } from '../../../src/types/index.js';

function makeProject(overrides?: Partial<ProjectConfig>): ProjectConfig {
	return {
		id: 'test',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: { boardId: 'b1', lists: {}, labels: {} },
		...overrides,
	};
}

function makeConfig(overrides?: Partial<CascadeConfig['defaults']>): CascadeConfig {
	return {
		defaults: {
			model: 'test-model',
			agentModels: {},
			maxIterations: 50,
			agentIterations: {},
			watchdogTimeoutMs: 1800000,
			cardBudgetUsd: 5,
			agentBackend: 'llmist',
			progressModel: 'openrouter:google/gemini-2.5-flash-lite',
			progressIntervalMinutes: 5,
			...overrides,
		},
		projects: [],
	};
}

describe('resolveBackendName', () => {
	it('returns project-level agent type override when set', () => {
		const project = makeProject({
			agentBackend: { default: 'llmist', overrides: { implementation: 'claude-code' } },
		});
		const config = makeConfig();
		expect(resolveBackendName('implementation', project, config)).toBe('claude-code');
	});

	it('returns project-level default when no override for agent type', () => {
		const project = makeProject({
			agentBackend: { default: 'custom-backend', overrides: {} },
		});
		const config = makeConfig();
		expect(resolveBackendName('implementation', project, config)).toBe('custom-backend');
	});

	it('returns cascade-level default when no project config', () => {
		const project = makeProject(); // no agentBackend
		const config = makeConfig({ agentBackend: 'cascade-default' });
		expect(resolveBackendName('implementation', project, config)).toBe('cascade-default');
	});

	it('returns "llmist" when nothing configured', () => {
		const project = makeProject(); // no agentBackend
		const config = makeConfig(); // agentBackend = 'llmist' (default)
		expect(resolveBackendName('implementation', project, config)).toBe('llmist');
	});

	it('prioritizes override > project default > cascade default > fallback', () => {
		const project = makeProject({
			agentBackend: {
				default: 'project-default',
				overrides: { review: 'review-backend' },
			},
		});
		const config = makeConfig({ agentBackend: 'cascade-default' });

		// Agent type with override → uses override
		expect(resolveBackendName('review', project, config)).toBe('review-backend');
		// Agent type without override → uses project default
		expect(resolveBackendName('implementation', project, config)).toBe('project-default');
	});
});
