import { describe, expect, it } from 'vitest';

import {
	buildCIResponsePrompt,
	buildCheckFailurePrompt,
	buildCommentResponsePrompt,
	buildDebugPrompt,
	buildPRCommentResponsePrompt,
	buildReviewPrompt,
	buildWorkItemPrompt,
} from '../../../../src/agents/shared/taskPrompts.js';

describe('buildWorkItemPrompt', () => {
	it('includes the card ID', () => {
		const prompt = buildWorkItemPrompt('abc123');
		expect(prompt).toContain('abc123');
	});

	it('asks the agent to process the work item', () => {
		const prompt = buildWorkItemPrompt('card-99');
		expect(prompt).toContain('work item');
	});
});

describe('buildCommentResponsePrompt', () => {
	it('includes card ID, comment text, and author', () => {
		const prompt = buildCommentResponsePrompt('card-42', 'Please add tests', 'alice');
		expect(prompt).toContain('card-42');
		expect(prompt).toContain('Please add tests');
		expect(prompt).toContain('@alice');
	});

	it('instructs surgical updates for plan changes', () => {
		const prompt = buildCommentResponsePrompt('card-1', 'Fix the typo', 'bob');
		expect(prompt).toContain('surgical');
	});

	it('mentions that work item data is pre-loaded', () => {
		const prompt = buildCommentResponsePrompt('card-1', 'Update docs', 'carol');
		expect(prompt).toContain('pre-loaded');
	});

	it('instructs to classify the comment', () => {
		const prompt = buildCommentResponsePrompt('card-1', 'Why this approach?', 'dave');
		expect(prompt).toContain('classify');
	});

	it('instructs question-only replies via PostComment without plan modification', () => {
		const prompt = buildCommentResponsePrompt('card-1', 'Why this approach?', 'dave');
		expect(prompt).toContain('question');
		expect(prompt).toContain('PostComment');
		expect(prompt).toContain('do not modify the plan');
	});

	it('defaults to plan updates when intent is ambiguous', () => {
		const prompt = buildCommentResponsePrompt('card-1', 'Some comment', 'eve');
		expect(prompt).toContain('Default to plan updates when intent is ambiguous');
	});
});

describe('buildReviewPrompt', () => {
	it('includes the PR number', () => {
		const prompt = buildReviewPrompt(42);
		expect(prompt).toContain('PR #42');
	});

	it('instructs to use CreatePRReview', () => {
		const prompt = buildReviewPrompt(7);
		expect(prompt).toContain('CreatePRReview');
	});
});

describe('buildCIResponsePrompt', () => {
	it('includes branch and PR number', () => {
		const prompt = buildCIResponsePrompt('fix/ci-errors', 99);
		expect(prompt).toContain('fix/ci-errors');
		expect(prompt).toContain('PR #99');
	});

	it('mentions CI checks have failed', () => {
		const prompt = buildCIResponsePrompt('main', 1);
		expect(prompt).toContain('CI checks have failed');
	});
});

describe('buildPRCommentResponsePrompt', () => {
	it('includes PR number, branch, and comment body', () => {
		const prompt = buildPRCommentResponsePrompt('feat/new', 55, 'Can you fix the typo?');
		expect(prompt).toContain('PR #55');
		expect(prompt).toContain('feat/new');
		expect(prompt).toContain('Can you fix the typo?');
	});

	it('includes file path when provided', () => {
		const prompt = buildPRCommentResponsePrompt('feat/new', 55, 'Fix this line', 'src/utils.ts');
		expect(prompt).toContain('src/utils.ts');
	});

	it('omits file path when not provided', () => {
		const prompt = buildPRCommentResponsePrompt('feat/new', 55, 'Looks good overall!');
		expect(prompt).not.toContain('File:');
	});

	it('omits file path when empty string provided', () => {
		const prompt = buildPRCommentResponsePrompt('feat/new', 55, 'LGTM', '');
		expect(prompt).not.toContain('File:');
	});

	it('instructs surgical changes by default', () => {
		const prompt = buildPRCommentResponsePrompt('main', 1, 'Please refactor');
		expect(prompt).toContain('surgical');
	});
});

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
