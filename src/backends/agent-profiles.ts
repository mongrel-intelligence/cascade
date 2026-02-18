import { execFileSync } from 'node:child_process';

import { type AgentCapabilities, getAgentCapabilities } from '../agents/shared/capabilities.js';
export type { AgentCapabilities } from '../agents/shared/capabilities.js';
import {
	formatPRComments,
	formatPRDetails,
	formatPRDiff,
	formatPRIssueComments,
	formatPRReviews,
	readPRFileContents,
} from '../agents/shared/prFormatting.js';
import type { ContextFile } from '../agents/utils/setup.js';
import { AstGrep } from '../gadgets/AstGrep.js';
import { FileMultiEdit } from '../gadgets/FileMultiEdit.js';
import { FileSearchAndReplace } from '../gadgets/FileSearchAndReplace.js';
import { Finish } from '../gadgets/Finish.js';
import { ListDirectory } from '../gadgets/ListDirectory.js';
import { ReadFile } from '../gadgets/ReadFile.js';
import { RipGrep } from '../gadgets/RipGrep.js';
import { Sleep } from '../gadgets/Sleep.js';
import { VerifyChanges } from '../gadgets/VerifyChanges.js';
import { WriteFile } from '../gadgets/WriteFile.js';
import { formatCheckStatus } from '../gadgets/github/core/getPRChecks.js';
import {
	CreatePR,
	GetPRChecks,
	GetPRComments,
	GetPRDetails,
	GetPRDiff,
	PostPRComment,
	ReplyToReviewComment,
	UpdatePRComment,
} from '../gadgets/github/index.js';
import { readWorkItem } from '../gadgets/pm/core/readWorkItem.js';
import {
	AddChecklist,
	CreateWorkItem,
	ListWorkItems,
	PMUpdateChecklistItem,
	PostComment,
	ReadWorkItem,
	UpdateWorkItem,
} from '../gadgets/pm/index.js';
import { Tmux } from '../gadgets/tmux.js';
import { TodoDelete, TodoUpdateStatus, TodoUpsert } from '../gadgets/todo/index.js';
import { githubClient } from '../github/client.js';
import type { AgentInput } from '../types/index.js';
import { resolveSquintDbPath } from '../utils/squintDb.js';
import type { ContextInjection, LogWriter, ToolManifest } from './types.js';

// ============================================================================
// Tool Name Sets
// ============================================================================

/** PM tools available to most agents */
const PM_TOOLS = [
	'ReadWorkItem',
	'PostComment',
	'UpdateWorkItem',
	'CreateWorkItem',
	'ListWorkItems',
	'AddChecklist',
];

/** PM checklist update — excluded from planning to prevent premature completion */
const PM_CHECKLIST_TOOL = 'UpdateChecklistItem';

/** GitHub review tools for code review agents */
const GITHUB_REVIEW_TOOLS = [
	'GetPRDetails',
	'GetPRDiff',
	'GetPRChecks',
	'GetPRComments',
	'PostPRComment',
	'UpdatePRComment',
	'ReplyToReviewComment',
	'CreatePRReview',
];

/** GitHub CI tools for respond-to-ci agent (no CreatePR — pushes to existing branch) */
const GITHUB_CI_TOOLS = [
	'GetPRDetails',
	'GetPRDiff',
	'GetPRChecks',
	'PostPRComment',
	'UpdatePRComment',
];

const SESSION_TOOL = 'Finish';

const ALL_SDK_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];
const READ_ONLY_SDK_TOOLS = ['Read', 'Bash', 'Glob', 'Grep'];

// ============================================================================
// AgentProfile Interface
// ============================================================================

interface FetchContextParams {
	input: AgentInput;
	repoDir: string;
	contextFiles: ContextFile[];
	logWriter: LogWriter;
}

interface PreExecuteParams {
	input: AgentInput;
	logWriter: LogWriter;
}

