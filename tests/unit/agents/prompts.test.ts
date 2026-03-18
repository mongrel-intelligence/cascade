import { beforeAll, describe, expect, it, vi } from 'vitest';

// Mock resolveKnownAgentTypes so validTypes is populated without DB
vi.mock('../../../src/agents/definitions/index.js', () => ({
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
			'backlog-manager',
		]),
}));

import {
	getAvailablePartialNames,
	getRawPartial,
	getRawTemplate,
	getSystemPrompt,
	getTemplateVariables,
	getValidAgentTypes,
	initPrompts,
	readTemplateFileSync,
	renderCustomPrompt,
	resolveIncludes,
	validateTemplate,
} from '../../../src/agents/prompts/index.js';

// Initialize prompts before tests so validTypes is populated
beforeAll(async () => {
	await initPrompts();
});

describe('getSystemPrompt', () => {
	it('returns splitting prompt for splitting agent', () => {
		const prompt = getSystemPrompt('splitting');
		expect(prompt).toContain('product manager');
		expect(prompt).toContain('DO NOT IMPLEMENT');
	});

	it('returns planning prompt for planning agent', () => {
		const prompt = getSystemPrompt('planning');
		expect(prompt).toContain('software architect');
		expect(prompt).toContain('implementation plan');
	});

	it('returns implementation prompt for implementation agent', () => {
		const prompt = getSystemPrompt('implementation');
		expect(prompt).toContain('software engineer');
		expect(prompt).toContain('tests');
	});

	it('throws for unknown agent type', () => {
		expect(() => getSystemPrompt('unknown')).toThrow('Unknown agent type: unknown');
	});

	it('renders context variables in splitting prompt', () => {
		const prompt = getSystemPrompt('splitting', {
			backlogListId: 'backlog-123',
			processedLabelId: 'label-456',
		});
		expect(prompt).toContain('BACKLOG_LIST_ID: backlog-123');
		expect(prompt).toContain('PROCESSED_LABEL_ID: label-456');
	});

	it('uses default values when context is not provided', () => {
		const prompt = getSystemPrompt('splitting');
		expect(prompt).toContain('BACKLOG_LIST_ID: NOT_CONFIGURED');
		expect(prompt).toContain('PROCESSED_LABEL_ID: NOT_CONFIGURED');
	});

	it('applies DB partials when provided', () => {
		const partials = new Map([['git', '## Custom Git Instructions\nUse rebase workflow.']]);
		const prompt = getSystemPrompt('implementation', {}, partials);
		// The custom partial content should be present instead of disk default
		expect(prompt).toContain('Custom Git Instructions');
		expect(prompt).toContain('Use rebase workflow');
	});
});

