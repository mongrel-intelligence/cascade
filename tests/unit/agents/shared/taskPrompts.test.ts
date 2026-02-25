import { describe, expect, it } from 'vitest';

import { renderCustomPrompt, renderTaskPrompt } from '../../../../src/agents/prompts/index.js';
import {
	buildCheckFailurePrompt,
	buildDebugPrompt,
} from '../../../../src/agents/shared/taskPrompts.js';

// ============================================================================
// .eta task prompt template tests (replaces the old TS function tests)
// ============================================================================

describe('workItem task template', () => {
	it('includes the card ID', () => {
		const prompt = renderTaskPrompt('workItem', { cardId: 'abc123' });
		expect(prompt).toContain('abc123');
	});

	it('asks the agent to process the work item', () => {
		const prompt = renderTaskPrompt('workItem', { cardId: 'card-99' });
		expect(prompt).toContain('work item');
	});
});

describe('commentResponse task template', () => {
	it('includes card ID, comment text, and author', () => {
		const prompt = renderTaskPrompt('commentResponse', {
			cardId: 'card-42',
			commentText: 'Please add tests',
			commentAuthor: 'alice',
		});
		expect(prompt).toContain('card-42');
		expect(prompt).toContain('Please add tests');
		expect(prompt).toContain('@alice');
	});

	it('instructs surgical updates for plan changes', () => {
		const prompt = renderTaskPrompt('commentResponse', {
			cardId: 'card-1',
			commentText: 'Fix the typo',
			commentAuthor: 'bob',
		});
		expect(prompt).toContain('surgical');
	});

	it('mentions that work item data is pre-loaded', () => {
		const prompt = renderTaskPrompt('commentResponse', {
			cardId: 'card-1',
			commentText: 'Update docs',
			commentAuthor: 'carol',
		});
		expect(prompt).toContain('pre-loaded');
	});

	it('instructs to classify the comment', () => {
		const prompt = renderTaskPrompt('commentResponse', {
			cardId: 'card-1',
			commentText: 'Why this approach?',
			commentAuthor: 'dave',
		});
		expect(prompt).toContain('classify');
	});

	it('instructs question-only replies via PostComment without plan modification', () => {
		const prompt = renderTaskPrompt('commentResponse', {
			cardId: 'card-1',
			commentText: 'Why this approach?',
			commentAuthor: 'dave',
		});
		expect(prompt).toContain('question');
		expect(prompt).toContain('PostComment');
		expect(prompt).toContain('do not modify the plan');
	});

	it('defaults to plan updates when intent is ambiguous', () => {
		const prompt = renderTaskPrompt('commentResponse', {
			cardId: 'card-1',
			commentText: 'Some comment',
			commentAuthor: 'eve',
		});
		expect(prompt).toContain('Default to plan updates when intent is ambiguous');
	});
});

describe('review task template', () => {
	it('includes the PR number', () => {
		const prompt = renderTaskPrompt('review', { prNumber: 42 });
		expect(prompt).toContain('PR #42');
	});

	it('instructs to use CreatePRReview', () => {
		const prompt = renderTaskPrompt('review', { prNumber: 7 });
		expect(prompt).toContain('CreatePRReview');
	});
});

describe('ci task template', () => {
	it('includes branch and PR number', () => {
		const prompt = renderTaskPrompt('ci', { prBranch: 'fix/ci-errors', prNumber: 99 });
		expect(prompt).toContain('fix/ci-errors');
		expect(prompt).toContain('PR #99');
	});

	it('mentions CI checks have failed', () => {
		const prompt = renderTaskPrompt('ci', { prBranch: 'main', prNumber: 1 });
		expect(prompt).toContain('CI checks have failed');
	});
});

describe('prCommentResponse task template', () => {
	it('includes PR number, branch, and comment body', () => {
		const prompt = renderTaskPrompt('prCommentResponse', {
			prBranch: 'feat/new',
			prNumber: 55,
			commentBody: 'Can you fix the typo?',
		});
		expect(prompt).toContain('PR #55');
		expect(prompt).toContain('feat/new');
		expect(prompt).toContain('Can you fix the typo?');
	});

	it('includes file path when provided', () => {
		const prompt = renderTaskPrompt('prCommentResponse', {
			prBranch: 'feat/new',
			prNumber: 55,
			commentBody: 'Fix this line',
			commentPath: 'src/utils.ts',
		});
		expect(prompt).toContain('src/utils.ts');
	});

	it('omits file path when not provided', () => {
		const prompt = renderTaskPrompt('prCommentResponse', {
			prBranch: 'feat/new',
			prNumber: 55,
			commentBody: 'Looks good overall!',
		});
		expect(prompt).not.toContain('File:');
	});

	it('omits file path when empty string provided', () => {
		const prompt = renderTaskPrompt('prCommentResponse', {
			prBranch: 'feat/new',
			prNumber: 55,
			commentBody: 'LGTM',
			commentPath: '',
		});
		expect(prompt).not.toContain('File:');
	});

	it('instructs surgical changes by default', () => {
		const prompt = renderTaskPrompt('prCommentResponse', {
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

describe('renderTaskPrompt edge cases', () => {
	it('renders DB task prompt override with partials via renderCustomPrompt', () => {
		const dbPartials = new Map([['custom', 'DB partial content']]);
		const result = renderCustomPrompt('Task: <%~ include("partials/custom") %>', {}, dbPartials);
		expect(result).toContain('DB partial content');
	});

	it('throws for nonexistent template name', () => {
		expect(() => renderTaskPrompt('nonexistent-template', {})).toThrow();
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
		originalCardName: 'Fix the login bug',
		originalCardUrl: 'https://trello.com/c/abc',
		detectedAgentType: 'implementation',
	};

	it('includes the log directory', () => {
		const prompt = buildDebugPrompt(debugContext);
		expect(prompt).toContain('/tmp/logs/abc');
	});

	it('includes the original card name', () => {
		const prompt = buildDebugPrompt(debugContext);
		expect(prompt).toContain('Fix the login bug');
	});

	it('includes the detected agent type', () => {
		const prompt = buildDebugPrompt(debugContext);
		expect(prompt).toContain('implementation');
	});
});
