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
			'resolve-conflicts',
			'alerting',
		]),
}));

import {
	buildTaskPromptContext,
	getAvailablePartialNames,
	getRawPartial,
	getRawTemplate,
	getSystemPrompt,
	getTaskTemplateVariables,
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

describe('buildTaskPromptContext', () => {
	it('preserves scalar alert fields and comment aliases', () => {
		const context = buildTaskPromptContext({
			workItemId: 'MNG-740',
			alertTitle: 'Error rate high',
			alertIssueUrl: 'https://sentry.io/issues/123/',
			alertIssueId: '123',
			alertOrgId: 'mongrel',
			alertMetricKey: 'mongrel:Error rate high',
			triggerCommentBody: 'Please investigate',
			triggerCommentText: 'legacy body',
			triggerCommentAuthor: 'aaight42',
			project: { id: 'not-exposed' },
			config: { projects: [] },
		});

		expect(context).toMatchObject({
			workItemId: 'MNG-740',
			alertTitle: 'Error rate high',
			alertIssueUrl: 'https://sentry.io/issues/123/',
			alertIssueId: '123',
			alertOrgId: 'mongrel',
			alertMetricKey: 'mongrel:Error rate high',
			commentText: 'Please investigate',
			commentBody: 'Please investigate',
			commentAuthor: 'aaight42',
		});
		expect(context.project).toBeUndefined();
		expect(context.config).toBeUndefined();
	});

	it('documents alert task template variables', () => {
		const names = getTaskTemplateVariables().map((variable) => variable.name);
		expect(names).toEqual(
			expect.arrayContaining([
				'alertTitle',
				'alertIssueUrl',
				'alertIssueId',
				'alertOrgId',
				'alertMetricKey',
			]),
		);
	});
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
			workItemCreateContainerId: 'team-123',
			backlogStatusId: 'state-backlog',
			processedLabelId: 'label-456',
		});
		expect(prompt).toContain('WORK_ITEM_CREATE_CONTAINER_ID: team-123');
		expect(prompt).toContain('BACKLOG_STATUS_ID: state-backlog');
		expect(prompt).toContain('PROCESSED_LABEL_ID: label-456');
	});

	it('uses default values when context is not provided', () => {
		const prompt = getSystemPrompt('splitting');
		expect(prompt).toContain('WORK_ITEM_CREATE_CONTAINER_ID: NOT_CONFIGURED');
		expect(prompt).toContain('BACKLOG_STATUS_ID: NOT_CONFIGURED');
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

	it('backlog-manager prompt uses PipelineSnapshotSummary JSON as the only pipeline contract', () => {
		const prompt = getSystemPrompt('backlog-manager');
		expect(prompt).toContain('PipelineSnapshotSummary');
		expect(prompt).toContain('activePipelineCount');
		expect(prompt).toContain('itemsById');
		expect(prompt).toContain('dependencySignals');
		expect(prompt).not.toContain('legacy markdown Pipeline Snapshot');
	});

	it('backlog-manager prompt aborts moves when activeCapacityReliable is false', () => {
		const prompt = getSystemPrompt('backlog-manager');
		expect(prompt).toContain('activeCapacityReliable');
		expect(prompt).toContain('abort immediately');
		// The abort instruction must appear before backlog selection guidance
		const abortIdx = prompt.indexOf('activeCapacityReliable');
		const selectionIdx = prompt.indexOf('Backlog Selection Process');
		expect(abortIdx).toBeLessThan(selectionIdx);
	});

	it('backlog-manager prompt targets all-blocked comment to first BACKLOG item only', () => {
		const prompt = getSystemPrompt('backlog-manager');
		expect(prompt).toContain(
			'Post this comment exactly once on the first BACKLOG item in `PipelineSnapshotSummary.statuses.backlog.itemIds` order',
		);
		expect(prompt).toContain('Do not post it on a DONE/MERGED trigger item');
		expect(prompt).toContain('do not post it on every blocked backlog item');
	});

	it('backlog-manager prompt exits silently when backlog is empty', () => {
		const prompt = getSystemPrompt('backlog-manager');
		expect(prompt).toContain('If BACKLOG is empty, exit silently');
		expect(prompt).toContain('do not post a blocked-backlog comment');
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

	it('backlog-manager prompt uses status-aware backlog listing and state guard wording', () => {
		const prompt = getSystemPrompt('backlog-manager', {
			backlogStatusId: 'state-backlog',
			backlogSourceLabel: 'state-backlog',
		});
		expect(prompt).toContain('BACKLOG_STATUS_ID: `state-backlog`');
		expect(prompt).toContain('status: "backlog"');
		expect(prompt).toContain('expectedSourceState: state-backlog');
		expect(prompt).not.toContain('Use these EXACT IDs when calling `ListWorkItems`');
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
			'You MUST fill ALL remaining capacity. Move up to 3 cards per run — always move as many eligible items as there are open slots.',
		);
		expect(prompt).toContain(
			'ALWAYS maximize throughput — fill ALL capacity slots with eligible items (limit: 3). Never move fewer when eligible items exist.',
		);
	});

	it('backlog-manager prompt includes maximize-throughput rule when limit>1', () => {
		const prompt = getSystemPrompt('backlog-manager', { maxInFlightItems: 2 });
		expect(prompt).toContain('MAXIMIZE THROUGHPUT');
		expect(prompt).toContain('you MUST move 2 items, not fewer');
		// Should NOT render the maximize-throughput rule for single-item mode
		const promptSingle = getSystemPrompt('backlog-manager', { maxInFlightItems: 1 });
		expect(promptSingle).not.toContain('MAXIMIZE THROUGHPUT');
	});

	it('backlog-manager prompt instructs exact count for multi-slot scenarios', () => {
		const prompt = getSystemPrompt('backlog-manager', { maxInFlightItems: 2 });
		expect(prompt).toContain('min(remaining_capacity, eligible_unblocked_items)');
		expect(prompt).toContain('If 2 open slots and 2 eligible items exist, move BOTH');
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
		expect(names).toContain('backlogStatusId');
		expect(names).toContain('workItemCreateContainerId');
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
			'resolve-conflicts',
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
});

describe('PM terminology rendering', () => {
	it('splitting prompt with pmType=jira renders "issue" instead of "card"', () => {
		const prompt = getSystemPrompt('splitting', {
			pmType: 'jira',
			workItemNoun: 'issue',
			workItemNounPlural: 'issues',
			workItemNounCap: 'Issue',
			workItemNounPluralCap: 'Issues',
			pmName: 'JIRA',
		});
		expect(prompt).toContain('issue');
		expect(prompt).not.toContain(' card');
	});

	it('splitting prompt with pmType=jira renders JIRA URL examples', () => {
		const prompt = getSystemPrompt('splitting', {
			pmType: 'jira',
			workItemNoun: 'issue',
			workItemNounPlural: 'issues',
			workItemNounCap: 'Issue',
			workItemNounPluralCap: 'Issues',
			pmName: 'JIRA',
		});
		expect(prompt).toContain('atlassian.net/browse');
	});

	it('planning prompt with pmType=jira renders JIRA-specific wording', () => {
		const prompt = getSystemPrompt('planning', {
			pmType: 'jira',
			workItemNoun: 'issue',
			workItemNounPlural: 'issues',
			workItemNounCap: 'Issue',
			workItemNounPluralCap: 'Issues',
			pmName: 'JIRA',
		});
		expect(prompt).toContain('JIRA');
		expect(prompt).toContain('issue');
	});

	it('planning prompt with pmType=jira includes JIRA subtask description note', () => {
		const prompt = getSystemPrompt('planning', {
			pmType: 'jira',
			workItemNoun: 'issue',
			workItemNounPlural: 'issues',
			workItemNounCap: 'Issue',
			workItemNounPluralCap: 'Issues',
			pmName: 'JIRA',
		});
		expect(prompt).toContain('JIRA subtask description');
	});

	it('planning prompt with pmType=jira includes atlassian URL template', () => {
		const prompt = getSystemPrompt('planning', {
			pmType: 'jira',
			workItemNoun: 'issue',
			workItemNounPlural: 'issues',
			workItemNounCap: 'Issue',
			workItemNounPluralCap: 'Issues',
			pmName: 'JIRA',
		});
		expect(prompt).toContain('atlassian.net/browse');
	});

	it('splitting prompt default rendering (no pmType) falls back to Trello terminology', () => {
		const prompt = getSystemPrompt('splitting');
		expect(prompt).toContain('card');
		expect(prompt).not.toContain('atlassian.net');
		expect(prompt).toContain('trello.com/c');
	});

	it('planning prompt default rendering (no pmType) falls back to Trello terminology', () => {
		const prompt = getSystemPrompt('planning');
		expect(prompt).toContain('Trello');
		expect(prompt).toContain('card');
		expect(prompt).toContain('trello.com/c');
	});

	it('planning prompt default rendering uses Trello URL examples not JIRA', () => {
		const prompt = getSystemPrompt('planning');
		expect(prompt).not.toContain('atlassian.net/browse');
	});
});

describe('duplicate content detection', () => {
	/**
	 * Detects if any block of 3+ consecutive non-trivial lines appears more than once.
	 * "Trivial" lines are blank lines, "---", or single-word headings (e.g. "## Rules").
	 * Lines inside fenced code blocks (``` ... ```) are excluded from duplicate detection
	 * because code examples legitimately repeat patterns.
	 */
	function findDuplicateBlocks(promptText: string): string[] {
		const lines = promptText.split('\n');

		// Strip lines inside fenced code blocks
		const nonCodeLines: string[] = [];
		let inCodeBlock = false;
		for (const line of lines) {
			if (line.trim().startsWith('```')) {
				inCodeBlock = !inCodeBlock;
				continue; // skip fence markers themselves
			}
			if (!inCodeBlock) {
				nonCodeLines.push(line);
			}
		}

		// Filter to non-trivial lines
		function isTrivial(line: string): boolean {
			const trimmed = line.trim();
			if (trimmed === '') return true;
			if (trimmed === '---') return true;
			// Single-word heading: "## Word" with no spaces after trimming heading marker
			if (/^#{1,6}\s+\S+$/.test(trimmed)) return true;
			return false;
		}

		const blockSize = 3;

		// Collect all non-trivial lines outside code blocks
		const nonTrivialLines = nonCodeLines.filter((l) => !isTrivial(l));

		// Use a sliding window of blockSize consecutive non-trivial lines
		const seen = new Set<string>();
		const duplicates: string[] = [];
		for (let i = 0; i <= nonTrivialLines.length - blockSize; i++) {
			const block = nonTrivialLines.slice(i, i + blockSize).join('\n');
			if (seen.has(block)) {
				duplicates.push(block);
			} else {
				seen.add(block);
			}
		}

		return duplicates;
	}

	const allAgentTypes = [
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
		'resolve-conflicts',
	];

	for (const agentType of allAgentTypes) {
		it(`${agentType} prompt has no duplicate block of 3+ consecutive lines`, () => {
			const prompt = getSystemPrompt(agentType);
			const duplicates = findDuplicateBlocks(prompt);
			expect(
				duplicates,
				`${agentType} prompt contains duplicate content blocks:\n${duplicates.map((b) => `---\n${b}\n---`).join('\n')}`,
			).toHaveLength(0);
		});
	}
});

describe('VerifyChanges presence', () => {
	it('respond-to-ci rendered prompt contains VerifyChanges', () => {
		const prompt = getSystemPrompt('respond-to-ci');
		expect(prompt).toContain('VerifyChanges');
	});

	it('respond-to-review rendered prompt contains VerifyChanges', () => {
		const prompt = getSystemPrompt('respond-to-review');
		expect(prompt).toContain('VerifyChanges');
	});
});

describe('debug agent gadget naming', () => {
	it('debug prompt contains ListDirectory (capitalized)', () => {
		const prompt = getSystemPrompt('debug');
		expect(prompt).toContain('ListDirectory');
	});

	it('debug prompt contains RipGrep', () => {
		const prompt = getSystemPrompt('debug');
		expect(prompt).toContain('RipGrep');
	});

	it('debug prompt contains Tmux', () => {
		const prompt = getSystemPrompt('debug');
		expect(prompt).toContain('Tmux');
	});
});

describe('documentation-maintenance partial', () => {
	it('partial exists in getAvailablePartialNames()', () => {
		const names = getAvailablePartialNames();
		expect(names).toContain('documentation-maintenance');
	});

	it('partial contains key doc-update phrases', () => {
		const content = getRawPartial('documentation-maintenance');
		expect(content).toContain('CLAUDE.md');
		expect(content).toContain('README');
		expect(content).toContain('JSDoc');
		expect(content).toContain('docs/');
	});

	it('partial describes when to update docs (conditional guidance)', () => {
		const content = getRawPartial('documentation-maintenance');
		expect(content).toContain('When to');
	});

	it('partial provides a documentation update checklist', () => {
		const content = getRawPartial('documentation-maintenance');
		expect(content).toContain('Documentation Update Checklist');
	});
});

describe('documentation maintenance in code-modifying agent prompts', () => {
	it('implementation prompt contains documentation maintenance section', () => {
		const prompt = getSystemPrompt('implementation');
		expect(prompt).toContain('Documentation Maintenance');
		expect(prompt).toContain('CLAUDE.md');
		expect(prompt).toContain('JSDoc');
	});

	it('implementation prompt completion protocol includes documentation step', () => {
		const prompt = getSystemPrompt('implementation');
		expect(prompt).toContain('Documentation updated');
	});

	it('respond-to-review prompt contains documentation maintenance section', () => {
		const prompt = getSystemPrompt('respond-to-review');
		expect(prompt).toContain('Documentation Maintenance');
		expect(prompt).toContain('CLAUDE.md');
	});

	it('respond-to-review prompt scope section mentions documentation updates', () => {
		const prompt = getSystemPrompt('respond-to-review');
		expect(prompt).toContain('documented behavior');
	});

	it('respond-to-ci prompt contains documentation maintenance section', () => {
		const prompt = getSystemPrompt('respond-to-ci');
		expect(prompt).toContain('Documentation Maintenance');
		expect(prompt).toContain('CLAUDE.md');
	});

	it('respond-to-pr-comment prompt contains documentation maintenance section', () => {
		const prompt = getSystemPrompt('respond-to-pr-comment');
		expect(prompt).toContain('Documentation Maintenance');
		expect(prompt).toContain('CLAUDE.md');
	});

	it('respond-to-pr-comment prompt scope section mentions documentation updates', () => {
		const prompt = getSystemPrompt('respond-to-pr-comment');
		expect(prompt).toContain('documented behavior');
	});

	it('resolve-conflicts prompt contains documentation maintenance section', () => {
		const prompt = getSystemPrompt('resolve-conflicts');
		expect(prompt).toContain('Documentation Maintenance');
		expect(prompt).toContain('CLAUDE.md');
	});
});

describe('documentation review checks in review agent', () => {
	it('review prompt contains Documentation subsection under What to Verify', () => {
		const prompt = getSystemPrompt('review');
		expect(prompt).toContain('### Documentation');
	});

	it('review prompt covers documentation currency', () => {
		const prompt = getSystemPrompt('review');
		expect(prompt).toContain('Currency');
	});

	it('review prompt covers undocumented new features', () => {
		const prompt = getSystemPrompt('review');
		expect(prompt).toContain('New features');
	});

	it('review prompt covers stale references in docs', () => {
		const prompt = getSystemPrompt('review');
		expect(prompt).toContain('Stale references');
	});

	it('review prompt includes SHOULD_FIX severity for missing user-facing docs', () => {
		const prompt = getSystemPrompt('review');
		expect(prompt).toContain('SHOULD_FIX');
	});

	it('review prompt does NOT include documentation-maintenance partial (reports gaps, does not fix)', () => {
		const prompt = getSystemPrompt('review');
		// The partial's checklist heading should not be present in review
		expect(prompt).not.toContain('Documentation Update Checklist');
	});
});

describe('documentation planning in planning agent', () => {
	it('planning prompt contains documentation check as step 6 in pattern analysis', () => {
		const prompt = getSystemPrompt('planning');
		expect(prompt).toContain('Check documentation');
	});

	it('planning prompt includes guidance to add doc update steps to plans', () => {
		const prompt = getSystemPrompt('planning');
		expect(prompt).toContain('doc update step');
	});

	it('planning prompt does NOT include documentation-maintenance partial', () => {
		const prompt = getSystemPrompt('planning');
		// The partial's checklist heading should not be in planning prompt
		expect(prompt).not.toContain('Documentation Update Checklist');
	});
});

describe('alerting prompt (spec 018)', () => {
	it('renders without throwing for the default empty context', () => {
		expect(() => getSystemPrompt('alerting')).not.toThrow();
	});

	it('renders without throwing when an existing workItemId is provided', () => {
		expect(() =>
			getSystemPrompt('alerting', { workItemId: 'WI-1234', backlogListId: 'list-abc' }),
		).not.toThrow();
	});

	it('renders without throwing when only a creation container is provided', () => {
		expect(() =>
			getSystemPrompt('alerting', { workItemCreateContainerId: 'container-abc' }),
		).not.toThrow();
	});

	it('contains all three phase markers in order', () => {
		const prompt = getSystemPrompt('alerting');
		// Match the heading shape ("Phase N: ...") rather than the bare token,
		// so cross-references like "proceed to Phase 3" in earlier prose don't
		// fool indexOf.
		const phase1 = prompt.search(/Phase 1: \w/);
		const phase2 = prompt.search(/Phase 2: \w/);
		const phase3 = prompt.search(/Phase 3: \w/);
		expect(phase1).toBeGreaterThanOrEqual(0);
		expect(phase2).toBeGreaterThan(phase1);
		expect(phase3).toBeGreaterThan(phase2);
	});

	it('contains the INVESTIGATE-AND-FILE-ONLY guardrail', () => {
		const prompt = getSystemPrompt('alerting');
		expect(prompt).toMatch(/INVESTIGATE-AND-FILE-ONLY/i);
	});

	it('includes the shared environment partial preamble', () => {
		const prompt = getSystemPrompt('alerting');
		// "Available Runtimes" is a stable heading from partials/environment.eta
		expect(prompt).toContain('Available Runtimes');
	});

	it('directs commenting on the existing work item when workItemId is provided', () => {
		const prompt = getSystemPrompt('alerting', {
			workItemId: 'WI-1234',
			backlogListId: 'list-abc',
		});
		// When both are present, the prompt should prefer commenting; check for an
		// explicit comment-mode directive that references the workItemId.
		expect(prompt).toMatch(/comment/i);
		expect(prompt).toContain('WI-1234');
	});

	it('directs creating a backlog work item when only creation container is provided', () => {
		const prompt = getSystemPrompt('alerting', { workItemCreateContainerId: 'container-abc' });
		expect(prompt).toMatch(/create/i);
		expect(prompt).toContain('container-abc');
	});

	it('does not contain engine-specific tool-call syntax', () => {
		const prompt = getSystemPrompt('alerting');
		// Banned patterns: claude-code internal markers, OpenAI-specific
		// chat-format markers, anything that screams "this prompt assumed
		// a particular backend's tool-call shape".
		expect(prompt).not.toMatch(/<\|im_start\|>/);
		expect(prompt).not.toMatch(/<\|im_end\|>/);
		expect(prompt).not.toMatch(/<function_calls>/);
		expect(prompt).not.toMatch(/```tool_use/);
	});

	it('reinforces the read-only nature (no source edits / no PRs)', () => {
		const prompt = getSystemPrompt('alerting');
		// Defensive prose paralleling review.eta's "REVIEW ONLY" guardrail.
		expect(prompt).toMatch(/do not edit|never edit|no source edits/i);
		expect(prompt).toMatch(/no pull request|do not open a pr|never open a pr|no PR/i);
	});
});
