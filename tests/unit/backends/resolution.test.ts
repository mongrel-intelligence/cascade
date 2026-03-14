import { describe, expect, it } from 'vitest';
import { resolveEngineName } from '../../../src/backends/resolution.js';
import type { ProjectConfig } from '../../../src/types/index.js';

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

describe('resolveEngineName', () => {
	it('returns project-level agent type override when set', () => {
		const project = makeProject({
			agentEngine: { default: 'llmist', overrides: { implementation: 'claude-code' } },
		});
		expect(resolveEngineName('implementation', project)).toBe('claude-code');
	});

	it('returns project-level default when no override for agent type', () => {
		const project = makeProject({
			agentEngine: { default: 'custom-backend', overrides: {} },
		});
		expect(resolveEngineName('implementation', project)).toBe('custom-backend');
	});

	it('returns "llmist" when no project config', () => {
		const project = makeProject(); // no agentEngine
		expect(resolveEngineName('implementation', project)).toBe('llmist');
	});

	it('returns "llmist" when nothing configured', () => {
		const project = makeProject(); // no agentEngine
		expect(resolveEngineName('implementation', project)).toBe('llmist');
	});

	it('prioritizes override > project default > fallback', () => {
		const project = makeProject({
			agentEngine: {
				default: 'project-default',
				overrides: { review: 'review-backend' },
			},
		});

		// Agent type with override → uses override
		expect(resolveEngineName('review', project)).toBe('review-backend');
		// Agent type without override → uses project default
		expect(resolveEngineName('implementation', project)).toBe('project-default');
	});
});
