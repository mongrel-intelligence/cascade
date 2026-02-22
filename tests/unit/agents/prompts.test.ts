import { describe, expect, it } from 'vitest';
import {
	getAvailablePartialNames,
	getRawPartial,
	getRawTemplate,
	getSystemPrompt,
	getTemplateVariables,
	getValidAgentTypes,
	renderCustomPrompt,
	resolveIncludes,
	validateTemplate,
} from '../../../src/agents/prompts/index.js';

describe('getSystemPrompt', () => {
	it('returns briefing prompt for briefing agent', () => {
		const prompt = getSystemPrompt('briefing');
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

	it('renders context variables in briefing prompt', () => {
		const prompt = getSystemPrompt('briefing', {
			storiesListId: 'stories-123',
			processedLabelId: 'label-456',
		});
		expect(prompt).toContain('STORIES_LIST_ID: stories-123');
		expect(prompt).toContain('PROCESSED_LABEL_ID: label-456');
	});

	it('uses default values when context is not provided', () => {
		const prompt = getSystemPrompt('briefing');
		expect(prompt).toContain('STORIES_LIST_ID: NOT_CONFIGURED');
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
	it('briefing prompt includes key instructions', () => {
		const prompt = getSystemPrompt('briefing');
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
		const raw = getRawTemplate('briefing');
		expect(raw).toContain('<%');
		expect(raw).toBeTruthy();
	});

	it('throws for unknown agent type', () => {
		expect(() => getRawTemplate('unknown-type')).toThrow('Unknown agent type: unknown-type');
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
		expect(types).toContain('briefing');
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
		expect(names).toContain('cardId');
		expect(names).toContain('projectId');
	});
});