describe('system prompts content', () => {
	it('splitting prompt includes key instructions', () => {
		const prompt = getSystemPrompt('splitting');
		expect(prompt).toContain('ReadWorkItem');
		expect(prompt).toContain('CreateWorkItem');
		expect(prompt).toContain('INVEST');
	});

	it('planning prompt includes key instructions', () => {
		const prompt = getSystemPrompt('planning');
		expect(prompt).toContain('ReadWorkItem');
		expect(prompt).toContain('step-by-step');
	});

	it('implementation prompt includes git instructions', () => {
		const prompt = getSystemPrompt('implementation');
		expect(prompt).toContain('Tmux');
		expect(prompt).toContain('conventional commits');
	});

	it('respond-to-planning-comment prompt includes comment classification', () => {
		const prompt = getSystemPrompt('respond-to-planning-comment');
		expect(prompt).toContain('Comment Classification');
		expect(prompt).toContain('Question / Clarification');
		expect(prompt).toContain('Plan Update');
	});

	it('respond-to-planning-comment prompt includes both response formats', () => {
		const prompt = getSystemPrompt('respond-to-planning-comment');
		expect(prompt).toContain('Plan Updated');
		expect(prompt).toContain('Re: [brief topic]');
	});

	it('respond-to-planning-comment prompt instructs no plan changes for questions', () => {
		const prompt = getSystemPrompt('respond-to-planning-comment');
		expect(prompt).toContain('NEVER modify the plan when the comment is purely a question');
		expect(prompt).toContain('PostComment');
	});

	it('respond-to-planning-comment prompt defaults to plan updates for ambiguous comments', () => {
		const prompt = getSystemPrompt('respond-to-planning-comment');
		expect(prompt).toContain('DEFAULT to plan updates (Category B) when intent is ambiguous');
	});

	it('respond-to-planning-comment prompt includes classify step in task flow', () => {
		const prompt = getSystemPrompt('respond-to-planning-comment');
		expect(prompt).toContain('Classify the comment');
		expect(prompt).toContain('Category A (Question)');
		expect(prompt).toContain('Category B (Plan Update)');
		expect(prompt).toContain('Category C (Both)');
	});

	it('planning prompt instructs AddChecklist items to not use Step N prefixes', () => {
		const prompt = getSystemPrompt('planning');
		expect(prompt).toContain('do NOT include "Step N:" prefixes');
		expect(prompt).toContain('Add helper function');
	});

	it('respond-to-planning-comment prompt instructs checklist items to not use Step N prefixes', () => {
		const prompt = getSystemPrompt('respond-to-planning-comment');
		expect(prompt).toContain('Step N:');
		expect(prompt).toContain('clean task names without');
	});

	it('backlog-manager prompt includes pipeline check as first step', () => {
		const prompt = getSystemPrompt('backlog-manager');
		expect(prompt).toContain('CHECK PIPELINE FIRST');
		expect(prompt).toContain('MANDATORY FIRST STEP');
	});

	it('backlog-manager prompt checks only active pipeline stages (not DONE)', () => {
		const prompt = getSystemPrompt('backlog-manager');
		expect(prompt).toContain('TODO');
		expect(prompt).toContain('IN PROGRESS');
		expect(prompt).toContain('IN REVIEW');
		expect(prompt).toContain('DONE');
		// Verify DONE is explicitly noted as not blocking
		expect(prompt).toContain('do not block new work');
	});

	it('backlog-manager prompt instructs to exit silently when pipeline not empty', () => {
		const prompt = getSystemPrompt('backlog-manager');
		expect(prompt).toContain('Exit immediately');
		expect(prompt).toContain('EXIT SILENTLY');
	});

	it('backlog-manager prompt includes PM gadgets only', () => {
		const prompt = getSystemPrompt('backlog-manager');
		expect(prompt).toContain('ListWorkItems');
		expect(prompt).toContain('ReadWorkItem');
		expect(prompt).toContain('UpdateWorkItem');
		expect(prompt).toContain('PostComment');
		// Should NOT include codebase exploration tools
		expect(prompt).not.toContain('ListDirectory');
		expect(prompt).not.toContain('ReadFile');
		expect(prompt).not.toContain('RipGrep');
	});

	it('backlog-manager prompt uses template variables for PM terminology', () => {
		const prompt = getSystemPrompt('backlog-manager');
		// Default fallback values should be used
		expect(prompt).toContain('cards');
		expect(prompt).toContain('card');
	});

	it('backlog-manager prompt warns against describing commands instead of invoking them', () => {
		const prompt = getSystemPrompt('backlog-manager');
		expect(prompt).toContain('EXECUTE COMMANDS');
		expect(prompt).toContain('DO NOT JUST DESCRIBE THEM');
		expect(prompt).toContain('text output has no effect on the system');
	});

	it('backlog-manager prompt posts comment before moving card', () => {
		const prompt = getSystemPrompt('backlog-manager');
		const commentStepIdx = prompt.indexOf('5. **Post a comment**');
		const moveStepIdx = prompt.indexOf('6. **Move the selected');
		expect(commentStepIdx).toBeGreaterThan(-1);
		expect(moveStepIdx).toBeGreaterThan(-1);
		expect(commentStepIdx).toBeLessThan(moveStepIdx);
		// Rule reinforces the ordering
		expect(prompt).toContain('comment BEFORE moving');
	});

	it('backlog-manager prompt renders custom PM terminology', () => {
		const prompt = getSystemPrompt('backlog-manager', {
			workItemNoun: 'issue',
			workItemNounPlural: 'issues',
		});
		expect(prompt).toContain('issues');
		expect(prompt).toContain('issue');
	});

	it('backlog-manager prompt renders single-item wording when limit=1 (backward compat)', () => {
		const prompt = getSystemPrompt('backlog-manager', { maxInFlightItems: 1 });
		expect(prompt).toContain('Move exactly one card per run. Never move multiple.');
		expect(prompt).toContain('ALWAYS move exactly ONE card per run');
		// Should NOT show conflict awareness section for single-item mode
		expect(prompt).not.toContain('Conflict Awareness');
	});

	it('backlog-manager prompt renders single-item wording when maxInFlightItems is absent (default=1)', () => {
		const prompt = getSystemPrompt('backlog-manager', {});
		// Default fallback renders same as limit=1 behaviour
		expect(prompt).toContain('Move exactly one card per run. Never move multiple.');
		expect(prompt).not.toContain('Conflict Awareness');
	});

	it('backlog-manager prompt renders multi-item wording when limit>1', () => {
		const prompt = getSystemPrompt('backlog-manager', { maxInFlightItems: 3 });
		expect(prompt).toContain(
			'Move up to 3 cards per run (only enough to fill remaining capacity).',
		);
		expect(prompt).toContain('Move only as many cards as needed to reach capacity (limit: 3)');
	});

	it('backlog-manager prompt includes conflict awareness section when limit>1', () => {
		const prompt = getSystemPrompt('backlog-manager', { maxInFlightItems: 3 });
		expect(prompt).toContain('Conflict Awareness');
		expect(prompt).toContain('minimize file-level conflicts between simultaneously active cards');
	});

	it('backlog-manager prompt uses capacity-based check instead of binary empty check', () => {
		const prompt = getSystemPrompt('backlog-manager', { maxInFlightItems: 2 });
		expect(prompt).toContain('>= 2');
		expect(prompt).toContain('at capacity');
		// Must NOT use the old "all empty" absolute check
		expect(prompt).not.toContain('If ANY cards exist in TODO, IN PROGRESS, or IN REVIEW');
	});

	it('backlog-manager prompt references maxInFlightItems limit in capacity check (limit=1)', () => {
		const prompt = getSystemPrompt('backlog-manager', { maxInFlightItems: 1 });
		expect(prompt).toContain('>= 1');
		expect(prompt).toContain('at capacity');
	});

	it('backlog-manager prompt includes maxInFlightItems in getTemplateVariables', () => {
		const vars = getTemplateVariables();
		const names = vars.map((v) => v.name);
		expect(names).toContain('maxInFlightItems');
	});
});

