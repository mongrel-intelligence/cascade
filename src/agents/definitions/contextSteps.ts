/**
 * Context pipeline step implementations and pre-execute hooks.
 *
 * Each step function takes a FetchContextParams and returns ContextInjection[].
 * These are the building blocks composed by the YAML contextPipeline arrays.
 */

import { execFileSync } from 'node:child_process';

import { ListDirectory } from '../../gadgets/ListDirectory.js';
import { formatCheckStatus } from '../../gadgets/github/core/getPRChecks.js';
import { readWorkItem } from '../../gadgets/pm/core/readWorkItem.js';
import {
	formatTodoList,
	getNextId,
	initTodoSession,
	saveTodos,
} from '../../gadgets/todo/storage.js';
import type { Todo } from '../../gadgets/todo/storage.js';
import { githubClient } from '../../github/client.js';
import { getJiraConfig, getTrelloConfig } from '../../pm/config.js';
import { getPMProviderOrNull } from '../../pm/index.js';
import type { AgentInput, ProjectConfig } from '../../types/index.js';
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
	/** Optional project config for steps that need list IDs (e.g. pipelineSnapshot) */
	project?: ProjectConfig;
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
	if (!params.input.workItemId) return [];
	try {
		const cardData = await readWorkItem(params.input.workItemId, true);
		return [
			{
				toolName: 'ReadWorkItem',
				params: { workItemId: params.input.workItemId, includeComments: true },
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

export async function prepopulateTodosStep(
	params: FetchContextParams,
): Promise<ContextInjection[]> {
	const { workItemId } = params.input;
	if (!workItemId) return [];

	try {
		const provider = getPMProviderOrNull();
		if (!provider) return [];

		const checklists = await provider.getChecklists(workItemId);

		// Find checklist whose name includes "Implementation Steps" (case-insensitive, handles emoji prefix)
		const implChecklist = checklists.find((cl) =>
			cl.name.toLowerCase().includes('implementation steps'),
		);
		if (!implChecklist || implChecklist.items.length === 0) return [];

		// Extract incomplete items
		const incompleteItems = implChecklist.items.filter((item) => !item.complete);
		if (incompleteItems.length === 0) return [];

		// Initialize todo session and create todos
		initTodoSession(workItemId);
		const todos: Todo[] = [];
		const now = new Date().toISOString();

		for (const item of incompleteItems) {
			const id = getNextId(todos);
			todos.push({
				id,
				content: item.name,
				status: 'pending',
				createdAt: now,
				updatedAt: now,
			});
		}

		saveTodos(todos);

		const result = `Pre-populated from work item's Implementation Steps checklist. Do NOT delete or recreate these.\n\n${formatTodoList(todos)}`;

		return [
			{
				toolName: 'TodoUpsert',
				params: { comment: 'Pre-populated todos from Implementation Steps checklist' },
				result,
				description: `Pre-populated ${todos.length} todos from Implementation Steps`,
			},
		];
	} catch (error) {
		params.logWriter('WARN', 'prepopulateTodosStep failed', {
			workItemId,
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}

// ============================================================================
// Pipeline Snapshot Step
// ============================================================================

/**
 * Named list entries used in the pipeline snapshot.
 */
interface PipelineList {
	name: string;
	id: string;
}

interface PipelineListResult {
	list: PipelineList;
	items: Awaited<
		ReturnType<NonNullable<ReturnType<typeof getPMProviderOrNull>>['listWorkItems']>
	> | null;
	error: string | null;
}

const PIPELINE_DETAIL_LISTS = new Set(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW']);
const PIPELINE_DETAIL_CONCURRENCY = 5;

function buildPipelineLists(project: ProjectConfig): PipelineList[] {
	const trelloConfig = getTrelloConfig(project);
	const jiraConfig = getJiraConfig(project);
	const lists: PipelineList[] = [];

	const addList = (name: string, id: string | undefined): void => {
		if (id) lists.push({ name, id });
	};

	addList('BACKLOG', trelloConfig?.lists?.backlog ?? jiraConfig?.statuses?.backlog);
	addList('TODO', trelloConfig?.lists?.todo ?? jiraConfig?.statuses?.todo);
	addList('IN_PROGRESS', trelloConfig?.lists?.inProgress ?? jiraConfig?.statuses?.inProgress);
	addList('IN_REVIEW', trelloConfig?.lists?.inReview ?? jiraConfig?.statuses?.inReview);
	addList('DONE', trelloConfig?.lists?.done ?? jiraConfig?.statuses?.done);
	addList('MERGED', trelloConfig?.lists?.merged ?? jiraConfig?.statuses?.merged);

	return lists;
}

async function fetchPipelineLists(
	lists: PipelineList[],
	provider: NonNullable<ReturnType<typeof getPMProviderOrNull>>,
	logWriter: LogWriter,
): Promise<PipelineListResult[]> {
	return Promise.all(
		lists.map(async (list) => {
			try {
				const items = await provider.listWorkItems(list.id);
				return { list, items, error: null };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logWriter('WARN', `fetchPipelineSnapshotStep: Failed to fetch list ${list.name}`, {
					listId: list.id,
					error: message,
				});
				return { list, items: null, error: message };
			}
		}),
	);
}

function collectItemsNeedingFullDetails(listResults: PipelineListResult[]): Array<{ id: string }> {
	return listResults.flatMap(({ list, items }) =>
		!items || !PIPELINE_DETAIL_LISTS.has(list.name) ? [] : items.map((item) => ({ id: item.id })),
	);
}

async function fetchFullPipelineDetails(
	items: Array<{ id: string }>,
	logWriter: LogWriter,
): Promise<Map<string, string>> {
	const fullDetails = new Map<string, string>();

	for (let i = 0; i < items.length; i += PIPELINE_DETAIL_CONCURRENCY) {
		const batch = items.slice(i, i + PIPELINE_DETAIL_CONCURRENCY);
		await Promise.all(
			batch.map(async ({ id }) => {
				try {
					const details = await readWorkItem(id, true);
					fullDetails.set(id, details);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					logWriter('WARN', 'fetchPipelineSnapshotStep: Failed to read card details', {
						workItemId: id,
						error: message,
					});
					fullDetails.set(id, `Error reading details: ${message}`);
				}
			}),
		);
	}

	return fullDetails;
}

function appendPipelineSection(
	sections: string[],
	listResult: PipelineListResult,
	fullDetails: Map<string, string>,
): void {
	const { list, items, error } = listResult;

	sections.push(`## ${list.name} (list ID: ${list.id})`);
	sections.push('');

	if (error) {
		sections.push(`_Failed to fetch: ${error}_`);
		sections.push('');
		return;
	}

	if (!items || items.length === 0) {
		sections.push('_Empty — no items_');
		sections.push('');
		return;
	}

	sections.push(`${items.length} item(s):`);
	sections.push('');

	if (!PIPELINE_DETAIL_LISTS.has(list.name)) {
		for (const item of items) {
			sections.push(`- [${item.id}] ${item.title}`);
		}
		sections.push('');
		return;
	}

	for (const item of items) {
		const details = fullDetails.get(item.id);
		if (details) {
			sections.push(`### [${item.id}] ${item.title}`);
			sections.push('');
			sections.push(details);
			sections.push('');
			continue;
		}

		sections.push(`- [${item.id}] ${item.title} _(details unavailable)_`);
	}
}

/**
 * Fetch full contents of all pipeline lists (BACKLOG, TODO, IN_PROGRESS, IN_REVIEW, DONE, MERGED)
 * and inject them as a structured snapshot into agent context.
 *
 * This allows the backlog-manager agent to make decisions without making additional
 * ListWorkItems or ReadWorkItem calls — the full pipeline state is pre-loaded.
 */
export async function fetchPipelineSnapshotStep(
	params: FetchContextParams,
): Promise<ContextInjection[]> {
	const provider = getPMProviderOrNull();
	if (!provider) {
		params.logWriter('WARN', 'fetchPipelineSnapshotStep: No PM provider in scope, skipping');
		return [];
	}

	const project = params.project;
	if (!project) {
		params.logWriter('WARN', 'fetchPipelineSnapshotStep: No project config available, skipping');
		return [];
	}

	const lists = buildPipelineLists(project);
	if (lists.length === 0) {
		params.logWriter('WARN', 'fetchPipelineSnapshotStep: No pipeline lists configured, skipping');
		return [];
	}

	const listResults = await fetchPipelineLists(lists, provider, params.logWriter);
	const itemsNeedingFullDetails = collectItemsNeedingFullDetails(listResults);
	const fullDetails = await fetchFullPipelineDetails(itemsNeedingFullDetails, params.logWriter);

	// Format the snapshot
	const sections: string[] = ['# Pipeline Snapshot', ''];

	for (const listResult of listResults) {
		appendPipelineSection(sections, listResult, fullDetails);
	}

	const result = sections.join('\n');

	return [
		{
			toolName: 'PipelineSnapshot',
			params: { comment: 'Pre-fetched full pipeline snapshot across all lists' },
			result,
			description: `Pre-fetched pipeline snapshot (${lists.length} lists, ${itemsNeedingFullDetails.length} items with full details)`,
		},
	];
}
