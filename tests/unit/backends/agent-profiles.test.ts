import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock external dependencies used by agent-profiles.ts
vi.mock('../../../src/agents/shared/prFormatting.js', () => ({
	formatPRDetails: vi.fn(() => 'formatted-pr-details'),
	formatPRDiff: vi.fn(() => 'formatted-pr-diff'),
	formatPRComments: vi.fn(() => 'formatted-pr-comments'),
	formatPRReviews: vi.fn(() => 'formatted-pr-reviews'),
	formatPRIssueComments: vi.fn(() => 'formatted-pr-issue-comments'),
}));

vi.mock('../../../src/config/reviewConfig.js', () => ({
	REVIEW_FILE_CONTENT_TOKEN_LIMIT: 50000,
	estimateTokens: vi.fn(() => 100),
}));

vi.mock('../../../src/gadgets/ListDirectory.js', () => ({
	ListDirectory: vi.fn().mockImplementation(() => ({
		execute: vi.fn(() => 'directory listing'),
	})),
}));

vi.mock('../../../src/gadgets/github/core/getPRChecks.js', () => ({
	formatCheckStatus: vi.fn(() => 'formatted-check-status'),
}));

vi.mock('../../../src/gadgets/pm/core/readWorkItem.js', () => ({
	readWorkItem: vi.fn(),
}));

vi.mock('../../../src/github/client.js', () => ({
	githubClient: {
		getPR: vi.fn(),
		getPRDiff: vi.fn(),
		getCheckSuiteStatus: vi.fn(),
		createPRComment: vi.fn(),
		getPRReviewComments: vi.fn(),
		getPRReviews: vi.fn(),
		getPRIssueComments: vi.fn(),
	},
}));

vi.mock('../../../src/agents/utils/setup.js', () => ({}));