export interface AgentProfile {
	/** Filter the full set of tool manifests down to what this agent needs */
	filterTools(allTools: ToolManifest[]): ToolManifest[];
	/** SDK tools for Claude Code (subset of Read, Write, Edit, Bash, Glob, Grep) */
	sdkTools: string[];
	/** Whether to enable stop hooks that check for uncommitted/unpushed changes */
	enableStopHooks: boolean;
	/** Whether this profile needs the GitHub client for context fetching */
	needsGitHubToken: boolean;
	/** Whether to block git push in hooks (default: true — set false for agents on existing PR branches) */
	blockGitPush?: boolean;
	/** Fetch context injections for this agent type */
	fetchContext(params: FetchContextParams): Promise<ContextInjection[]>;
	/** Build the task prompt for this agent type */
	buildTaskPrompt(input: AgentInput): string;
	/** Optional pre-execute hook (e.g., post initial PR comment) */
	preExecute?(params: PreExecuteParams): Promise<void>;
	/** Capability summary — used by llmist backend to select gadgets */
	capabilities: AgentCapabilities;
	/**
	 * Return the gadget instances for the llmist backend.
	 * Each call creates fresh instances — caller must not reuse returned gadgets.
	 */
	getLlmistGadgets(agentType: string): unknown[];
}

// ============================================================================
// Llmist Gadget Builders
// ============================================================================

/**
 * Build the standard set of gadgets for work-item-based agents (briefing, planning,
 * implementation, debug). Mirrors the logic in agents/base.ts getBaseAgentGadgets().
 */
function buildWorkItemLlmistGadgets(caps: AgentCapabilities): unknown[] {
	return [
		// Filesystem gadgets
		new ListDirectory(),
		new ReadFile(),
		new RipGrep(),
		new AstGrep(),
		...(caps.canEditFiles
			? [new FileSearchAndReplace(), new FileMultiEdit(), new WriteFile(), new VerifyChanges()]
			: []),
		// Shell commands
		new Tmux(),
		new Sleep(),
		// Task tracking
		new TodoUpsert(),
		new TodoUpdateStatus(),
		new TodoDelete(),
		// GitHub PR creation (gated by capability)
		...(caps.canCreatePR ? [new CreatePR()] : []),
		// PM gadgets
		new ReadWorkItem(),
		new PostComment(),
		new UpdateWorkItem(),
		new CreateWorkItem(),
		new ListWorkItems(),
		new AddChecklist(),
		...(caps.canUpdateChecklists ? [new PMUpdateChecklistItem()] : []),
		// Session control
		new Finish(),
	];
}

/**
 * Build gadgets for PR-based agents (review, respond-to-review, respond-to-pr-comment).
 * Includes GitHub review tools, no file editing for pure review agents.
 */
function buildReviewLlmistGadgets(includeReviewComments = false): unknown[] {
	return [
		new ListDirectory(),
		new ReadFile(),
		new Tmux(),
		new Sleep(),
		new TodoUpsert(),
		new TodoUpdateStatus(),
		new TodoDelete(),
		new GetPRDetails(),
		new GetPRDiff(),
		new GetPRChecks(),
		new PostPRComment(),
		new UpdatePRComment(),
		...(includeReviewComments ? [new GetPRComments(), new ReplyToReviewComment()] : []),
		new Finish(),
	];
}

/**
 * Build gadgets for PR-modifying agents (respond-to-ci, respond-to-pr-comment).
 * Includes file editing + GitHub tools but NOT CreatePR (agents push to existing branches).
 */
function buildPRAgentLlmistGadgets(includeReviewComments = false): unknown[] {
	return [
		new ListDirectory(),
		new ReadFile(),
		new FileSearchAndReplace(),
		new FileMultiEdit(),
		new WriteFile(),
		new AstGrep(),
		new RipGrep(),
		new Tmux(),
		new Sleep(),
		new TodoUpsert(),
		new TodoUpdateStatus(),
		new TodoDelete(),
		new GetPRDetails(),
		new GetPRDiff(),
		new GetPRChecks(),
		new PostPRComment(),
		new UpdatePRComment(),
		...(includeReviewComments ? [new GetPRComments(), new ReplyToReviewComment()] : []),
		new Finish(),
	];
}

// ============================================================================
// Context Fetching Helpers
// ============================================================================

function filterToolsByNames(allTools: ToolManifest[], names: string[]): ToolManifest[] {
	const nameSet = new Set(names);
	return allTools.filter((t) => nameSet.has(t.name));
}