describe('resolveIncludes', () => {
	it('resolves include from DB partials', () => {
		const template = 'Before <%~ include("partials/git") %> After';
		const dbPartials = new Map([['git', 'DB GIT CONTENT']]);
		const result = resolveIncludes(template, dbPartials);
		expect(result).toBe('Before DB GIT CONTENT After');
	});

	it('falls back to disk when partial not in DB', () => {
		const template = '<%~ include("partials/git") %>';
		const result = resolveIncludes(template, new Map());
		// Should resolve from disk — the git partial exists on disk
		expect(result).toBeTruthy();
		expect(result).not.toContain('include(');
	});

	it('throws when partial not found in DB or disk', () => {
		const template = '<%~ include("partials/nonexistent-partial-xyz") %>';
		expect(() => resolveIncludes(template, new Map())).toThrow(
			'Partial not found: partials/nonexistent-partial-xyz',
		);
	});

	it('resolves multiple includes', () => {
		const template = 'A <%~ include("partials/one") %> B <%~ include("partials/two") %> C';
		const dbPartials = new Map([
			['one', 'FIRST'],
			['two', 'SECOND'],
		]);
		const result = resolveIncludes(template, dbPartials);
		expect(result).toBe('A FIRST B SECOND C');
	});

	it('returns template unchanged when no includes', () => {
		const template = 'No includes here, just plain text.';
		const result = resolveIncludes(template, new Map());
		expect(result).toBe(template);
	});

	it('prefers DB partial over disk', () => {
		const template = '<%~ include("partials/git") %>';
		const dbPartials = new Map([['git', 'OVERRIDE']]);
		const result = resolveIncludes(template, dbPartials);
		expect(result).toBe('OVERRIDE');
	});
});

