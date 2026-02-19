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

/** Create a mock class with the given name so constructor.name works in assertions */
function mockClass(name: string) {
	const cls = { [name]: class {} }[name];
	return vi.fn().mockImplementation(() => new cls());
}

/** Create a mock class with the given name and extra properties */
function mockClassWith(name: string, props: Record<string, unknown>) {
	const cls = { [name]: class {} }[name];
	return vi.fn().mockImplementation(() => Object.assign(new cls(), props));
}

vi.mock('../../../src/gadgets/ListDirectory.js', () => ({
	ListDirectory: mockClassWith('ListDirectory', { execute: vi.fn(() => 'directory listing') }),
}));
vi.mock('../../../src/gadgets/ReadFile.js', () => ({
	ReadFile: mockClass('ReadFile'),
}));
vi.mock('../../../src/gadgets/RipGrep.js', () => ({
	RipGrep: mockClass('RipGrep'),
}));
vi.mock('../../../src/gadgets/AstGrep.js', () => ({
	AstGrep: mockClass('AstGrep'),
}));
vi.mock('../../../src/gadgets/FileSearchAndReplace.js', () => ({
	FileSearchAndReplace: mockClass('FileSearchAndReplace'),
}));
vi.mock('../../../src/gadgets/FileMultiEdit.js', () => ({
	FileMultiEdit: mockClass('FileMultiEdit'),
}));
vi.mock('../../../src/gadgets/WriteFile.js', () => ({
	WriteFile: mockClass('WriteFile'),
}));
vi.mock('../../../src/gadgets/VerifyChanges.js', () => ({
	VerifyChanges: mockClass('VerifyChanges'),
}));
vi.mock('../../../src/gadgets/tmux.js', () => ({
	Tmux: mockClass('Tmux'),
}));
vi.mock('../../../src/gadgets/Sleep.js', () => ({
	Sleep: mockClass('Sleep'),
}));
vi.mock('../../../src/gadgets/todo/index.js', () => ({
	TodoUpsert: mockClass('TodoUpsert'),
	TodoUpdateStatus: mockClass('TodoUpdateStatus'),
	TodoDelete: mockClass('TodoDelete'),
}));
vi.mock('../../../src/gadgets/Finish.js', () => ({
	Finish: mockClass('Finish'),
}));
vi.mock('../../../src/gadgets/github/index.js', () => ({
	CreatePR: mockClass('CreatePR'),
	CreatePRReview: mockClass('CreatePRReview'),
	GetPRChecks: mockClass('GetPRChecks'),
	GetPRComments: mockClass('GetPRComments'),
	GetPRDetails: mockClass('GetPRDetails'),
	GetPRDiff: mockClass('GetPRDiff'),
	PostPRComment: mockClass('PostPRComment'),
	ReplyToReviewComment: mockClass('ReplyToReviewComment'),
	UpdatePRComment: mockClass('UpdatePRComment'),
}));
vi.mock('../../../src/gadgets/pm/index.js', () => ({
	AddChecklist: mockClass('AddChecklist'),
	CreateWorkItem: mockClass('CreateWorkItem'),
	ListWorkItems: mockClass('ListWorkItems'),
	PMUpdateChecklistItem: mockClass('PMUpdateChecklistItem'),
	PostComment: mockClass('PostComment'),
	ReadWorkItem: mockClass('ReadWorkItem'),
	UpdateWorkItem: mockClass('UpdateWorkItem'),
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
	/** Helper to extract constructor names from gadget instances */
	function gadgetNames(gadgets: unknown[]): string[] {
		return gadgets.map((g) => (g as object).constructor.name);
	}

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

	it('implementation includes file editing, CreatePR, and PM gadgets', () => {
		const profile = getAgentProfile('implementation');
		const names = gadgetNames(profile.getLlmistGadgets('implementation'));

		// File editing gadgets (canEditFiles: true)
		expect(names).toContain('FileSearchAndReplace');
		expect(names).toContain('FileMultiEdit');
		expect(names).toContain('WriteFile');
		expect(names).toContain('VerifyChanges');
		// CreatePR (canCreatePR: true)
		expect(names).toContain('CreatePR');
		// PM gadgets
		expect(names).toContain('ReadWorkItem');
		expect(names).toContain('PMUpdateChecklistItem');
		// Session control
		expect(names).toContain('Finish');
	});

	it('planning excludes file editing, CreatePR, and checklist updates (read-only)', () => {
		const profile = getAgentProfile('planning');
		const names = gadgetNames(profile.getLlmistGadgets('planning'));

		// Read-only: no file editing
		expect(names).not.toContain('FileSearchAndReplace');
		expect(names).not.toContain('FileMultiEdit');
		expect(names).not.toContain('WriteFile');
		expect(names).not.toContain('VerifyChanges');
		// No CreatePR
		expect(names).not.toContain('CreatePR');
		// No checklist updates (canUpdateChecklists: false)
		expect(names).not.toContain('PMUpdateChecklistItem');
		// But still has read gadgets and PM read
		expect(names).toContain('ListDirectory');
		expect(names).toContain('ReadFile');
		expect(names).toContain('ReadWorkItem');
		expect(names).toContain('Finish');
	});

	it('review includes CreatePRReview and excludes file editing and PostPRComment', () => {
		const profile = getAgentProfile('review');
		const names = gadgetNames(profile.getLlmistGadgets('review'));

		// Core action: submit PR review
		expect(names).toContain('CreatePRReview');
		// PR context
		expect(names).toContain('GetPRDetails');
		expect(names).toContain('GetPRDiff');
		expect(names).toContain('GetPRChecks');
		expect(names).toContain('UpdatePRComment');
		// Read-only: no file editing
		expect(names).not.toContain('FileSearchAndReplace');
		expect(names).not.toContain('WriteFile');
		expect(names).not.toContain('CreatePR');
		// Review agent doesn't use PostPRComment (posts via CreatePRReview)
		expect(names).not.toContain('PostPRComment');
		expect(names).toContain('Finish');
	});

	it('respond-to-review includes file editing and review comment tools', () => {
		const profile = getAgentProfile('respond-to-review');
		const names = gadgetNames(profile.getLlmistGadgets('respond-to-review'));

		// File editing (respond-to-review makes code changes)
		expect(names).toContain('FileSearchAndReplace');
		expect(names).toContain('WriteFile');
		expect(names).toContain('VerifyChanges');
		// Review comment tools (includeReviewComments: true)
		expect(names).toContain('GetPRComments');
		expect(names).toContain('ReplyToReviewComment');
		// PR context
		expect(names).toContain('GetPRDetails');
		expect(names).toContain('GetPRDiff');
		// No CreatePR (pushes to existing branch)
		expect(names).not.toContain('CreatePR');
		expect(names).toContain('Finish');
	});

	it('respond-to-ci includes file editing but no review comment tools', () => {
		const profile = getAgentProfile('respond-to-ci');
		const names = gadgetNames(profile.getLlmistGadgets('respond-to-ci'));

		// File editing
		expect(names).toContain('FileSearchAndReplace');
		expect(names).toContain('WriteFile');
		expect(names).toContain('VerifyChanges');
		// PR context
		expect(names).toContain('GetPRDetails');
		expect(names).toContain('GetPRDiff');
		expect(names).toContain('GetPRChecks');
		// No review comment tools (includeReviewComments: false)
		expect(names).not.toContain('GetPRComments');
		expect(names).not.toContain('ReplyToReviewComment');
		// No CreatePR (pushes to existing branch)
		expect(names).not.toContain('CreatePR');
		expect(names).toContain('Finish');
	});

	it('respond-to-pr-comment includes file editing and review comment tools', () => {
		const profile = getAgentProfile('respond-to-pr-comment');
		const names = gadgetNames(profile.getLlmistGadgets('respond-to-pr-comment'));

		// File editing
		expect(names).toContain('FileSearchAndReplace');
		expect(names).toContain('WriteFile');
		expect(names).toContain('VerifyChanges');
		// Review comment tools (includeReviewComments: true)
		expect(names).toContain('GetPRComments');
		expect(names).toContain('ReplyToReviewComment');
		// No CreatePR
		expect(names).not.toContain('CreatePR');
		expect(names).toContain('Finish');
	});

	it('briefing includes file editing but not CreatePR', () => {
		const profile = getAgentProfile('briefing');
		const names = gadgetNames(profile.getLlmistGadgets('briefing'));

		// File editing (canEditFiles: true)
		expect(names).toContain('FileSearchAndReplace');
		expect(names).toContain('WriteFile');
		// No CreatePR (canCreatePR: false)
		expect(names).not.toContain('CreatePR');
		// PM gadgets including checklist updates
		expect(names).toContain('ReadWorkItem');
		expect(names).toContain('PMUpdateChecklistItem');
		expect(names).toContain('Finish');
	});
});
