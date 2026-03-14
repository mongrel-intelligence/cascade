import { describe, expect, it } from 'vitest';

import {
	renderCustomPrompt,
	renderInlineTaskPrompt,
} from '../../../../src/agents/prompts/index.js';
import {
	buildCheckFailurePrompt,
	buildDebugPrompt,
} from '../../../../src/agents/shared/taskPrompts.js';

// ============================================================================
// Inline task prompt template tests (task prompts are now in YAML definitions)
// ============================================================================

// Task prompts that were previously in .eta files are now inline in agent definitions.
// These tests verify renderInlineTaskPrompt works correctly with the new inline format.

// Sample task prompt templates (matching what's in the YAML files)
const WORK_ITEM_TEMPLATE =
	'Analyze and process the work item with ID: <%= it.workItemId %>. The work item data has been pre-loaded.';

const COMMENT_RESPONSE_TEMPLATE = `A user (@<%= it.commentAuthor %>) mentioned you in a comment on work item <%= it.workItemId %>.

Their comment:
---
<%= it.commentText %>
---

The work item data (title, description, checklists, attachments, comments) has been pre-loaded above.
Read the user's comment carefully and classify it: if they ask a question or request clarification, reply with a thorough answer via PostComment (do not modify the plan). If they request plan changes, make surgical, targeted updates. If the comment contains both a question and a change request, do both. Default to plan updates when intent is ambiguous.`;

const REVIEW_TEMPLATE = `Review PR #<%= it.prNumber %>.

Examine the code changes carefully and submit your review using CreatePRReview.`;

const CI_TEMPLATE = `You are on the branch \`<%= it.prBranch %>\` for PR #<%= it.prNumber %>.

CI checks have failed. Analyze the failures and fix them.`;

const PR_COMMENT_RESPONSE_TEMPLATE = `You are on the branch \`<%= it.prBranch %>\` for PR #<%= it.prNumber %>.

A user commented on this PR and mentioned you. Respond to their comment.
<% if (it.commentPath) { -%>
File: <%= it.commentPath %>
<% } -%>

Their comment:
---
<%= it.commentBody %>
---

Read the comment carefully and respond accordingly. If they ask for code changes, make the changes, commit, and push. If they ask a question, reply with a PR comment. Default to surgical, targeted changes unless they clearly ask for something broader.`;

describe('workItem task template', () => {
	it('includes the work item ID', () => {
		const prompt = renderInlineTaskPrompt(WORK_ITEM_TEMPLATE, { workItemId: 'abc123' });
		expect(prompt).toContain('abc123');
	});

	it('asks the agent to process the work item', () => {
		const prompt = renderInlineTaskPrompt(WORK_ITEM_TEMPLATE, { workItemId: 'wi-99' });
		expect(prompt).toContain('work item');
	});
});

describe('commentResponse task template', () => {
	it('includes work item ID, comment text, and author', () => {
		const prompt = renderInlineTaskPrompt(COMMENT_RESPONSE_TEMPLATE, {
			workItemId: 'wi-42',
			commentText: 'Please add tests',
			commentAuthor: 'alice',
		});
		expect(prompt).toContain('wi-42');
		expect(prompt).toContain('Please add tests');
		expect(prompt).toContain('@alice');
	});

	it('instructs surgical updates for plan changes', () => {
		const prompt = renderInlineTaskPrompt(COMMENT_RESPONSE_TEMPLATE, {
			workItemId: 'wi-1',
			commentText: 'Fix the typo',
			commentAuthor: 'bob',
		});
		expect(prompt).toContain('surgical');
	});

	it('mentions that work item data is pre-loaded', () => {
		const prompt = renderInlineTaskPrompt(COMMENT_RESPONSE_TEMPLATE, {
			workItemId: 'wi-1',
			commentText: 'Update docs',
			commentAuthor: 'carol',
		});
		expect(prompt).toContain('pre-loaded');
	});

	it('instructs to classify the comment', () => {
		const prompt = renderInlineTaskPrompt(COMMENT_RESPONSE_TEMPLATE, {
			workItemId: 'wi-1',
			commentText: 'Why this approach?',
			commentAuthor: 'dave',
		});
		expect(prompt).toContain('classify');
	});

	it('instructs question-only replies via PostComment without plan modification', () => {
		const prompt = renderInlineTaskPrompt(COMMENT_RESPONSE_TEMPLATE, {
			workItemId: 'wi-1',
			commentText: 'Why this approach?',
			commentAuthor: 'dave',
		});
		expect(prompt).toContain('question');
		expect(prompt).toContain('PostComment');
		expect(prompt).toContain('do not modify the plan');
	});

	it('defaults to plan updates when intent is ambiguous', () => {
		const prompt = renderInlineTaskPrompt(COMMENT_RESPONSE_TEMPLATE, {
			workItemId: 'wi-1',
			commentText: 'Some comment',
			commentAuthor: 'eve',
		});
		expect(prompt).toContain('Default to plan updates when intent is ambiguous');
	});
});