describe('renderCustomPrompt', () => {
	it('renders Eta variables', () => {
		const template = 'Branch: <%= it.baseBranch %>';
		const result = renderCustomPrompt(template, { baseBranch: 'main' });
		expect(result).toBe('Branch: main');
	});

	it('resolves includes and renders variables', () => {
		const template = 'Branch: <%= it.baseBranch %>\n<%~ include("partials/custom") %>';
		const dbPartials = new Map([['custom', 'Project: <%= it.projectId %>']]);
		const result = renderCustomPrompt(template, { baseBranch: 'dev', projectId: 'p1' }, dbPartials);
		expect(result).toContain('Branch: dev');
		expect(result).toContain('Project: p1');
	});

	it('handles empty context', () => {
		const template = 'Hello world';
		const result = renderCustomPrompt(template);
		expect(result).toBe('Hello world');
	});

	it('renders undefined variables as "undefined"', () => {
		const template = 'Value: [<%= it.baseBranch %>]';
		const result = renderCustomPrompt(template, {});
		// Eta renders undefined context values as the literal string "undefined"
		expect(result).toBe('Value: [undefined]');
	});
});

describe('validateTemplate', () => {
	it('returns valid for correct Eta syntax', () => {
		const result = validateTemplate('Hello <%= it.baseBranch %>');
		expect(result).toEqual({ valid: true });
	});

	it('returns valid for template with includes (DB partials)', () => {
		const dbPartials = new Map([['test', 'Partial content']]);
		const result = validateTemplate('<%~ include("partials/test") %>', dbPartials);
		expect(result).toEqual({ valid: true });
	});

	it('returns invalid for broken Eta syntax', () => {
		const result = validateTemplate('<% if (true) { %>');
		expect(result.valid).toBe(false);
		expect('error' in result && result.error).toBeTruthy();
	});

	it('returns invalid for missing partial', () => {
		const result = validateTemplate('<%~ include("partials/does-not-exist-xyz") %>');
		expect(result.valid).toBe(false);
	});
});

describe('getRawTemplate', () => {
	it('returns raw .eta template content', () => {
		const raw = getRawTemplate('splitting');
		expect(raw).toContain('<%');
		expect(raw).toBeTruthy();
	});

	it('throws for unknown agent type', () => {
		expect(() => getRawTemplate('unknown-type')).toThrow('Unknown agent type: unknown-type');
	});
});

describe('readTemplateFileSync', () => {
	it('returns raw .eta file content without requiring initPrompts()', () => {
		const content = readTemplateFileSync('splitting');
		expect(content).toBeTruthy();
		expect(typeof content).toBe('string');
		expect(content).toContain('<%');
	});

	it('returns content for all known builtin agent types', () => {
		const builtinTypes = [
			'splitting',
			'planning',
			'implementation',
			'review',
			'respond-to-review',
			'respond-to-ci',
			'respond-to-pr-comment',
			'respond-to-planning-comment',
			'debug',
			'backlog-manager',
		];
		for (const agentType of builtinTypes) {
			const content = readTemplateFileSync(agentType);
			expect(content, `expected ${agentType} to have a .eta file`).toBeTruthy();
		}
	});

	it('returns undefined for non-existent agent type (does not throw)', () => {
		const content = readTemplateFileSync('nonexistent-agent-xyz');
		expect(content).toBeUndefined();
	});

	it('returns the same content as getRawTemplate for known types', () => {
		const viaSync = readTemplateFileSync('implementation');
		const viaGet = getRawTemplate('implementation');
		expect(viaSync).toBe(viaGet);
	});
});