function fetchDirectoryListing(repoDir: string): ContextInjection {
	const listDirGadget = new ListDirectory();
	const params = {
		comment: 'Pre-fetching codebase structure for context',
		directoryPath: '.',
		maxDepth: 3,
		includeGitIgnored: false,
	};

	// ListDirectory uses process.cwd() — we need to be in repoDir
	const originalCwd = process.cwd();
	try {
		process.chdir(repoDir);
		const result = listDirGadget.execute(params);
		return {
			toolName: 'ListDirectory',
			params,
			result,
			description: 'Pre-fetched codebase structure',
		};
	} finally {
		process.chdir(originalCwd);
	}
}

function fetchContextFileInjections(contextFiles: ContextFile[]): ContextInjection[] {
	return contextFiles.map((file) => ({
		toolName: 'ReadFile',
		params: { comment: `Pre-fetching ${file.path} for project context`, filePath: file.path },
		result: file.content,
		description: `Pre-fetched ${file.path}`,
	}));
}

function fetchSquintOverview(repoDir: string): ContextInjection | null {
	const squintDb = resolveSquintDbPath(repoDir);
	if (!squintDb) return null;

	try {
		const output = execFileSync('squint', ['overview', '-d', squintDb], {
			encoding: 'utf-8',
			timeout: 30_000,
		});
		if (!output?.trim()) return null;

		return {
			toolName: 'SquintOverview',
			params: { comment: 'Pre-fetching Squint codebase overview for context', database: squintDb },
			result: output,
			description: 'Pre-fetched Squint codebase overview',
		};
	} catch {
		return null;
	}
}

async function fetchWorkItemInjection(cardId: string): Promise<ContextInjection | null> {
	try {
		const cardData = await readWorkItem(cardId, true);
		return {
			toolName: 'ReadWorkItem',
			params: { workItemId: cardId, includeComments: true },
			result: cardData,
			description: 'Pre-fetched work item data',
		};
	} catch {
		return null;
	}
}

/** Fetch PR context injections (ported from review.ts:93-144) */
async function fetchPRContextInjections(
	owner: string,
	repo: string,
	prNumber: number,
	repoDir: string,
	logWriter: LogWriter,
): Promise<{ injections: ContextInjection[]; skippedFiles: string[] }> {
	const injections: ContextInjection[] = [];

	logWriter('INFO', 'Fetching PR details, diff, and check status', { owner, repo, prNumber });

	const prDetails = await githubClient.getPR(owner, repo, prNumber);
	const prDiff = await githubClient.getPRDiff(owner, repo, prNumber);
	const checkStatus = await githubClient.getCheckSuiteStatus(owner, repo, prDetails.headSha);

	const prDetailsFormatted = formatPRDetails(prDetails);
	const diffFormatted = formatPRDiff(prDiff);
	const checkStatusFormatted = formatCheckStatus(prNumber, checkStatus);

	injections.push({
		toolName: 'GetPRDetails',
		params: { comment: 'Pre-fetching PR details for review context', owner, repo, prNumber },
		result: prDetailsFormatted,
		description: 'Pre-fetched PR details',
	});

	injections.push({
		toolName: 'GetPRDiff',
		params: { comment: 'Pre-fetching PR diff for code review', owner, repo, prNumber },
		result: diffFormatted,
		description: 'Pre-fetched PR diff',
	});

	injections.push({
		toolName: 'GetPRChecks',
		params: { comment: 'Pre-fetching CI check status for review', owner, repo, prNumber },
		result: checkStatusFormatted,
		description: 'Pre-fetched CI check status',
	});

	// Read full contents of changed files
	logWriter('INFO', 'Reading PR file contents', { fileCount: prDiff.length });
	const fileContents = await readPRFileContents(repoDir, prDiff);
	logWriter('INFO', 'File contents loaded', {
		included: fileContents.included.length,
		skipped: fileContents.skipped.length,
	});

	for (const file of fileContents.included) {
		injections.push({
			toolName: 'ReadFile',
			params: { comment: `Pre-fetching ${file.path} for review`, filePath: file.path },
			result: `path=${file.path}\n\n${file.content}`,
			description: `Pre-fetched ${file.path}`,
		});
	}

	return { injections, skippedFiles: fileContents.skipped };
}

// ============================================================================
// Common Context Builders
// ============================================================================