import { type AgentProfile, getAgentProfile } from '../../../src/backends/agent-profiles.js';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('getAgentProfile', () => {
	describe('respond-to-ci profile', () => {
		let profile: AgentProfile;

		beforeEach(() => {
			profile = getAgentProfile('respond-to-ci');
		});

		it('returns a dedicated profile (not defaultProfile)', () => {
			const defaultProfile = getAgentProfile('some-unknown-agent-type');
			// The default profile returns all tools unfiltered; respond-to-ci filters them
			expect(profile).not.toBe(defaultProfile);
		});

		it('excludes CreatePR from filtered tools', () => {
			const allTools = [
				{ name: 'CreatePR', description: '', cliCommand: '', parameters: {} },
				{ name: 'GetPRDetails', description: '', cliCommand: '', parameters: {} },
				{ name: 'Finish', description: '', cliCommand: '', parameters: {} },
			];

			const filtered = profile.filterTools(allTools);
			const names = filtered.map((t) => t.name);

			expect(names).not.toContain('CreatePR');
		});

		it('includes GitHub CI tools and session tool', () => {
			const allTools = [
				{ name: 'GetPRDetails', description: '', cliCommand: '', parameters: {} },
				{ name: 'GetPRDiff', description: '', cliCommand: '', parameters: {} },
				{ name: 'GetPRChecks', description: '', cliCommand: '', parameters: {} },
				{ name: 'PostPRComment', description: '', cliCommand: '', parameters: {} },
				{ name: 'UpdatePRComment', description: '', cliCommand: '', parameters: {} },
				{ name: 'Finish', description: '', cliCommand: '', parameters: {} },
				{ name: 'ReadWorkItem', description: '', cliCommand: '', parameters: {} },
			];

			const filtered = profile.filterTools(allTools);
			const names = filtered.map((t) => t.name);

			expect(names).toContain('GetPRDetails');
			expect(names).toContain('GetPRDiff');
			expect(names).toContain('GetPRChecks');
			expect(names).toContain('PostPRComment');
			expect(names).toContain('UpdatePRComment');
			expect(names).toContain('Finish');
			expect(names).toContain('ReadWorkItem');
		});

		it('has ALL_SDK_TOOLS for code editing', () => {
			expect(profile.sdkTools).toEqual(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']);
		});

		it('enables stop hooks', () => {
			expect(profile.enableStopHooks).toBe(true);
		});

		it('needs GitHub token', () => {
			expect(profile.needsGitHubToken).toBe(true);
		});

		it('buildTaskPrompt includes PR number and branch', () => {
			const prompt = profile.buildTaskPrompt({
				prNumber: 42,
				prBranch: 'fix/ci-errors',
				repoFullName: 'acme/widgets',
				headSha: 'abc123',
				triggerType: 'check-failure',
			});

			expect(prompt).toContain('PR #42');
			expect(prompt).toContain('fix/ci-errors');
			expect(prompt).toContain('CI checks have failed');
		});

		it('has a preExecute hook', () => {
			expect(profile.preExecute).toBeDefined();
		});
	});

	describe('respond-to-pr-comment profile', () => {
		let profile: AgentProfile;

		beforeEach(() => {
			profile = getAgentProfile('respond-to-pr-comment');
		});

		it('returns a dedicated profile (not reviewProfile or defaultProfile)', () => {
			const reviewProfile = getAgentProfile('review');
			const defaultProfile = getAgentProfile('some-unknown-agent-type');
			expect(profile).not.toBe(reviewProfile);
			expect(profile).not.toBe(defaultProfile);
		});

		it('includes GitHub review tools and session tool', () => {
			const allTools = [
				{ name: 'GetPRDetails', description: '', cliCommand: '', parameters: {} },
				{ name: 'GetPRDiff', description: '', cliCommand: '', parameters: {} },
				{ name: 'GetPRChecks', description: '', cliCommand: '', parameters: {} },
				{ name: 'GetPRComments', description: '', cliCommand: '', parameters: {} },
				{ name: 'PostPRComment', description: '', cliCommand: '', parameters: {} },
				{ name: 'UpdatePRComment', description: '', cliCommand: '', parameters: {} },
				{ name: 'ReplyToReviewComment', description: '', cliCommand: '', parameters: {} },
				{ name: 'CreatePRReview', description: '', cliCommand: '', parameters: {} },
				{ name: 'Finish', description: '', cliCommand: '', parameters: {} },
				{ name: 'CreatePR', description: '', cliCommand: '', parameters: {} },
			];

			const filtered = profile.filterTools(allTools);
			const names = filtered.map((t) => t.name);

			expect(names).toContain('GetPRDetails');
			expect(names).toContain('PostPRComment');
			expect(names).toContain('ReplyToReviewComment');
			expect(names).toContain('CreatePRReview');
			expect(names).toContain('Finish');
			expect(names).not.toContain('CreatePR');
		});

		it('has ALL_SDK_TOOLS for code editing', () => {
			expect(profile.sdkTools).toEqual(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']);
		});

		it('enables stop hooks', () => {
			expect(profile.enableStopHooks).toBe(true);
		});

		it('needs GitHub token', () => {
			expect(profile.needsGitHubToken).toBe(true);
		});

		it('does NOT have a preExecute hook', () => {
			expect(profile.preExecute).toBeUndefined();
		});

		it('buildTaskPrompt includes comment body, PR number, and branch', () => {
			const prompt = profile.buildTaskPrompt({
				prNumber: 99,
				prBranch: 'feat/new-thing',
				repoFullName: 'acme/widgets',
				triggerCommentBody: 'Can you fix the typo on line 5?',
				triggerCommentPath: 'src/utils.ts',
			});

			expect(prompt).toContain('PR #99');
			expect(prompt).toContain('feat/new-thing');
			expect(prompt).toContain('Can you fix the typo on line 5?');
			expect(prompt).toContain('src/utils.ts');
		});

		it('buildTaskPrompt omits file path when triggerCommentPath is empty', () => {
			const prompt = profile.buildTaskPrompt({
				prNumber: 99,
				prBranch: 'feat/new-thing',
				repoFullName: 'acme/widgets',
				triggerCommentBody: 'Looks good overall!',
				triggerCommentPath: '',
			});

			expect(prompt).not.toContain('File:');
		});
	});

	it('returns defaultProfile for unknown agent types', () => {
		const profile = getAgentProfile('nonexistent-agent');
		// Default profile passes all tools through
		const tools = [{ name: 'Anything', description: '', cliCommand: '', parameters: {} }];
		expect(profile.filterTools(tools)).toHaveLength(1);
	});
});