describe('getRawPartial', () => {
	it('returns raw partial content from disk', () => {
		const content = getRawPartial('git');
		expect(content).toBeTruthy();
		expect(typeof content).toBe('string');
	});

	it('throws for nonexistent partial', () => {
		expect(() => getRawPartial('nonexistent-xyz')).toThrow();
	});
});

describe('getValidAgentTypes', () => {
	it('returns an array of agent type strings', () => {
		const types = getValidAgentTypes();
		expect(Array.isArray(types)).toBe(true);
		expect(types.length).toBeGreaterThan(0);
		expect(types).toContain('splitting');
		expect(types).toContain('implementation');
		expect(types).toContain('review');
	});

	it('returns a copy (not the original array)', () => {
		const a = getValidAgentTypes();
		const b = getValidAgentTypes();
		expect(a).not.toBe(b);
		expect(a).toEqual(b);
	});
});

describe('getAvailablePartialNames', () => {
	it('returns an array of partial names', () => {
		const names = getAvailablePartialNames();
		expect(Array.isArray(names)).toBe(true);
		expect(names.length).toBeGreaterThan(0);
		expect(names).toContain('git');
	});

	it('returns names sorted alphabetically', () => {
		const names = getAvailablePartialNames();
		const sorted = [...names].sort();
		expect(names).toEqual(sorted);
	});

	it('returns names without .eta extension', () => {
		const names = getAvailablePartialNames();
		for (const name of names) {
			expect(name).not.toContain('.eta');
		}
	});
});

describe('getTemplateVariables', () => {
	it('returns an array of variable definitions', () => {
		const vars = getTemplateVariables();
		expect(Array.isArray(vars)).toBe(true);
		expect(vars.length).toBeGreaterThan(0);
	});

	it('each variable has name, group, and description', () => {
		const vars = getTemplateVariables();
		for (const v of vars) {
			expect(v).toHaveProperty('name');
			expect(v).toHaveProperty('group');
			expect(v).toHaveProperty('description');
			expect(typeof v.name).toBe('string');
			expect(typeof v.group).toBe('string');
			expect(typeof v.description).toBe('string');
		}
	});

	it('includes common variables', () => {
		const vars = getTemplateVariables();
		const names = vars.map((v) => v.name);
		expect(names).toContain('workItemId');
		expect(names).toContain('projectId');
	});

	it('includes squintEnabled variable', () => {
		const vars = getTemplateVariables();
		const names = vars.map((v) => v.name);
		expect(names).toContain('squintEnabled');
	});

	it('squintEnabled variable belongs to Squint group', () => {
		const vars = getTemplateVariables();
		const squintVar = vars.find((v) => v.name === 'squintEnabled');
		expect(squintVar?.group).toBe('Squint');
	});
});