/** Standard context for work-item-based agents: dirListing + contextFiles + squint + workItem */
async function fetchWorkItemContext(params: FetchContextParams): Promise<ContextInjection[]> {
	const injections: ContextInjection[] = [];

	injections.push(fetchDirectoryListing(params.repoDir));
	injections.push(...fetchContextFileInjections(params.contextFiles));

	const squint = fetchSquintOverview(params.repoDir);
	if (squint) injections.push(squint);

	if (params.input.cardId) {
		const workItem = await fetchWorkItemInjection(params.input.cardId);
		if (workItem) injections.push(workItem);
	}

	return injections;
}

/** PR review context: PR details + diff + checks + file contents + contextFiles + squint */
async function fetchReviewContext(params: FetchContextParams): Promise<ContextInjection[]> {
	const injections: ContextInjection[] = [];

	const repoFullName = params.input.repoFullName as string;
	const prNumber = params.input.prNumber as number;
	const [owner, repo] = repoFullName.split('/');

	// PR context first (most relevant for review)
	const { injections: prInjections } = await fetchPRContextInjections(
		owner,
		repo,
		prNumber,
		params.repoDir,
		params.logWriter,
	);
	injections.push(...prInjections);

	// Then context files and squint for codebase understanding
	injections.push(...fetchContextFileInjections(params.contextFiles));

	const squint = fetchSquintOverview(params.repoDir);
	if (squint) injections.push(squint);

	return injections;
}

/** CI context: PR details + diff + checks + dirListing + contextFiles + squint + optional workItem */
async function fetchCIContext(params: FetchContextParams): Promise<ContextInjection[]> {
	const injections: ContextInjection[] = [];
	const repoFullName = params.input.repoFullName as string;
	const prNumber = params.input.prNumber as number;
	const [owner, repo] = repoFullName.split('/');

	// PR context (details, diff, checks) — most relevant for CI fixing
	const { injections: prInjections } = await fetchPRContextInjections(
		owner,
		repo,
		prNumber,
		params.repoDir,
		params.logWriter,
	);
	injections.push(...prInjections);

	// Codebase context
	injections.push(fetchDirectoryListing(params.repoDir));
	injections.push(...fetchContextFileInjections(params.contextFiles));

	const squint = fetchSquintOverview(params.repoDir);
	if (squint) injections.push(squint);

	// Work item context (if triggered from a Trello card)
	if (params.input.cardId) {
		const workItem = await fetchWorkItemInjection(params.input.cardId);
		if (workItem) injections.push(workItem);
	}

	return injections;
}

/** PR comment response context: PR details + diff + conversation + dirListing + contextFiles + squint */
async function fetchPRCommentResponseContext(
	params: FetchContextParams,
): Promise<ContextInjection[]> {
	const injections: ContextInjection[] = [];
	const repoFullName = params.input.repoFullName as string;
	const prNumber = params.input.prNumber as number;
	const [owner, repo] = repoFullName.split('/');

	// PR context (details, diff, checks)
	const { injections: prInjections } = await fetchPRContextInjections(
		owner,
		repo,
		prNumber,
		params.repoDir,
		params.logWriter,
	);
	injections.push(...prInjections);

	// Conversation context (review comments, reviews, issue comments)
	params.logWriter('INFO', 'Fetching PR conversation context', { owner, repo, prNumber });

	const [reviewComments, reviews, issueComments] = await Promise.all([
		githubClient.getPRReviewComments(owner, repo, prNumber),
		githubClient.getPRReviews(owner, repo, prNumber),
		githubClient.getPRIssueComments(owner, repo, prNumber),
	]);

	injections.push({
		toolName: 'GetPRComments',
		params: {
			comment: 'Pre-fetching PR review comments for conversation context',
			owner,
			repo,
			prNumber,
		},
		result: formatPRComments(reviewComments),
		description: 'Pre-fetched PR review comments',
	});

	injections.push({
		toolName: 'GetPRComments',
		params: { comment: 'Pre-fetching PR reviews for conversation context', owner, repo, prNumber },
		result: formatPRReviews(reviews),
		description: 'Pre-fetched PR reviews',
	});

	injections.push({
		toolName: 'GetPRComments',
		params: {
			comment: 'Pre-fetching PR issue comments for conversation context',
			owner,
			repo,
			prNumber,
		},
		result: formatPRIssueComments(issueComments),
		description: 'Pre-fetched PR issue comments',
	});

	// Codebase context
	injections.push(fetchDirectoryListing(params.repoDir));
	injections.push(...fetchContextFileInjections(params.contextFiles));

	const squint = fetchSquintOverview(params.repoDir);
	if (squint) injections.push(squint);

	return injections;
}

