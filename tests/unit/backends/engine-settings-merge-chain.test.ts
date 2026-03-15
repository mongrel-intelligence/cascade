/**
 * Unit tests for the engine settings merge chain:
 * agent-config engine settings → project-level engine settings → engine defaults
 */

import { describe, expect, it } from 'vitest';
import { resolveClaudeCodeSettings } from '../../../src/backends/claude-code/settings.js';
import { resolveCodexSettings } from '../../../src/backends/codex/settings.js';
import { resolveOpenCodeSettings } from '../../../src/backends/opencode/settings.js';
import type { EngineSettings } from '../../../src/config/engineSettings.js';
import { mergeEngineSettings } from '../../../src/config/engineSettings.js';
import type { ProjectConfig } from '../../../src/types/index.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
	return {
		id: 'test-project',
		orgId: 'org-1',
		name: 'Test Project',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		pm: { type: 'trello' },
		trello: { boardId: 'b1', lists: {}, labels: {} },
		model: 'openrouter:google/gemini-3-flash-preview',
		maxIterations: 50,
		watchdogTimeoutMs: 1_800_000,
		progressModel: 'openrouter:google/gemini-2.5-flash-lite',
		progressIntervalMinutes: 5,
		workItemBudgetUsd: 5,
		runLinksEnabled: false,
		engineSettings: undefined,
		agentEngineSettings: undefined,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// mergeEngineSettings — merge chain building block
// ---------------------------------------------------------------------------

describe('mergeEngineSettings', () => {
	it('returns undefined when both inputs are undefined', () => {
		expect(mergeEngineSettings(undefined, undefined)).toBeUndefined();
	});

	it('returns project settings when no agent-config override', () => {
		const project: EngineSettings = { 'claude-code': { effort: 'medium' } };
		const result = mergeEngineSettings(project, undefined);
		expect(result).toEqual({ 'claude-code': { effort: 'medium' } });
	});

	it('returns agent settings when no project settings exist', () => {
		const agent: EngineSettings = { 'claude-code': { thinking: 'enabled' } };
		const result = mergeEngineSettings(undefined, agent);
		expect(result).toEqual({ 'claude-code': { thinking: 'enabled' } });
	});

	it('agent-config settings override project-level settings for same engine', () => {
		const project: EngineSettings = { 'claude-code': { effort: 'medium', thinking: 'adaptive' } };
		const agent: EngineSettings = { 'claude-code': { effort: 'max' } };
		const result = mergeEngineSettings(project, agent);
		// agent overrides effort, project thinking is preserved
		expect(result).toEqual({ 'claude-code': { effort: 'max', thinking: 'adaptive' } });
	});

	it('agent-config settings for one engine do not affect another engine', () => {
		const project: EngineSettings = {
			'claude-code': { effort: 'medium' },
			codex: { approvalPolicy: 'never' },
		};
		const agent: EngineSettings = { 'claude-code': { effort: 'high' } };
		const result = mergeEngineSettings(project, agent);
		expect(result?.['claude-code']).toEqual({ effort: 'high' });
		expect(result?.codex).toEqual({ approvalPolicy: 'never' });
	});

	it('agent-config can add new engine settings not in project', () => {
		const project: EngineSettings = { 'claude-code': { effort: 'medium' } };
		const agent: EngineSettings = { codex: { sandboxMode: 'workspace-write' } };
		const result = mergeEngineSettings(project, agent);
		expect(result?.['claude-code']).toEqual({ effort: 'medium' });
		expect(result?.codex).toEqual({ sandboxMode: 'workspace-write' });
	});
});

// ---------------------------------------------------------------------------
// resolveClaudeCodeSettings — explicit engineSettings parameter
// ---------------------------------------------------------------------------

describe('resolveClaudeCodeSettings', () => {
	it('uses engine defaults when no project or explicit settings', () => {
		const project = makeProject();
		const result = resolveClaudeCodeSettings(project);
		expect(result.effort).toBe('high');
		expect(result.thinking).toBe('adaptive');
	});

	it('uses project.engineSettings when no explicit engineSettings provided', () => {
		const project = makeProject({
			engineSettings: { 'claude-code': { effort: 'medium', thinking: 'disabled' } },
		});
		const result = resolveClaudeCodeSettings(project);
		expect(result.effort).toBe('medium');
		expect(result.thinking).toBe('disabled');
	});

	it('uses explicit engineSettings over project.engineSettings', () => {
		const project = makeProject({
			engineSettings: { 'claude-code': { effort: 'medium', thinking: 'disabled' } },
		});
		const explicitSettings: EngineSettings = { 'claude-code': { effort: 'max' } };
		// explicit overrides effort; thinking falls back to default (not project) because
		// the explicit settings don't carry project-level thinking — that's the merge result
		const result = resolveClaudeCodeSettings(project, explicitSettings);
		expect(result.effort).toBe('max');
		// thinking defaults to 'adaptive' (engine default) since explicit settings don't include it
		expect(result.thinking).toBe('adaptive');
	});

	it('uses merged engineSettings that combine project + agent overrides correctly', () => {
		const project = makeProject({
			engineSettings: { 'claude-code': { effort: 'medium', thinking: 'disabled' } },
		});
		// Simulate what buildExecutionPlan does: merge project + agent settings
		const agentEngineSettings: EngineSettings = { 'claude-code': { effort: 'max' } };
		const merged = mergeEngineSettings(project.engineSettings, agentEngineSettings);
		const result = resolveClaudeCodeSettings(project, merged);
		// Agent overrides effort
		expect(result.effort).toBe('max');
		// Project thinking is preserved in the merged result
		expect(result.thinking).toBe('disabled');
	});

	it('falls back gracefully when explicit engineSettings does not contain claude-code key', () => {
		const project = makeProject({
			engineSettings: { 'claude-code': { effort: 'medium' } },
		});
		const explicitSettings: EngineSettings = { codex: { sandboxMode: 'workspace-write' } };
		const result = resolveClaudeCodeSettings(project, explicitSettings);
		// Falls back to engine defaults (explicit settings has no claude-code key)
		expect(result.effort).toBe('high');
		expect(result.thinking).toBe('adaptive');
	});
});

// ---------------------------------------------------------------------------
// resolveCodexSettings — explicit engineSettings parameter
// ---------------------------------------------------------------------------

describe('resolveCodexSettings', () => {
	it('uses engine defaults when no project or explicit settings', () => {
		const project = makeProject();
		const result = resolveCodexSettings(project);
		expect(result.approvalPolicy).toBe('never');
		expect(result.sandboxMode).toBe('danger-full-access');
		expect(result.webSearch).toBe(false);
	});

	it('uses project.engineSettings when no explicit engineSettings provided', () => {
		const project = makeProject({
			engineSettings: { codex: { approvalPolicy: 'never', sandboxMode: 'workspace-write' } },
		});
		const result = resolveCodexSettings(project);
		expect(result.sandboxMode).toBe('workspace-write');
	});

	it('uses explicit engineSettings over project.engineSettings', () => {
		const project = makeProject({
			engineSettings: { codex: { sandboxMode: 'workspace-write' } },
		});
		const explicitSettings: EngineSettings = { codex: { sandboxMode: 'read-only' } };
		const result = resolveCodexSettings(project, undefined, explicitSettings);
		expect(result.sandboxMode).toBe('read-only');
	});

	it('uses merged engineSettings that combine project + agent overrides correctly', () => {
		const project = makeProject({
			engineSettings: { codex: { sandboxMode: 'workspace-write', webSearch: true } },
		});
		const agentEngineSettings: EngineSettings = { codex: { sandboxMode: 'read-only' } };
		const merged = mergeEngineSettings(project.engineSettings, agentEngineSettings);
		const result = resolveCodexSettings(project, undefined, merged);
		// Agent overrides sandboxMode
		expect(result.sandboxMode).toBe('read-only');
		// Project webSearch is preserved
		expect(result.webSearch).toBe(true);
	});

	it('when no agent-config settings, project-level settings are used unchanged', () => {
		const project = makeProject({
			engineSettings: { codex: { reasoningEffort: 'high' } },
		});
		const merged = mergeEngineSettings(project.engineSettings, undefined);
		const result = resolveCodexSettings(project, undefined, merged);
		expect(result.reasoningEffort).toBe('high');
	});
});

// ---------------------------------------------------------------------------
// resolveOpenCodeSettings — explicit engineSettings parameter
// ---------------------------------------------------------------------------

describe('resolveOpenCodeSettings', () => {
	it('uses engine defaults when no project or explicit settings', () => {
		const project = makeProject();
		const result = resolveOpenCodeSettings(project);
		expect(result.webSearch).toBe(false);
	});

	it('uses project.engineSettings when no explicit engineSettings provided', () => {
		const project = makeProject({
			engineSettings: { opencode: { webSearch: true } },
		});
		const result = resolveOpenCodeSettings(project);
		expect(result.webSearch).toBe(true);
	});

	it('uses explicit engineSettings over project.engineSettings', () => {
		const project = makeProject({
			engineSettings: { opencode: { webSearch: false } },
		});
		const explicitSettings: EngineSettings = { opencode: { webSearch: true } };
		const result = resolveOpenCodeSettings(project, explicitSettings);
		expect(result.webSearch).toBe(true);
	});

	it('uses merged engineSettings that combine project + agent overrides correctly', () => {
		const project = makeProject({
			engineSettings: { opencode: { webSearch: false } },
		});
		const agentEngineSettings: EngineSettings = { opencode: { webSearch: true } };
		const merged = mergeEngineSettings(project.engineSettings, agentEngineSettings);
		const result = resolveOpenCodeSettings(project, merged);
		expect(result.webSearch).toBe(true);
	});

	it('when no agent-config settings, project-level settings are used unchanged', () => {
		const project = makeProject({
			engineSettings: { opencode: { webSearch: true } },
		});
		const merged = mergeEngineSettings(project.engineSettings, undefined);
		const result = resolveOpenCodeSettings(project, merged);
		expect(result.webSearch).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Full merge chain: agent-config > project > engine defaults
// ---------------------------------------------------------------------------

describe('merge chain precedence: agent-config > project > engine defaults', () => {
	it('agent-config engine settings take precedence over project for claude-code', () => {
		const project = makeProject({
			engineSettings: {
				'claude-code': { effort: 'medium', thinking: 'disabled' },
			},
			agentEngineSettings: {
				implementation: { 'claude-code': { effort: 'max' } },
			},
		});

		// Simulate buildExecutionPlan merge for 'implementation' agent type
		const agentLevelSettings = project.agentEngineSettings?.implementation;
		const merged = mergeEngineSettings(project.engineSettings, agentLevelSettings);

		const result = resolveClaudeCodeSettings(project, merged);
		// Agent overrides effort
		expect(result.effort).toBe('max');
		// Project thinking preserved through merge
		expect(result.thinking).toBe('disabled');
	});

	it('project settings used when agent-config has no engine settings', () => {
		const project = makeProject({
			engineSettings: {
				'claude-code': { effort: 'low', thinking: 'enabled' },
			},
			agentEngineSettings: undefined,
		});

		const agentLevelSettings = project.agentEngineSettings?.implementation;
		const merged = mergeEngineSettings(project.engineSettings, agentLevelSettings);

		const result = resolveClaudeCodeSettings(project, merged);
		// Project settings used unchanged
		expect(result.effort).toBe('low');
		expect(result.thinking).toBe('enabled');
	});

	it('engine defaults used when neither agent-config nor project has settings', () => {
		const project = makeProject({
			engineSettings: undefined,
			agentEngineSettings: undefined,
		});

		const agentLevelSettings = project.agentEngineSettings?.implementation;
		const merged = mergeEngineSettings(project.engineSettings, agentLevelSettings);

		const result = resolveClaudeCodeSettings(project, merged);
		// Engine defaults
		expect(result.effort).toBe('high');
		expect(result.thinking).toBe('adaptive');
	});

	it('agent-config for one agent type does not affect another agent type', () => {
		const project = makeProject({
			engineSettings: {
				'claude-code': { effort: 'medium' },
			},
			agentEngineSettings: {
				implementation: { 'claude-code': { effort: 'max' } },
			},
		});

		// For 'review' agent, no per-agent overrides — should use project settings
		const reviewAgentSettings = project.agentEngineSettings?.review;
		const mergedForReview = mergeEngineSettings(project.engineSettings, reviewAgentSettings);
		const reviewResult = resolveClaudeCodeSettings(project, mergedForReview);
		expect(reviewResult.effort).toBe('medium');

		// For 'implementation' agent, per-agent overrides apply
		const implAgentSettings = project.agentEngineSettings?.implementation;
		const mergedForImpl = mergeEngineSettings(project.engineSettings, implAgentSettings);
		const implResult = resolveClaudeCodeSettings(project, mergedForImpl);
		expect(implResult.effort).toBe('max');
	});
});
