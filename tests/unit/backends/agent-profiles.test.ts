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
	ListDirectory: vi.fn().mockImplementation(() => ({ execute: vi.fn(() => 'directory listing') })),
}));
vi.mock('../../../src/gadgets/ReadFile.js', () => ({
	ReadFile: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../../../src/gadgets/RipGrep.js', () => ({
	RipGrep: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../../../src/gadgets/AstGrep.js', () => ({
	AstGrep: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../../../src/gadgets/FileSearchAndReplace.js', () => ({
	FileSearchAndReplace: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../../../src/gadgets/FileMultiEdit.js', () => ({
	FileMultiEdit: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../../../src/gadgets/WriteFile.js', () => ({
	WriteFile: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../../../src/gadgets/VerifyChanges.js', () => ({
	VerifyChanges: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../../../src/gadgets/tmux.js', () => ({
	Tmux: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../../../src/gadgets/Sleep.js', () => ({
	Sleep: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../../../src/gadgets/todo/index.js', () => ({
	TodoUpsert: vi.fn().mockImplementation(() => ({})),
	TodoUpdateStatus: vi.fn().mockImplementation(() => ({})),
	TodoDelete: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../../../src/gadgets/Finish.js', () => ({
	Finish: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../../../src/gadgets/github/index.js', () => ({
	CreatePR: vi.fn().mockImplementation(() => ({})),
	GetPRChecks: vi.fn().mockImplementation(() => ({})),
	GetPRComments: vi.fn().mockImplementation(() => ({})),
	GetPRDetails: vi.fn().mockImplementation(() => ({})),
	GetPRDiff: vi.fn().mockImplementation(() => ({})),
	PostPRComment: vi.fn().mockImplementation(() => ({})),
	ReplyToReviewComment: vi.fn().mockImplementation(() => ({})),
	UpdatePRComment: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../../../src/gadgets/pm/index.js', () => ({
	AddChecklist: vi.fn().mockImplementation(() => ({})),
	CreateWorkItem: vi.fn().mockImplementation(() => ({})),
	ListWorkItems: vi.fn().mockImplementation(() => ({})),
	PMUpdateChecklistItem: vi.fn().mockImplementation(() => ({})),
	PostComment: vi.fn().mockImplementation(() => ({})),
	ReadWorkItem: vi.fn().mockImplementation(() => ({})),
	UpdateWorkItem: vi.fn().mockImplementation(() => ({})),
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
			const debugProfile = getAgentProfile('debug');
			// The debug profile uses defaultProfile which returns all tools unfiltered; respond-to-ci filters them
			expect(profile).not.toBe(debugProfile);
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
			const debugProfile = getAgentProfile('debug');
			expect(profile).not.toBe(reviewProfile);
			expect(profile).not.toBe(debugProfile);
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

	it('throws for unknown agent types', () => {
		expect(() => getAgentProfile('nonexistent-agent')).toThrow(
			"Unknown agent type 'nonexistent-agent'",
		);
	});

	it('returns implementation profile with needsGitHubToken', () => {
		const profile = getAgentProfile('implementation');
		expect(profile.needsGitHubToken).toBe(true);
	});

	it('returns debug profile (defaultProfile)', () => {
		const profile = getAgentProfile('debug');
		// Debug uses defaultProfile — passes all tools through, no GitHub token
		const tools = [{ name: 'Anything', description: '', cliCommand: '', parameters: {} }];
		expect(profile.filterTools(tools)).toHaveLength(1);
		expect(profile.needsGitHubToken).toBe(false);
	});
});

describe('AgentProfile.getLlmistGadgets', () => {
	it('returns non-empty gadget array for implementation', () => {
		const profile = getAgentProfile('implementation');
		const gadgets = profile.getLlmistGadgets('implementation');
		expect(gadgets).toBeDefined();
		expect(gadgets.length).toBeGreaterThan(0);
	});

	it('returns non-empty gadget array for planning (read-only)', () => {
		const profile = getAgentProfile('planning');
		const gadgets = profile.getLlmistGadgets('planning');
		expect(gadgets).toBeDefined();
		expect(gadgets.length).toBeGreaterThan(0);
	});

	it('returns non-empty gadget array for review', () => {
		const profile = getAgentProfile('review');
		const gadgets = profile.getLlmistGadgets('review');
		expect(gadgets).toBeDefined();
		expect(gadgets.length).toBeGreaterThan(0);
	});

	it('returns non-empty gadget array for respond-to-ci', () => {
		const profile = getAgentProfile('respond-to-ci');
		const gadgets = profile.getLlmistGadgets('respond-to-ci');
		expect(gadgets).toBeDefined();
		expect(gadgets.length).toBeGreaterThan(0);
	});

	it('returns non-empty gadget array for respond-to-pr-comment', () => {
		const profile = getAgentProfile('respond-to-pr-comment');
		const gadgets = profile.getLlmistGadgets('respond-to-pr-comment');
		expect(gadgets).toBeDefined();
		expect(gadgets.length).toBeGreaterThan(0);
	});

	it('each profile has a getLlmistGadgets method', () => {
		const agentTypes = [
			'briefing',
			'planning',
			'implementation',
			'review',
			'respond-to-planning-comment',
			'respond-to-review',
			'respond-to-pr-comment',
			'respond-to-ci',
			'debug',
		];
		for (const agentType of agentTypes) {
			const profile = getAgentProfile(agentType);
			expect(profile.getLlmistGadgets).toBeDefined();
			expect(typeof profile.getLlmistGadgets).toBe('function');
		}
	});
});