describe('squintEnabled template gating', () => {
	it('implementation prompt with squintEnabled=true includes squint instructions', () => {
		const prompt = getSystemPrompt('implementation', { squintEnabled: true });
		expect(prompt).toContain('squint features show');
		expect(prompt).toContain('squint flows show');
		expect(prompt).toContain('squint modules show');
		expect(prompt).toContain('squint-modules');
		expect(prompt).toContain('squint-features');
	});

	it('implementation prompt with squintEnabled=false excludes squint instructions', () => {
		const prompt = getSystemPrompt('implementation', { squintEnabled: false });
		expect(prompt).not.toContain('squint features show');
		expect(prompt).not.toContain('squint flows show');
		expect(prompt).not.toContain('squint modules show');
		expect(prompt).not.toContain('squint-modules');
		expect(prompt).not.toContain('squint-features');
	});

	it('implementation prompt with squintEnabled=false still contains core instructions', () => {
		const prompt = getSystemPrompt('implementation', { squintEnabled: false });
		expect(prompt).toContain('CLAUDE.md');
		expect(prompt).toContain('Tmux');
		expect(prompt).toContain('conventional commits');
	});

	it('planning prompt with squintEnabled=true includes squint instructions', () => {
		const prompt = getSystemPrompt('planning', { squintEnabled: true });
		expect(prompt).toContain('squint features show');
		expect(prompt).toContain('squint flows show');
		expect(prompt).toContain('squint modules show');
	});

	it('planning prompt with squintEnabled=false excludes squint instructions', () => {
		const prompt = getSystemPrompt('planning', { squintEnabled: false });
		expect(prompt).not.toContain('squint features show');
		expect(prompt).not.toContain('squint flows show');
		expect(prompt).not.toContain('squint modules show');
	});

	it('planning prompt with squintEnabled=false still contains core instructions', () => {
		const prompt = getSystemPrompt('planning', { squintEnabled: false });
		expect(prompt).toContain('ReadWorkItem');
		expect(prompt).toContain('implementation plan');
	});

	it('splitting prompt with squintEnabled=true includes squint instructions', () => {
		const prompt = getSystemPrompt('splitting', { squintEnabled: true });
		expect(prompt).toContain('squint features show');
		expect(prompt).toContain('squint modules show');
	});

	it('splitting prompt with squintEnabled=false excludes squint instructions', () => {
		const prompt = getSystemPrompt('splitting', { squintEnabled: false });
		expect(prompt).not.toContain('squint features show');
		expect(prompt).not.toContain('squint modules show');
	});

	it('review prompt with squintEnabled=true includes squint instructions', () => {
		const prompt = getSystemPrompt('review', { squintEnabled: true });
		expect(prompt).toContain('squint modules show');
		expect(prompt).toContain('Squint for Conflict Detection');
		expect(prompt).toContain('squint features show');
	});

	it('review prompt with squintEnabled=false excludes squint-specific instructions', () => {
		const prompt = getSystemPrompt('review', { squintEnabled: false });
		expect(prompt).not.toContain('Squint for Conflict Detection');
		expect(prompt).not.toContain('squint modules show');
		expect(prompt).not.toContain('squint features show');
	});

	it('review prompt with squintEnabled=false still contains core review instructions', () => {
		const prompt = getSystemPrompt('review', { squintEnabled: false });
		expect(prompt).toContain('BLOCKING');
		expect(prompt).toContain('APPROVE');
		expect(prompt).toContain('REQUEST_CHANGES');
	});

	it('respond-to-planning-comment prompt with squintEnabled=true includes squint instructions', () => {
		const prompt = getSystemPrompt('respond-to-planning-comment', { squintEnabled: true });
		expect(prompt).toContain('squint features show');
		expect(prompt).toContain('squint flows show');
		expect(prompt).toContain('squint modules show');
	});

	it('respond-to-planning-comment prompt with squintEnabled=false excludes squint instructions', () => {
		const prompt = getSystemPrompt('respond-to-planning-comment', { squintEnabled: false });
		expect(prompt).not.toContain('squint features show');
		expect(prompt).not.toContain('squint flows show');
		expect(prompt).not.toContain('squint modules show');
	});

	it('squint-exploration partial with squintEnabled=true includes squint protocol', () => {
		const partial = getRawPartial('squint-exploration');
		// The partial itself contains the conditional; render it with the context
		const rendered = renderCustomPrompt(partial, { squintEnabled: true });
		expect(rendered).toContain('squint features show');
		expect(rendered).toContain('squint symbols show');
	});

	it('squint-exploration partial with squintEnabled=false shows fallback message', () => {
		const partial = getRawPartial('squint-exploration');
		const rendered = renderCustomPrompt(partial, { squintEnabled: false });
		expect(rendered).not.toContain('squint features show');
		expect(rendered).toContain('no Squint database');
	});

	it('tmux partial with squintEnabled=true includes squint session name examples', () => {
		const partial = getRawPartial('tmux');
		const rendered = renderCustomPrompt(partial, { squintEnabled: true });
		expect(rendered).toContain('squint-modules');
		expect(rendered).toContain('squint-features');
	});

	it('tmux partial with squintEnabled=false excludes squint session name examples', () => {
		const partial = getRawPartial('tmux');
		const rendered = renderCustomPrompt(partial, { squintEnabled: false });
		expect(rendered).not.toContain('squint-modules');
		expect(rendered).not.toContain('squint-features');
	});
});
