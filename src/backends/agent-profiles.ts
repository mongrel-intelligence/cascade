import { execFileSync } from 'node:child_process';

import { type AgentCapabilities, getAgentCapabilities } from '../agents/shared/capabilities.js';
export type { AgentCapabilities } from '../agents/shared/capabilities.js';
import {
	buildPRAgentGadgets,
	buildReviewGadgets,
	buildWorkItemGadgets,
} from '../agents/shared/gadgets.js';
import {
	formatPRComments,
	formatPRDetails,
	formatPRDiff,
	formatPRIssueComments,
	formatPRReviews,
	readPRFileContents,
} from '../agents/shared/prFormatting.js';
import {
	buildCIResponsePrompt,
	buildCommentResponsePrompt,
	buildPRCommentResponsePrompt,
	buildReviewPrompt,
	buildWorkItemPrompt,
} from '../agents/shared/taskPrompts.js';
import type { ContextFile } from '../agents/utils/setup.js';
import { INITIAL_MESSAGES } from '../config/agentMessages.js';
import { ListDirectory } from '../gadgets/ListDirectory.js';
import { formatCheckStatus } from '../gadgets/github/core/getPRChecks.js';
import { readWorkItem } from '../gadgets/pm/core/readWorkItem.js';
import { githubClient } from '../github/client.js';
import type { AgentInput } from '../types/index.js';
import { parseRepoFullName } from '../utils/repo.js';
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
// All three builder functions below delegate to the shared gadget factories in
// agents/shared/gadgets.ts, which serve as the single source of truth for tool
// sets used by both the llmist backend and the Claude Code backend.
// ============================================================================

// ============================================================================
// Context Fetching Helpers
// ============================================================================

function filterToolsByNames(allTools: ToolManifest[], names: string[]): ToolManifest[] {
	const nameSet = new Set(names);
	return allTools.filter((t) => nameSet.has(t.name));
}

