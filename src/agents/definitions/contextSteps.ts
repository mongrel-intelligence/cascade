/**
 * Context pipeline step implementations and pre-execute hooks.
 *
 * Each step function takes a FetchContextParams and returns ContextInjection[].
 * These are the building blocks composed by the YAML contextPipeline arrays.
 */

import { execFileSync } from 'node:child_process';

import { INITIAL_MESSAGES } from '../../config/agentMessages.js';
import { ListDirectory } from '../../gadgets/ListDirectory.js';
import { formatCheckStatus } from '../../gadgets/github/core/getPRChecks.js';
import { readWorkItem } from '../../gadgets/pm/core/readWorkItem.js';
import { githubClient } from '../../github/client.js';
import type { AgentInput } from '../../types/index.js';
import { parseRepoFullName } from '../../utils/repo.js';
import { resolveSquintDbPath } from '../../utils/squintDb.js';
import type { ContextInjection, LogWriter } from '../contracts/index.js';
import {
	formatPRComments,
	formatPRDetails,
	formatPRDiff,
	formatPRIssueComments,
	formatPRReviews,
	readPRFileContents,
} from '../shared/prFormatting.js';
import type { ContextFile } from '../utils/setup.js';

// ============================================================================
// Shared interfaces
// ============================================================================

export interface FetchContextParams {
	input: AgentInput;
	repoDir: string;
	contextFiles: ContextFile[];
	logWriter: LogWriter;
}

export interface PreExecuteParams {
	input: AgentInput;
	logWriter: LogWriter;
}

// ============================================================================
// Atomic context step functions
// ============================================================================

export function fetchDirectoryListingStep(params: FetchContextParams): ContextInjection[] {
	const listDirGadget = new ListDirectory();
	const gadgetParams = {
		comment: 'Pre-fetching codebase structure for context',
		directoryPath: params.repoDir,
		maxDepth: 3,
		includeGitIgnored: false,
	};

	const result = listDirGadget.execute(gadgetParams);
	return [
		{
			toolName: 'ListDirectory',
			params: gadgetParams,
			result,
			description: 'Pre-fetched codebase structure',
		},
	];
}

export function fetchContextFilesStep(params: FetchContextParams): ContextInjection[] {
	return params.contextFiles.map((file) => ({
		toolName: 'ReadFile',
		params: { comment: `Pre-fetching ${file.path} for project context`, filePath: file.path },
		result: file.content,
		description: `Pre-fetched ${file.path}`,
	}));
}

export function fetchSquintStep(params: FetchContextParams): ContextInjection[] {
	const squintDb = resolveSquintDbPath(params.repoDir);
	if (!squintDb) return [];

	try {
		const output = execFileSync('squint', ['overview', '-d', squintDb], {
			encoding: 'utf-8',
			timeout: 30_000,
		});
		if (!output?.trim()) return [];

		return [
			{
				toolName: 'SquintOverview',
				params: {
					comment: 'Pre-fetching Squint codebase overview for context',
					database: squintDb,
				},
				result: output,
				description: 'Pre-fetched Squint codebase overview',
			},
		];
	} catch {
		return [];
	}
}

export async function fetchWorkItemStep(params: FetchContextParams): Promise<ContextInjection[]> {
	if (!params.input.cardId) return [];
	try {
		const cardData = await readWorkItem(params.input.cardId, true);
		return [
			{
				toolName: 'ReadWorkItem',
				params: { workItemId: params.input.cardId, includeComments: true },
				result: cardData,
				description: 'Pre-fetched work item data',
			},
		];
	} catch {
		return [];
	}
}

export async function fetchPRContextStep(params: FetchContextParams): Promise<ContextInjection[]> {
	const { repoFullName, prNumber } = params.input;
	if (!repoFullName || !prNumber) {
		throw new Error('fetchPRContextStep requires repoFullName and prNumber in input');
	}
	const injections: ContextInjection[] = [];
	const { owner, repo } = parseRepoFullName(repoFullName);

	params.logWriter('INFO', 'Fetching PR details, diff, and check status', {
		owner,
		repo,
		prNumber,
	});

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
	params.logWriter('INFO', 'Reading PR file contents', { fileCount: prDiff.length });
	const fileContents = await readPRFileContents(params.repoDir, prDiff);
	params.logWriter('INFO', 'File contents loaded', {
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

	return injections;
}

export async function fetchPRConversationStep(
	params: FetchContextParams,
): Promise<ContextInjection[]> {
	const { repoFullName, prNumber } = params.input;
	if (!repoFullName || !prNumber) {
		throw new Error('fetchPRConversationStep requires repoFullName and prNumber in input');
	}
	const injections: ContextInjection[] = [];
	const { owner, repo } = parseRepoFullName(repoFullName);

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
		params: {
			comment: 'Pre-fetching PR reviews for conversation context',
			owner,
			repo,
			prNumber,
		},
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

	return injections;
}

export function fetchEmailsFromInputStep(params: FetchContextParams): ContextInjection[] {
	const emails = params.input.preFoundEmails;
	if (!emails || emails.length === 0) return [];

	const lines = [`Found ${emails.length} email(s):`, ''];
	emails.forEach((email, i) => {
		const dateStr = email.date.toISOString().split('T')[0];
		lines.push(`${i + 1}. [UID:${email.uid}] ${dateStr} - "${email.subject}" from ${email.from}`);
	});

	const senderEmail = params.input.senderEmail;
	const criteria: Record<string, unknown> = { unseen: true };
	if (senderEmail) criteria.from = senderEmail;

	return [
		{
			toolName: 'SearchEmails',
			params: {
				comment: 'Pre-fetched unread emails before agent start',
				folder: 'INBOX',
				criteria,
				maxResults: 10,
			},
			result: lines.join('\n'),
			description: `Pre-fetched ${emails.length} unread email(s)`,
		},
	];
}

// ============================================================================
// Pre-execute hooks
// ============================================================================

export async function postInitialPRCommentHook(
	agentType: string,
	{ input, logWriter }: PreExecuteParams,
): Promise<void> {
	// Skip if ack comment already posted by router or webhook handler
	if (input.ackCommentId) return;

	const { repoFullName, prNumber } = input;
	if (!repoFullName || !prNumber) {
		throw new Error('postInitialPRCommentHook requires repoFullName and prNumber in input');
	}
	const { owner, repo } = parseRepoFullName(repoFullName);

	const message = (input.ackMessage as string | undefined) ?? INITIAL_MESSAGES[agentType];
	logWriter('INFO', `Posting initial ${agentType} comment`, { owner, repo, prNumber });
	await githubClient.createPRComment(owner, repo, prNumber, message);
}
