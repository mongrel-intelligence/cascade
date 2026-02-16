import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { formatPRDetails, formatPRDiff } from '../agents/shared/prFormatting.js';
import type { ContextFile } from '../agents/utils/setup.js';
import { REVIEW_FILE_CONTENT_TOKEN_LIMIT, estimateTokens } from '../config/reviewConfig.js';
import { ListDirectory } from '../gadgets/ListDirectory.js';
import { formatCheckStatus } from '../gadgets/github/core/getPRChecks.js';
import { readWorkItem } from '../gadgets/pm/core/readWorkItem.js';
import { type PRDiffFile, githubClient } from '../github/client.js';
import type { AgentInput } from '../types/index.js';
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
	/** Fetch context injections for this agent type */
	fetchContext(params: FetchContextParams): Promise<ContextInjection[]>;
	/** Build the task prompt for this agent type */
	buildTaskPrompt(input: AgentInput): string;
	/** Optional pre-execute hook (e.g., post initial PR comment) */
	preExecute?(params: PreExecuteParams): Promise<void>;
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
	const squintDb = join(repoDir, '.squint.db');
	if (!existsSync(squintDb)) return null;

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

/** Read full contents of changed PR files up to token limit (ported from review.ts:53-79) */
async function readPRFileContents(
	repoDir: string,
	prDiff: PRDiffFile[],
): Promise<{ included: Array<{ path: string; content: string }>; skipped: string[] }> {
	const included: Array<{ path: string; content: string }> = [];
	const skipped: string[] = [];
	let totalTokens = 0;

	for (const file of prDiff) {
		if (file.status === 'removed' || !file.patch) continue;

		const filePath = join(repoDir, file.filename);
		try {
			const content = await readFile(filePath, 'utf-8');
			const tokens = estimateTokens(content);

			if (totalTokens + tokens <= REVIEW_FILE_CONTENT_TOKEN_LIMIT) {
				included.push({ path: file.filename, content });
				totalTokens += tokens;
			} else {
				skipped.push(file.filename);
			}
		} catch {
			// File might not exist (renamed from), skip
		}
	}

	return { included, skipped };
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
	const repoFullName = input.repoFullName as string;
	const prNumber = input.prNumber as number;
	const [owner, repo] = repoFullName.split('/');

	return `Review PR #${prNumber} in ${owner}/${repo}.

Examine the code changes carefully and submit your review using CreatePRReview.

## GitHub Context

Owner: ${owner}
Repo: ${repo}
PR Number: ${prNumber}

Use these values when calling GitHub tools (GetPRDetails, GetPRDiff, CreatePRReview).`;
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
};

const planningProfile: AgentProfile = {
	filterTools: (allTools) => filterToolsByNames(allTools, [...PM_TOOLS, SESSION_TOOL]),
	sdkTools: READ_ONLY_SDK_TOOLS,
	enableStopHooks: false,
	needsGitHubToken: false,
	fetchContext: fetchWorkItemContext,
	buildTaskPrompt: buildWorkItemTaskPrompt,
};

const reviewProfile: AgentProfile = {
	filterTools: (allTools) => filterToolsByNames(allTools, [...GITHUB_REVIEW_TOOLS, SESSION_TOOL]),
	sdkTools: READ_ONLY_SDK_TOOLS,
	enableStopHooks: false,
	needsGitHubToken: true,
	fetchContext: fetchReviewContext,
	buildTaskPrompt: buildReviewTaskPrompt,

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
};

const defaultProfile: AgentProfile = {
	filterTools: (allTools) => allTools,
	sdkTools: ALL_SDK_TOOLS,
	enableStopHooks: true,
	needsGitHubToken: false,
	fetchContext: fetchWorkItemContext,
	buildTaskPrompt: buildWorkItemTaskPrompt,
};

// ============================================================================
// Profile Registry
// ============================================================================

const PROFILE_REGISTRY: Record<string, AgentProfile> = {
	briefing: briefingProfile,
	planning: planningProfile,
	review: reviewProfile,
	'respond-to-planning-comment': respondToPlanningCommentProfile,
	'respond-to-review': reviewProfile,
	'respond-to-pr-comment': reviewProfile,
};

export function getAgentProfile(agentType: string): AgentProfile {
	return PROFILE_REGISTRY[agentType] ?? defaultProfile;
}