// ============================================================================
// Task Prompt Builders
// ============================================================================

function buildWorkItemTaskPrompt(input: AgentInput): string {
	return `Analyze and process the work item with ID: ${input.cardId || 'unknown'}. The work item data has been pre-loaded.`;
}

function buildCommentResponseTaskPrompt(input: AgentInput): string {
	const commentText = input.triggerCommentText as string;
	const commentAuthor = (input.triggerCommentAuthor as string) || 'unknown';
	return `A user (@${commentAuthor}) mentioned you in a comment on work item ${input.cardId || 'unknown'}.

Their comment:
---
${commentText}
---

The work item data (title, description, checklists, attachments, comments) has been pre-loaded above.
Read the user's comment carefully and respond accordingly. Default to surgical, targeted updates unless they clearly ask for a full rewrite.`;
}

function buildReviewTaskPrompt(input: AgentInput): string {
	const prNumber = input.prNumber as number;

	return `Review PR #${prNumber}.

Examine the code changes carefully and submit your review using CreatePRReview.`;
}

function buildCITaskPrompt(input: AgentInput): string {
	const prNumber = input.prNumber as number;
	const prBranch = input.prBranch as string;

	return `You are on the branch \`${prBranch}\` for PR #${prNumber}.

CI checks have failed. Analyze the failures and fix them.`;
}

function buildPRCommentResponseTaskPrompt(input: AgentInput): string {
	const prNumber = input.prNumber as number;
	const prBranch = input.prBranch as string;
	const commentBody = input.triggerCommentBody as string;
	const commentPath = input.triggerCommentPath as string;

	const pathContext = commentPath ? `\nFile: ${commentPath}` : '';

	return `You are on the branch \`${prBranch}\` for PR #${prNumber}.

A user commented on this PR and mentioned you. Respond to their comment.
${pathContext}

Their comment:
---
${commentBody}
---

Read the comment carefully and respond accordingly. If they ask for code changes, make the changes, commit, and push. If they ask a question, reply with a PR comment. Default to surgical, targeted changes unless they clearly ask for something broader.`;
}

// ============================================================================
// Agent Profiles
// ============================================================================

const briefingProfile: AgentProfile = {
	filterTools: (allTools) =>
		filterToolsByNames(allTools, [...PM_TOOLS, PM_CHECKLIST_TOOL, SESSION_TOOL]),
	sdkTools: ALL_SDK_TOOLS,
	enableStopHooks: false,
	needsGitHubToken: false,
	fetchContext: fetchWorkItemContext,
	buildTaskPrompt: buildWorkItemTaskPrompt,
	capabilities: getAgentCapabilities('briefing'),
	getLlmistGadgets: (agentType) => buildWorkItemLlmistGadgets(getAgentCapabilities(agentType)),
};

const planningProfile: AgentProfile = {
	filterTools: (allTools) => filterToolsByNames(allTools, [...PM_TOOLS, SESSION_TOOL]),
	sdkTools: READ_ONLY_SDK_TOOLS,
	enableStopHooks: false,
	needsGitHubToken: false,
	fetchContext: fetchWorkItemContext,
	buildTaskPrompt: buildWorkItemTaskPrompt,
	capabilities: getAgentCapabilities('planning'),
	getLlmistGadgets: (agentType) => buildWorkItemLlmistGadgets(getAgentCapabilities(agentType)),
};

const reviewProfile: AgentProfile = {
	filterTools: (allTools) => filterToolsByNames(allTools, [...GITHUB_REVIEW_TOOLS, SESSION_TOOL]),
	sdkTools: READ_ONLY_SDK_TOOLS,
	enableStopHooks: false,
	needsGitHubToken: true,
	fetchContext: fetchReviewContext,
	buildTaskPrompt: buildReviewTaskPrompt,
	capabilities: getAgentCapabilities('review'),
	getLlmistGadgets: (_agentType) => buildReviewLlmistGadgets(true),

	async preExecute({ input, logWriter }: PreExecuteParams): Promise<void> {
		const repoFullName = input.repoFullName as string;
		const prNumber = input.prNumber as number;
		const [owner, repo] = repoFullName.split('/');

		logWriter('INFO', 'Posting initial review comment', { owner, repo, prNumber });
		await githubClient.createPRComment(owner, repo, prNumber, '🔍 Reviewing PR...');
	},
};