function fetchDirectoryListing(repoDir: string): ContextInjection {
	const listDirGadget = new ListDirectory();
	// Pass the absolute repoDir path so ListDirectory resolves correctly
	// without requiring process.chdir(), which is a dangerous side effect.
	const params = {
		comment: 'Pre-fetching codebase structure for context',
		directoryPath: repoDir,
		maxDepth: 3,
		includeGitIgnored: false,
	};

	const result = listDirGadget.execute(params);
	return {
		toolName: 'ListDirectory',
		params,
		result,
		description: 'Pre-fetched codebase structure',
	};
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
	const { owner, repo } = parseRepoFullName(repoFullName);

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
	const { owner, repo } = parseRepoFullName(repoFullName);

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
	const { owner, repo } = parseRepoFullName(repoFullName);

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
// Task Prompt Builders (thin wrappers around shared/taskPrompts.ts)
// ============================================================================

function buildWorkItemTaskPrompt(input: AgentInput): string {
	return buildWorkItemPrompt(input.cardId || 'unknown');
}

function buildCommentResponseTaskPrompt(input: AgentInput): string {
	const commentText = input.triggerCommentText as string;
	const commentAuthor = (input.triggerCommentAuthor as string) || 'unknown';
	return buildCommentResponsePrompt(input.cardId || 'unknown', commentText, commentAuthor);
}

function buildReviewTaskPrompt(input: AgentInput): string {
	return buildReviewPrompt(input.prNumber as number);
}

function buildCITaskPrompt(input: AgentInput): string {
	return buildCIResponsePrompt(input.prBranch as string, input.prNumber as number);
}

function buildPRCommentResponseTaskPrompt(input: AgentInput): string {
	return buildPRCommentResponsePrompt(
		input.prBranch as string,
		input.prNumber as number,
		input.triggerCommentBody as string,
		(input.triggerCommentPath as string) || undefined,
	);
}

// ============================================================================
// Agent Profiles
// ============================================================================

const splittingProfile: AgentProfile = {
	filterTools: (allTools) =>
		filterToolsByNames(allTools, [...PM_TOOLS, PM_CHECKLIST_TOOL, SESSION_TOOL]),
	sdkTools: ALL_SDK_TOOLS,
	enableStopHooks: false,
	needsGitHubToken: false,
	fetchContext: fetchWorkItemContext,
	buildTaskPrompt: buildWorkItemTaskPrompt,
	capabilities: getAgentCapabilities('splitting'),
	getLlmistGadgets: (agentType) => buildWorkItemGadgets(getAgentCapabilities(agentType)),
};

const planningProfile: AgentProfile = {
	filterTools: (allTools) => filterToolsByNames(allTools, [...PM_TOOLS, SESSION_TOOL]),
	sdkTools: READ_ONLY_SDK_TOOLS,
	enableStopHooks: false,
	needsGitHubToken: false,
	fetchContext: fetchWorkItemContext,
	buildTaskPrompt: buildWorkItemTaskPrompt,
	capabilities: getAgentCapabilities('planning'),
	getLlmistGadgets: (agentType) => buildWorkItemGadgets(getAgentCapabilities(agentType)),
};

const reviewProfile: AgentProfile = {
	filterTools: (allTools) => filterToolsByNames(allTools, [...GITHUB_REVIEW_TOOLS, SESSION_TOOL]),
	sdkTools: READ_ONLY_SDK_TOOLS,
	enableStopHooks: false,
	needsGitHubToken: true,
	fetchContext: fetchReviewContext,
	buildTaskPrompt: buildReviewTaskPrompt,
	capabilities: getAgentCapabilities('review'),
	getLlmistGadgets: (_agentType) => buildReviewGadgets(),

	async preExecute({ input, logWriter }: PreExecuteParams): Promise<void> {
		// Skip if ack comment already posted by router or webhook handler
		if (input.ackCommentId) return;

		const repoFullName = input.repoFullName as string;
		const prNumber = input.prNumber as number;
		const { owner, repo } = parseRepoFullName(repoFullName);

		const message = (input.ackMessage as string | undefined) ?? INITIAL_MESSAGES.review;
		logWriter('INFO', 'Posting initial review comment', { owner, repo, prNumber });
		await githubClient.createPRComment(owner, repo, prNumber, message);
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
	getLlmistGadgets: (agentType) => buildWorkItemGadgets(getAgentCapabilities(agentType)),
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
	getLlmistGadgets: (_agentType) => buildPRAgentGadgets(),

	async preExecute({ input, logWriter }: PreExecuteParams): Promise<void> {
		// Skip if ack comment already posted by router or webhook handler
		if (input.ackCommentId) return;

		const repoFullName = input.repoFullName as string;
		const prNumber = input.prNumber as number;
		const { owner, repo } = parseRepoFullName(repoFullName);

		const message = (input.ackMessage as string | undefined) ?? INITIAL_MESSAGES['respond-to-ci'];
		logWriter('INFO', 'Posting initial CI fix comment', { owner, repo, prNumber });
		await githubClient.createPRComment(owner, repo, prNumber, message);
	},
};

const respondToReviewProfile: AgentProfile = {
	filterTools: (allTools) => filterToolsByNames(allTools, [...GITHUB_REVIEW_TOOLS, SESSION_TOOL]),
	sdkTools: ALL_SDK_TOOLS,
	enableStopHooks: true,
	needsGitHubToken: true,
	blockGitPush: false,
	fetchContext: fetchPRCommentResponseContext,
	buildTaskPrompt: buildPRCommentResponseTaskPrompt,
	capabilities: getAgentCapabilities('respond-to-review'),
	getLlmistGadgets: (_agentType) => buildPRAgentGadgets({ includeReviewComments: true }),
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
	getLlmistGadgets: (_agentType) => buildPRAgentGadgets({ includeReviewComments: true }),
};

const defaultProfile: AgentProfile = {
	filterTools: (allTools) => allTools,
	sdkTools: ALL_SDK_TOOLS,
	enableStopHooks: true,
	needsGitHubToken: false,
	fetchContext: fetchWorkItemContext,
	buildTaskPrompt: buildWorkItemTaskPrompt,
	capabilities: getAgentCapabilities('debug'),
	getLlmistGadgets: (agentType) => buildWorkItemGadgets(getAgentCapabilities(agentType)),
};

const implementationProfile: AgentProfile = {
	...defaultProfile,
	needsGitHubToken: true,
	capabilities: getAgentCapabilities('implementation'),
	getLlmistGadgets: (agentType) => buildWorkItemGadgets(getAgentCapabilities(agentType)),
};

// ============================================================================
// Profile Registry
// ============================================================================

const PROFILE_REGISTRY: Record<string, AgentProfile> = {
	splitting: splittingProfile,
	planning: planningProfile,
	implementation: implementationProfile,
	review: reviewProfile,
	'respond-to-planning-comment': respondToPlanningCommentProfile,
	'respond-to-review': respondToReviewProfile,
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
