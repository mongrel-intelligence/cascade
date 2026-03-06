import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock external dependencies used by agent-profiles.ts
vi.mock('../../../src/agents/shared/prFormatting.js', () => ({
	formatPRDetails: vi.fn(() => 'formatted-pr-details'),
	formatPRDiff: vi.fn(() => 'formatted-pr-diff'),
	formatPRComments: vi.fn(() => 'formatted-pr-comments'),
	formatPRReviews: vi.fn(() => 'formatted-pr-reviews'),
	formatPRIssueComments: vi.fn(() => 'formatted-pr-issue-comments'),
	readPRFileContents: vi.fn(() => Promise.resolve({ included: [], skipped: [] })),
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
	PMDeleteChecklistItem: mockClass('PMDeleteChecklistItem'),
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

vi.mock('../../../src/utils/squintDb.js', () => ({
	resolveSquintDbPath: vi.fn(() => null),
}));

// Mock agentMessages to avoid requiring initAgentMessages() in tests
vi.mock('../../../src/config/agentMessages.js', () => ({
	INITIAL_MESSAGES: new Proxy(
		{
			implementation:
				'**🚀 Implementing changes** — Writing code, running tests, and preparing a PR...',
			review: '**🔍 Reviewing code** — Examining the PR changes...',
			splitting: '**📋 Splitting plan** — Breaking down the plan...',
			'respond-to-ci': '**🔧 Fixing CI failures** — Analyzing the failed checks...',
			'respond-to-review': '**🔧 Responding to review** — Addressing feedback...',
		},
		{
			get(target, prop) {
				return (target as Record<string, string>)[prop as string] ?? '**⚙️ Working on it**...';
			},
		},
	),
	AGENT_LABELS: new Proxy(
		{},
		{
			get: () => ({ emoji: '⚙️', label: 'Progress Update' }),
		},
	),
	AGENT_ROLE_HINTS: new Proxy(
		{},
		{
			get: () => 'Processes the request',
		},
	),
	getAgentLabel: vi.fn(() => ({ emoji: '⚙️', label: 'Progress Update' })),
}));

vi.mock('node:child_process', () => ({
	execFileSync: vi.fn(() => 'squint overview output'),
}));

import { execFileSync } from 'node:child_process';
import { hasFinishValidation } from '../../../src/agents/definitions/profiles.js';
import {
	formatPRComments,
	formatPRDetails,
	formatPRDiff,
	formatPRIssueComments,
	formatPRReviews,
	readPRFileContents,
} from '../../../src/agents/shared/prFormatting.js';
import { type AgentProfile, getAgentProfile } from '../../../src/backends/agent-profiles.js';
import { readWorkItem } from '../../../src/gadgets/pm/core/readWorkItem.js';
import { githubClient } from '../../../src/github/client.js';
import { resolveSquintDbPath } from '../../../src/utils/squintDb.js';

const mockExecFileSync = vi.mocked(execFileSync);
const mockResolveSquintDbPath = vi.mocked(resolveSquintDbPath);
const mockReadWorkItem = vi.mocked(readWorkItem);

const mockGithub = vi.mocked(githubClient);

describe('getAgentProfile', () => {
	describe('respond-to-ci profile', () => {
		let profile: AgentProfile;

		beforeEach(async () => {
			profile = await getAgentProfile('respond-to-ci');
		});

		it('returns a dedicated profile (not defaultProfile)', async () => {
			const debugProfile = await getAgentProfile('debug');
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

		it('has SDK tools for code editing', () => {
			// SDK tools derived from capabilities - order may vary
			expect(new Set(profile.sdkTools)).toEqual(
				new Set(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']),
			);
		});

		it('has finish hooks requiring pushed changes', () => {
			expect(profile.finishHooks.requiresPushedChanges).toBe(true);
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
	});

	describe('respond-to-pr-comment profile', () => {
		let profile: AgentProfile;

		beforeEach(async () => {
			profile = await getAgentProfile('respond-to-pr-comment');
		});

		it('returns a dedicated profile (not reviewProfile or defaultProfile)', async () => {
			const reviewProfile = await getAgentProfile('review');
			const debugProfile = await getAgentProfile('debug');
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
			// respond-to-pr-comment has scm:comment but not scm:review
			expect(names).not.toContain('CreatePRReview');
			expect(names).toContain('Finish');
			expect(names).not.toContain('CreatePR');
		});

		it('has SDK tools for code editing', () => {
			// SDK tools derived from capabilities - order may vary
			expect(new Set(profile.sdkTools)).toEqual(
				new Set(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']),
			);
		});

		it('has finish hooks requiring pushed changes', () => {
			expect(profile.finishHooks.requiresPushedChanges).toBe(true);
		});

		it('needs GitHub token', () => {
			expect(profile.needsGitHubToken).toBe(true);
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

	it('rejects for unknown agent types', async () => {
		await expect(getAgentProfile('nonexistent-agent')).rejects.toThrow(
			"Failed to load agent profile for 'nonexistent-agent'",
		);
	});

	it('returns implementation profile with needsGitHubToken', async () => {
		const profile = await getAgentProfile('implementation');
		expect(profile.needsGitHubToken).toBe(true);
	});

	it('returns debug profile', async () => {
		const profile = await getAgentProfile('debug');
		// Debug has PM capabilities but no SCM
		const tools = [
			{ name: 'ReadWorkItem', description: '', cliCommand: '', parameters: {} },
			{ name: 'CreatePR', description: '', cliCommand: '', parameters: {} }, // Should be filtered out
		];
		const filtered = profile.filterTools(tools);
		expect(filtered.map((t) => t.name)).toContain('ReadWorkItem');
		expect(filtered.map((t) => t.name)).not.toContain('CreatePR');
		expect(profile.needsGitHubToken).toBe(false);
	});
});

describe('AgentProfile.getLlmistGadgets', () => {
	/** Helper to extract constructor names from gadget instances */
	function gadgetNames(gadgets: unknown[]): string[] {
		return gadgets.map((g) => (g as object).constructor.name);
	}

	it('each profile has a getLlmistGadgets method', async () => {
		const agentTypes = [
			'splitting',
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
			const profile = await getAgentProfile(agentType);
			expect(profile.getLlmistGadgets).toBeDefined();
			expect(typeof profile.getLlmistGadgets).toBe('function');
		}
	});

	it('implementation includes file editing, CreatePR, and PM gadgets', async () => {
		const profile = await getAgentProfile('implementation');
		const names = gadgetNames(profile.getLlmistGadgets());

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

	it('planning excludes file editing, CreatePR, and checklist updates (read-only)', async () => {
		const profile = await getAgentProfile('planning');
		const names = gadgetNames(profile.getLlmistGadgets());

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

	it('review includes CreatePRReview and excludes file editing', async () => {
		const profile = await getAgentProfile('review');
		const names = gadgetNames(profile.getLlmistGadgets());

		// Core action: submit PR review
		expect(names).toContain('CreatePRReview');
		// PR context
		expect(names).toContain('GetPRDetails');
		expect(names).toContain('GetPRDiff');
		expect(names).toContain('GetPRChecks');
		// With scm:comment capability, review agent gets all comment tools
		expect(names).toContain('PostPRComment');
		expect(names).toContain('UpdatePRComment');
		// Read-only: no file editing
		expect(names).not.toContain('FileSearchAndReplace');
		expect(names).not.toContain('WriteFile');
		expect(names).not.toContain('CreatePR');
		expect(names).toContain('Finish');
	});

	it('respond-to-review includes file editing and review comment tools', async () => {
		const profile = await getAgentProfile('respond-to-review');
		const names = gadgetNames(profile.getLlmistGadgets());

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

	it('respond-to-ci includes file editing and comment tools', async () => {
		const profile = await getAgentProfile('respond-to-ci');
		const names = gadgetNames(profile.getLlmistGadgets());

		// File editing
		expect(names).toContain('FileSearchAndReplace');
		expect(names).toContain('WriteFile');
		expect(names).toContain('VerifyChanges');
		// PR context
		expect(names).toContain('GetPRDetails');
		expect(names).toContain('GetPRDiff');
		expect(names).toContain('GetPRChecks');
		// With scm:comment capability, gets all comment tools
		expect(names).toContain('PostPRComment');
		expect(names).toContain('GetPRComments');
		// No CreatePR (pushes to existing branch)
		expect(names).not.toContain('CreatePR');
		expect(names).toContain('Finish');
	});

	it('respond-to-pr-comment includes file editing and review comment tools', async () => {
		const profile = await getAgentProfile('respond-to-pr-comment');
		const names = gadgetNames(profile.getLlmistGadgets());

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

	it('splitting includes file editing but not CreatePR', async () => {
		const profile = await getAgentProfile('splitting');
		const names = gadgetNames(profile.getLlmistGadgets());

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

// ============================================================================
// Context Fetching Tests
// ============================================================================

/**
 * Helper params for fetchContext calls.
 */
function makeContextParams(overrides: {
	cardId?: string;
	repoFullName?: string;
	prNumber?: number;
	contextFiles?: Array<{ path: string; content: string }>;
	triggerType?: string;
}): {
	input: Record<string, unknown>;
	repoDir: string;
	contextFiles: Array<{ path: string; content: string }>;
	logWriter: ReturnType<typeof vi.fn>;
} {
	return {
		input: {
			cardId: overrides.cardId,
			repoFullName: overrides.repoFullName ?? 'acme/widgets',
			prNumber: overrides.prNumber ?? 42,
			triggerType: overrides.triggerType,
			...overrides,
		},
		repoDir: '/repo',
		contextFiles: overrides.contextFiles ?? [],
		logWriter: vi.fn(),
	};
}

describe('fetchDirectoryListing', () => {
	it('splitting fetchContext returns a ListDirectory injection with maxDepth:3', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		const profile = await getAgentProfile('splitting');
		const params = makeContextParams({ cardId: undefined, triggerType: 'pm:status-changed' });

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		const dirInjection = injections.find((i) => i.toolName === 'ListDirectory');
		expect(dirInjection).toBeDefined();
		expect(dirInjection?.params).toMatchObject({
			directoryPath: '/repo',
			maxDepth: 3,
			includeGitIgnored: false,
		});
		expect(dirInjection?.result).toBe('directory listing');
	});
});

describe('fetchContextFileInjections', () => {
	it('returns ReadFile injections for each context file', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		const profile = await getAgentProfile('splitting');
		const params = makeContextParams({
			triggerType: 'pm:status-changed',
			contextFiles: [
				{ path: 'CLAUDE.md', content: 'project guidelines' },
				{ path: 'README.md', content: 'readme text' },
			],
		});

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		const readFileInjections = injections.filter((i) => i.toolName === 'ReadFile');
		expect(readFileInjections).toHaveLength(2);
		expect(readFileInjections[0].params).toMatchObject({ filePath: 'CLAUDE.md' });
		expect(readFileInjections[0].result).toBe('project guidelines');
		expect(readFileInjections[1].params).toMatchObject({ filePath: 'README.md' });
		expect(readFileInjections[1].result).toBe('readme text');
	});

	it('returns no ReadFile injections when contextFiles is empty', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		const profile = await getAgentProfile('splitting');
		const params = makeContextParams({ triggerType: 'pm:status-changed', contextFiles: [] });

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		const readFileInjections = injections.filter((i) => i.toolName === 'ReadFile');
		expect(readFileInjections).toHaveLength(0);
	});
});

describe('fetchSquintOverview', () => {
	it('returns SquintOverview injection when squint db is present', async () => {
		mockResolveSquintDbPath.mockReturnValue('/repo/.squint.db');
		mockExecFileSync.mockReturnValue('squint overview output\n');
		const profile = await getAgentProfile('splitting');
		const params = makeContextParams({ triggerType: 'pm:status-changed' });

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		const squintInjection = injections.find((i) => i.toolName === 'SquintOverview');
		expect(squintInjection).toBeDefined();
		expect(squintInjection?.result).toBe('squint overview output\n');
		expect(squintInjection?.params).toMatchObject({ database: '/repo/.squint.db' });
	});

	it('returns no SquintOverview injection when squint db is absent', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		const profile = await getAgentProfile('splitting');
		const params = makeContextParams({ triggerType: 'pm:status-changed' });

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		const squintInjection = injections.find((i) => i.toolName === 'SquintOverview');
		expect(squintInjection).toBeUndefined();
	});

	it('returns no SquintOverview injection when squint command throws', async () => {
		mockResolveSquintDbPath.mockReturnValue('/repo/.squint.db');
		mockExecFileSync.mockImplementation(() => {
			throw new Error('squint not found');
		});
		const profile = await getAgentProfile('splitting');
		const params = makeContextParams({ triggerType: 'pm:status-changed' });

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		const squintInjection = injections.find((i) => i.toolName === 'SquintOverview');
		expect(squintInjection).toBeUndefined();
	});

	it('returns no SquintOverview injection when squint output is empty', async () => {
		mockResolveSquintDbPath.mockReturnValue('/repo/.squint.db');
		mockExecFileSync.mockReturnValue('   ');
		const profile = await getAgentProfile('splitting');
		const params = makeContextParams({ triggerType: 'pm:status-changed' });

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		const squintInjection = injections.find((i) => i.toolName === 'SquintOverview');
		expect(squintInjection).toBeUndefined();
	});
});

describe('fetchWorkItemInjection', () => {
	it('returns ReadWorkItem injection when readWorkItem resolves', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		mockReadWorkItem.mockResolvedValue('# card title\n\ncard body');
		const profile = await getAgentProfile('splitting');
		const params = makeContextParams({ triggerType: 'pm:status-changed', cardId: 'card-123' });

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		const workItemInjection = injections.find((i) => i.toolName === 'ReadWorkItem');
		expect(workItemInjection).toBeDefined();
		expect(workItemInjection?.result).toBe('# card title\n\ncard body');
		expect(workItemInjection?.params).toMatchObject({
			workItemId: 'card-123',
			includeComments: true,
		});
		expect(mockReadWorkItem).toHaveBeenCalledWith('card-123', true);
	});

	it('skips injection when readWorkItem throws', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		mockReadWorkItem.mockRejectedValue(new Error('card not found'));
		const profile = await getAgentProfile('splitting');
		const params = makeContextParams({ triggerType: 'pm:status-changed', cardId: 'missing-card' });

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		const workItemInjection = injections.find((i) => i.toolName === 'ReadWorkItem');
		expect(workItemInjection).toBeUndefined();
	});

	it('never calls readWorkItem when cardId is absent', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		const profile = await getAgentProfile('splitting');
		const params = makeContextParams({ triggerType: 'pm:status-changed', cardId: undefined });

		await profile.fetchContext(params as Parameters<typeof profile.fetchContext>[0]);

		expect(mockReadWorkItem).not.toHaveBeenCalled();
	});
});

describe('fetchWorkItemContext orchestration', () => {
	it('includes dirListing, contextFiles, squint, and workItem in order', async () => {
		mockResolveSquintDbPath.mockReturnValue('/repo/.squint.db');
		mockExecFileSync.mockReturnValue('squint output\n');
		mockReadWorkItem.mockResolvedValue('card content');
		const profile = await getAgentProfile('splitting');
		const params = makeContextParams({
			triggerType: 'pm:status-changed',
			cardId: 'card-abc',
			contextFiles: [{ path: 'CLAUDE.md', content: 'guidelines' }],
		});

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		const toolNames = injections.map((i) => i.toolName);
		expect(toolNames).toContain('ListDirectory');
		expect(toolNames).toContain('ReadFile');
		expect(toolNames).toContain('SquintOverview');
		expect(toolNames).toContain('ReadWorkItem');

		// Ordering: dirListing first
		const dirIdx = toolNames.indexOf('ListDirectory');
		const readFileIdx = toolNames.indexOf('ReadFile');
		const squintIdx = toolNames.indexOf('SquintOverview');
		const workItemIdx = toolNames.indexOf('ReadWorkItem');
		expect(dirIdx).toBeLessThan(readFileIdx);
		expect(readFileIdx).toBeLessThan(squintIdx);
		expect(squintIdx).toBeLessThan(workItemIdx);
	});

	it('gracefully omits squint and workItem when unavailable', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		mockReadWorkItem.mockRejectedValue(new Error('unavailable'));
		const profile = await getAgentProfile('splitting');
		const params = makeContextParams({ triggerType: 'pm:status-changed', cardId: 'card-xyz' });

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		expect(injections.some((i) => i.toolName === 'SquintOverview')).toBe(false);
		expect(injections.some((i) => i.toolName === 'ReadWorkItem')).toBe(false);
		expect(injections.some((i) => i.toolName === 'ListDirectory')).toBe(true);
	});
});

describe('fetchReviewContext', () => {
	beforeEach(() => {
		mockGithub.getPR.mockResolvedValue({ headSha: 'sha123' } as never);
		mockGithub.getPRDiff.mockResolvedValue([]);
		mockGithub.getCheckSuiteStatus.mockResolvedValue({ checks: [] } as never);
		vi.mocked(readPRFileContents).mockResolvedValue({ included: [], skipped: [] });
	});

	it('includes PR injections (Details, Diff, Checks)', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		const profile = await getAgentProfile('review');
		const params = makeContextParams({
			triggerType: 'scm:check-suite-success',
			repoFullName: 'acme/widgets',
			prNumber: 42,
		});

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		const toolNames = injections.map((i) => i.toolName);
		expect(toolNames).toContain('GetPRDetails');
		expect(toolNames).toContain('GetPRDiff');
		expect(toolNames).toContain('GetPRChecks');
	});

	it('includes context file injections', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		const profile = await getAgentProfile('review');
		const params = makeContextParams({
			triggerType: 'scm:check-suite-success',
			repoFullName: 'acme/widgets',
			prNumber: 42,
			contextFiles: [{ path: 'CLAUDE.md', content: 'project info' }],
		});

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		const readFileInjections = injections.filter((i) => i.toolName === 'ReadFile');
		expect(readFileInjections).toHaveLength(1);
		expect(readFileInjections[0].params).toMatchObject({ filePath: 'CLAUDE.md' });
	});

	it('includes squint injection when squint db is present', async () => {
		mockResolveSquintDbPath.mockReturnValue('/repo/.squint.db');
		mockExecFileSync.mockReturnValue('squint content\n');
		const profile = await getAgentProfile('review');
		const params = makeContextParams({
			triggerType: 'scm:check-suite-success',
			repoFullName: 'acme/widgets',
			prNumber: 42,
		});

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		expect(injections.some((i) => i.toolName === 'SquintOverview')).toBe(true);
	});

	it('does NOT include a work item injection (review has no cardId)', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		const profile = await getAgentProfile('review');
		const params = makeContextParams({
			triggerType: 'scm:check-suite-success',
			repoFullName: 'acme/widgets',
			prNumber: 42,
		});

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		expect(injections.some((i) => i.toolName === 'ReadWorkItem')).toBe(false);
		expect(mockReadWorkItem).not.toHaveBeenCalled();
	});

	it('includes file content injections for included PR files', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		vi.mocked(readPRFileContents).mockResolvedValue({
			included: [{ path: 'src/index.ts', content: 'file content' }],
			skipped: [],
		});
		const profile = await getAgentProfile('review');
		const params = makeContextParams({
			triggerType: 'scm:check-suite-success',
			repoFullName: 'acme/widgets',
			prNumber: 42,
		});

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		const fileInjections = injections.filter(
			(i) =>
				i.toolName === 'ReadFile' &&
				typeof i.result === 'string' &&
				i.result.includes('src/index.ts'),
		);
		expect(fileInjections).toHaveLength(1);
	});

	it('calls formatting functions', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		const profile = await getAgentProfile('review');
		const params = makeContextParams({
			triggerType: 'scm:check-suite-success',
			repoFullName: 'acme/widgets',
			prNumber: 42,
		});

		await profile.fetchContext(params as Parameters<typeof profile.fetchContext>[0]);

		expect(vi.mocked(formatPRDetails)).toHaveBeenCalled();
		expect(vi.mocked(formatPRDiff)).toHaveBeenCalled();
	});
});

describe('fetchCIContext', () => {
	beforeEach(() => {
		mockGithub.getPR.mockResolvedValue({ headSha: 'sha456' } as never);
		mockGithub.getPRDiff.mockResolvedValue([]);
		mockGithub.getCheckSuiteStatus.mockResolvedValue({ checks: [] } as never);
		vi.mocked(readPRFileContents).mockResolvedValue({ included: [], skipped: [] });
	});

	it('includes PR injections, dirListing, contextFiles, squint, and workItem', async () => {
		mockResolveSquintDbPath.mockReturnValue('/repo/.squint.db');
		mockExecFileSync.mockReturnValue('squint ci output\n');
		mockReadWorkItem.mockResolvedValue('ci card content');
		const profile = await getAgentProfile('respond-to-ci');
		const params = makeContextParams({
			triggerType: 'scm:check-suite-failure',
			repoFullName: 'acme/widgets',
			prNumber: 5,
			cardId: 'ci-card',
			contextFiles: [{ path: 'CLAUDE.md', content: 'info' }],
		});

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		const toolNames = injections.map((i) => i.toolName);
		expect(toolNames).toContain('GetPRDetails');
		expect(toolNames).toContain('GetPRDiff');
		expect(toolNames).toContain('GetPRChecks');
		expect(toolNames).toContain('ListDirectory');
		expect(toolNames).toContain('ReadFile');
		expect(toolNames).toContain('SquintOverview');
		expect(toolNames).toContain('ReadWorkItem');
	});

	it('skips workItem injection when cardId is absent', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		const profile = await getAgentProfile('respond-to-ci');
		const params = makeContextParams({
			triggerType: 'scm:check-suite-failure',
			repoFullName: 'acme/widgets',
			prNumber: 5,
			cardId: undefined,
		});

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		expect(injections.some((i) => i.toolName === 'ReadWorkItem')).toBe(false);
		expect(mockReadWorkItem).not.toHaveBeenCalled();
	});
});

describe('fetchPRCommentResponseContext', () => {
	beforeEach(() => {
		mockGithub.getPR.mockResolvedValue({ headSha: 'sha789' } as never);
		mockGithub.getPRDiff.mockResolvedValue([]);
		mockGithub.getCheckSuiteStatus.mockResolvedValue({ checks: [] } as never);
		mockGithub.getPRReviewComments.mockResolvedValue([] as never);
		mockGithub.getPRReviews.mockResolvedValue([] as never);
		mockGithub.getPRIssueComments.mockResolvedValue([] as never);
		vi.mocked(readPRFileContents).mockResolvedValue({ included: [], skipped: [] });
	});

	it('includes PR injections and 3 conversation injections', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		const profile = await getAgentProfile('respond-to-pr-comment');
		const params = makeContextParams({
			triggerType: 'scm:pr-comment-mention',
			repoFullName: 'acme/widgets',
			prNumber: 7,
		});

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		const toolNames = injections.map((i) => i.toolName);
		expect(toolNames).toContain('GetPRDetails');
		expect(toolNames).toContain('GetPRDiff');
		expect(toolNames).toContain('GetPRChecks');

		// 3 conversation injections (all tagged as GetPRComments)
		const conversationInjections = injections.filter((i) => i.toolName === 'GetPRComments');
		expect(conversationInjections).toHaveLength(3);
	});

	it('includes dirListing, contextFiles, and squint', async () => {
		mockResolveSquintDbPath.mockReturnValue('/repo/.squint.db');
		mockExecFileSync.mockReturnValue('squint pr comment output\n');
		const profile = await getAgentProfile('respond-to-pr-comment');
		const params = makeContextParams({
			triggerType: 'scm:pr-comment-mention',
			repoFullName: 'acme/widgets',
			prNumber: 7,
			contextFiles: [{ path: 'AGENTS.md', content: 'agents doc' }],
		});

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		const toolNames = injections.map((i) => i.toolName);
		expect(toolNames).toContain('ListDirectory');
		expect(toolNames).toContain('ReadFile');
		expect(toolNames).toContain('SquintOverview');
	});

	it('calls all 3 formatting functions for conversation context', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		const profile = await getAgentProfile('respond-to-pr-comment');
		const params = makeContextParams({
			triggerType: 'scm:pr-comment-mention',
			repoFullName: 'acme/widgets',
			prNumber: 7,
		});

		await profile.fetchContext(params as Parameters<typeof profile.fetchContext>[0]);

		expect(vi.mocked(formatPRComments)).toHaveBeenCalled();
		expect(vi.mocked(formatPRReviews)).toHaveBeenCalled();
		expect(vi.mocked(formatPRIssueComments)).toHaveBeenCalled();
	});

	it('calls getPRReviewComments, getPRReviews, getPRIssueComments', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		const profile = await getAgentProfile('respond-to-pr-comment');
		const params = makeContextParams({
			triggerType: 'scm:pr-comment-mention',
			repoFullName: 'acme/widgets',
			prNumber: 7,
		});

		await profile.fetchContext(params as Parameters<typeof profile.fetchContext>[0]);

		expect(mockGithub.getPRReviewComments).toHaveBeenCalledWith('acme', 'widgets', 7);
		expect(mockGithub.getPRReviews).toHaveBeenCalledWith('acme', 'widgets', 7);
		expect(mockGithub.getPRIssueComments).toHaveBeenCalledWith('acme', 'widgets', 7);
	});
});

// ============================================================================
// resolveContextPipeline Edge Cases
// ============================================================================

describe('resolveContextPipeline edge cases', () => {
	it('returns empty array when triggerType is undefined', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		const profile = await getAgentProfile('implementation');
		const params = makeContextParams({ triggerType: undefined });

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		expect(injections).toHaveLength(0);
	});

	it('returns empty array when triggerType matches no trigger', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		const profile = await getAgentProfile('implementation');
		const params = makeContextParams({ triggerType: 'scm:unknown-event' });

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		expect(injections).toHaveLength(0);
	});

	it('handles agent with no triggers (debug)', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		const profile = await getAgentProfile('debug');
		const params = makeContextParams({ triggerType: undefined });

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		expect(injections).toHaveLength(0);
	});

	it('returns empty array when triggerType is empty string', async () => {
		mockResolveSquintDbPath.mockReturnValue(null);
		const profile = await getAgentProfile('implementation');
		const params = makeContextParams({ triggerType: '' });

		const injections = await profile.fetchContext(
			params as Parameters<typeof profile.fetchContext>[0],
		);

		expect(injections).toHaveLength(0);
	});
});

// ============================================================================
// hasFinishValidation
// ============================================================================

describe('hasFinishValidation', () => {
	it('returns true when requiresPR is set', () => {
		expect(hasFinishValidation({ requiresPR: true })).toBe(true);
	});

	it('returns true when requiresReview is set', () => {
		expect(hasFinishValidation({ requiresReview: true })).toBe(true);
	});

	it('returns true when requiresPushedChanges is set', () => {
		expect(hasFinishValidation({ requiresPushedChanges: true })).toBe(true);
	});

	it('returns false when only blockGitPush is set', () => {
		expect(hasFinishValidation({ blockGitPush: true })).toBe(false);
	});

	it('returns false for empty hooks', () => {
		expect(hasFinishValidation({})).toBe(false);
	});

	it('returns true when multiple finish requirements are set', () => {
		expect(hasFinishValidation({ requiresPR: true, requiresReview: true })).toBe(true);
	});
});