const respondToPlanningCommentProfile: AgentProfile = {
	filterTools: (allTools) =>
		filterToolsByNames(allTools, [...PM_TOOLS, PM_CHECKLIST_TOOL, SESSION_TOOL]),
	sdkTools: READ_ONLY_SDK_TOOLS,
	enableStopHooks: false,
	needsGitHubToken: false,
	fetchContext: fetchWorkItemContext,
	buildTaskPrompt: buildCommentResponseTaskPrompt,
	capabilities: getAgentCapabilities('respond-to-planning-comment'),
	getLlmistGadgets: (agentType) => buildWorkItemLlmistGadgets(getAgentCapabilities(agentType)),
};

const respondToCIProfile: AgentProfile = {
	filterTools: (allTools) =>
		filterToolsByNames(allTools, [
			...GITHUB_CI_TOOLS,
			...PM_TOOLS,
			PM_CHECKLIST_TOOL,
			SESSION_TOOL,
		]),
	sdkTools: ALL_SDK_TOOLS,
	enableStopHooks: true,
	needsGitHubToken: true,
	blockGitPush: false,
	fetchContext: fetchCIContext,
	buildTaskPrompt: buildCITaskPrompt,
	capabilities: getAgentCapabilities('respond-to-ci'),
	getLlmistGadgets: (_agentType) => buildPRAgentLlmistGadgets(false),

	async preExecute({ input, logWriter }: PreExecuteParams): Promise<void> {
		const repoFullName = input.repoFullName as string;
		const prNumber = input.prNumber as number;
		const [owner, repo] = repoFullName.split('/');

		logWriter('INFO', 'Posting initial CI fix comment', { owner, repo, prNumber });
		await githubClient.createPRComment(
			owner,
			repo,
			prNumber,
			'🤖 Working on fixing CI failures...',
		);
	},
};

const respondToPRCommentProfile: AgentProfile = {
	filterTools: (allTools) => filterToolsByNames(allTools, [...GITHUB_REVIEW_TOOLS, SESSION_TOOL]),
	sdkTools: ALL_SDK_TOOLS,
	enableStopHooks: true,
	needsGitHubToken: true,
	blockGitPush: false,
	fetchContext: fetchPRCommentResponseContext,
	buildTaskPrompt: buildPRCommentResponseTaskPrompt,
	capabilities: getAgentCapabilities('respond-to-pr-comment'),
	getLlmistGadgets: (_agentType) => buildPRAgentLlmistGadgets(true),
};

const defaultProfile: AgentProfile = {
	filterTools: (allTools) => allTools,
	sdkTools: ALL_SDK_TOOLS,
	enableStopHooks: true,
	needsGitHubToken: false,
	fetchContext: fetchWorkItemContext,
	buildTaskPrompt: buildWorkItemTaskPrompt,
	capabilities: getAgentCapabilities('debug'),
	getLlmistGadgets: (agentType) => buildWorkItemLlmistGadgets(getAgentCapabilities(agentType)),
};

const implementationProfile: AgentProfile = {
	...defaultProfile,
	needsGitHubToken: true,
	capabilities: getAgentCapabilities('implementation'),
	getLlmistGadgets: (agentType) => buildWorkItemLlmistGadgets(getAgentCapabilities(agentType)),
};

// ============================================================================
// Profile Registry
// ============================================================================

const PROFILE_REGISTRY: Record<string, AgentProfile> = {
	briefing: briefingProfile,
	planning: planningProfile,
	implementation: implementationProfile,
	review: reviewProfile,
	'respond-to-planning-comment': respondToPlanningCommentProfile,
	'respond-to-review': reviewProfile,
	'respond-to-pr-comment': respondToPRCommentProfile,
	'respond-to-ci': respondToCIProfile,
	debug: defaultProfile,
};

export function getAgentProfile(agentType: string): AgentProfile {
	const profile = PROFILE_REGISTRY[agentType];
	if (!profile) {
		throw new Error(
			`Unknown agent type '${agentType}' — add it to PROFILE_REGISTRY in agent-profiles.ts`,
		);
	}
	return profile;
}
