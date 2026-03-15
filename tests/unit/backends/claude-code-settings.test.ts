import { beforeAll, describe, expect, it } from 'vitest';
import { registerBuiltInEngines } from '../../../src/backends/bootstrap.js';
import { DEFAULT_CLAUDE_CODE_MODEL } from '../../../src/backends/claude-code/models.js';
import { resolveClaudeCodeSettings } from '../../../src/backends/claude-code/settings.js';
import type { AgentExecutionPlan } from '../../../src/backends/types.js';

beforeAll(() => {
	registerBuiltInEngines();
});

function makeProject(
	overrides: Partial<AgentExecutionPlan['project']> = {},
): AgentExecutionPlan['project'] {
	return {
		id: 'test-project',
		orgId: 'org-1',
		name: 'Test Project',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		pm: { type: 'trello' },
		trello: { boardId: 'b1', lists: {}, labels: {} },
		engineSettings: undefined,
		...overrides,
	};
}

describe('resolveClaudeCodeSettings', () => {
	it('returns empty defaults when no engineSettings configured', () => {
		const result = resolveClaudeCodeSettings(makeProject());
		expect(result).toEqual({
			effort: undefined,
			thinking: undefined,
			thinkingBudgetTokens: undefined,
		});
	});

	it('returns effort from project engineSettings', () => {
		const project = makeProject({
			engineSettings: {
				'claude-code': { effort: 'high' },
			},
		});
		const result = resolveClaudeCodeSettings(project);
		expect(result.effort).toBe('high');
	});

	it('returns thinking from project engineSettings', () => {
		const project = makeProject({
			engineSettings: {
				'claude-code': { thinking: 'adaptive' },
			},
		});
		const result = resolveClaudeCodeSettings(project);
		expect(result.thinking).toBe('adaptive');
	});

	it('returns thinkingBudgetTokens from project engineSettings', () => {
		const project = makeProject({
			engineSettings: {
				'claude-code': { thinking: 'enabled', thinkingBudgetTokens: 8000 },
			},
		});
		const result = resolveClaudeCodeSettings(project);
		expect(result.thinking).toBe('enabled');
		expect(result.thinkingBudgetTokens).toBe(8000);
	});

	it('mergedSettings overrides project.engineSettings', () => {
		const project = makeProject({
			engineSettings: {
				'claude-code': { effort: 'low' },
			},
		});
		const mergedSettings = {
			'claude-code': { effort: 'max' },
		};
		const result = resolveClaudeCodeSettings(project, mergedSettings);
		expect(result.effort).toBe('max');
	});

	it('uses mergedSettings when both project and merged settings present', () => {
		const project = makeProject({
			engineSettings: {
				'claude-code': { effort: 'medium', thinking: 'disabled' },
			},
		});
		// Agent-level override: only effort is overridden
		const mergedSettings = {
			'claude-code': { effort: 'high', thinking: 'disabled' },
		};
		const result = resolveClaudeCodeSettings(project, mergedSettings);
		expect(result.effort).toBe('high');
		expect(result.thinking).toBe('disabled');
	});

	it('uses project.engineSettings as fallback when mergedSettings is undefined', () => {
		const project = makeProject({
			engineSettings: {
				'claude-code': { effort: 'low' },
			},
		});
		const result = resolveClaudeCodeSettings(project, undefined);
		expect(result.effort).toBe('low');
	});

	it('handles all effort levels', () => {
		for (const effort of ['low', 'medium', 'high', 'max'] as const) {
			const project = makeProject({
				engineSettings: { 'claude-code': { effort } },
			});
			expect(resolveClaudeCodeSettings(project).effort).toBe(effort);
		}
	});

	it('handles all thinking modes', () => {
		for (const thinking of ['adaptive', 'enabled', 'disabled'] as const) {
			const project = makeProject({
				engineSettings: { 'claude-code': { thinking } },
			});
			expect(resolveClaudeCodeSettings(project).thinking).toBe(thinking);
		}
	});
});