describe('review task template', () => {
	it('includes the PR number', () => {
		const prompt = renderInlineTaskPrompt(REVIEW_TEMPLATE, { prNumber: 42 });
		expect(prompt).toContain('PR #42');
	});

	it('instructs to use CreatePRReview', () => {
		const prompt = renderInlineTaskPrompt(REVIEW_TEMPLATE, { prNumber: 7 });
		expect(prompt).toContain('CreatePRReview');
	});
});

describe('ci task template', () => {
	it('includes branch and PR number', () => {
		const prompt = renderInlineTaskPrompt(CI_TEMPLATE, { prBranch: 'fix/ci-errors', prNumber: 99 });
		expect(prompt).toContain('fix/ci-errors');
		expect(prompt).toContain('PR #99');
	});

	it('mentions CI checks have failed', () => {
		const prompt = renderInlineTaskPrompt(CI_TEMPLATE, { prBranch: 'main', prNumber: 1 });
		expect(prompt).toContain('CI checks have failed');
	});
});

describe('prCommentResponse task template', () => {
	it('includes PR number, branch, and comment body', () => {
		const prompt = renderInlineTaskPrompt(PR_COMMENT_RESPONSE_TEMPLATE, {
			prBranch: 'feat/new',
			prNumber: 55,
			commentBody: 'Can you fix the typo?',
		});
		expect(prompt).toContain('PR #55');
		expect(prompt).toContain('feat/new');
		expect(prompt).toContain('Can you fix the typo?');
	});

	it('includes file path when provided', () => {
		const prompt = renderInlineTaskPrompt(PR_COMMENT_RESPONSE_TEMPLATE, {
			prBranch: 'feat/new',
			prNumber: 55,
			commentBody: 'Fix this line',
			commentPath: 'src/utils.ts',
		});
		expect(prompt).toContain('src/utils.ts');
	});

	it('omits file path when not provided', () => {
		const prompt = renderInlineTaskPrompt(PR_COMMENT_RESPONSE_TEMPLATE, {
			prBranch: 'feat/new',
			prNumber: 55,
			commentBody: 'Looks good overall!',
		});
		expect(prompt).not.toContain('File:');
	});

	it('omits file path when empty string provided', () => {
		const prompt = renderInlineTaskPrompt(PR_COMMENT_RESPONSE_TEMPLATE, {
			prBranch: 'feat/new',
			prNumber: 55,
			commentBody: 'LGTM',
			commentPath: '',
		});
		expect(prompt).not.toContain('File:');
	});

	it('instructs surgical changes by default', () => {
		const prompt = renderInlineTaskPrompt(PR_COMMENT_RESPONSE_TEMPLATE, {
			prBranch: 'main',
			prNumber: 1,
			commentBody: 'Please refactor',
		});
		expect(prompt).toContain('surgical');
	});
});

// ============================================================================
// Edge cases: DB partials and error handling
// ============================================================================

describe('renderInlineTaskPrompt edge cases', () => {
	it('renders DB task prompt override with partials via renderCustomPrompt', () => {
		const dbPartials = new Map([['custom', 'DB partial content']]);
		const result = renderCustomPrompt('Task: <%~ include("partials/custom") %>', {}, dbPartials);
		expect(result).toContain('DB partial content');
	});

	it('renders basic template without partials', () => {
		const template = 'Process work item <%= it.workItemId %>';
		const prompt = renderInlineTaskPrompt(template, { workItemId: 'wi-123' });
		expect(prompt).toBe('Process work item wi-123');
	});
});

// ============================================================================
// Direct-call prompts (not part of YAML profile system)
// ============================================================================

describe('buildCheckFailurePrompt', () => {
	const prContext = {
		prNumber: 33,
		prBranch: 'fix/flaky-test',
		repoFullName: 'acme/widgets',
		headSha: 'abc123',
	};

	it('includes PR number and branch', () => {
		const prompt = buildCheckFailurePrompt(prContext);
		expect(prompt).toContain('PR #33');
		expect(prompt).toContain('fix/flaky-test');
	});

	it('includes owner and repo from repoFullName', () => {
		const prompt = buildCheckFailurePrompt(prContext);
		expect(prompt).toContain('acme');
		expect(prompt).toContain('widgets');
	});

	it('provides investigation steps', () => {
		const prompt = buildCheckFailurePrompt(prContext);
		expect(prompt).toContain('gh run list');
		expect(prompt).toContain('gh run view');
	});
});

describe('buildDebugPrompt', () => {
	const debugContext = {
		logDir: '/tmp/logs/abc',
		originalWorkItemName: 'Fix the login bug',
		originalWorkItemUrl: 'https://trello.com/c/abc',
		detectedAgentType: 'implementation',
	};

	it('includes the log directory', () => {
		const prompt = buildDebugPrompt(debugContext);
		expect(prompt).toContain('/tmp/logs/abc');
	});

	it('includes the original work item name', () => {
		const prompt = buildDebugPrompt(debugContext);
		expect(prompt).toContain('Fix the login bug');
	});

	it('includes the detected agent type', () => {
		const prompt = buildDebugPrompt(debugContext);
		expect(prompt).toContain('implementation');
	});
});
