/**
 * Context pipeline step implementations and pre-execute hooks.
 *
 * Each step function takes a FetchContextParams and returns ContextInjection[].
 * These are the building blocks composed by the YAML contextPipeline arrays.
 */

import { formatCheckStatus } from '../../gadgets/github/core/getPRChecks.js';
import { ListDirectory } from '../../gadgets/ListDirectory.js';
import { readWorkItem, readWorkItemWithMedia } from '../../gadgets/pm/core/readWorkItem.js';
import { formatSentryEvent } from '../../gadgets/sentry/core/format.js';
import type { Todo } from '../../gadgets/todo/storage.js';
import {
	formatTodoList,
	getNextId,
	initTodoSession,
	saveTodos,
} from '../../gadgets/todo/storage.js';
import { githubClient } from '../../github/client.js';
import { getJiraConfig, getLinearConfig, getTrelloConfig } from '../../pm/config.js';
import { getPMProviderOrNull, MAX_IMAGES_PER_WORK_ITEM } from '../../pm/index.js';
import { getSentryClient } from '../../sentry/client.js';
import type { AgentInput, ProjectConfig } from '../../types/index.js';
import { parseRepoFullName } from '../../utils/repo.js';
import type { ContextInjection, LogWriter } from '../contracts/index.js';
import {
	countSkipsByReason,
	extractPRDiffs,
	formatPRComments,
	formatPRDetails,
	formatPRDiff,
	formatPRDiffContext,
	formatPRIssueComments,
	formatPRReviews,
	formatSkippedFilesInjection,
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

export async function fetchWorkItemStep(params: FetchContextParams): Promise<ContextInjection[]> {
	if (!params.input.workItemId) return [];
	try {
		const { text: cardData, media } = await readWorkItemWithMedia(params.input.workItemId, true);

		const injection: ContextInjection = {
			toolName: 'ReadWorkItem',
			params: { workItemId: params.input.workItemId, includeComments: true },
			result: cardData,
			description: 'Pre-fetched work item data',
		};

		// Download image media references in parallel (up to MAX_IMAGES_PER_WORK_ITEM)
		if (media.length > 0) {
			const provider = getPMProviderOrNull();
			const limited = media.slice(0, MAX_IMAGES_PER_WORK_ITEM);

			params.logWriter('INFO', 'fetchWorkItemStep: downloading work item images', {
				workItemId: params.input.workItemId,
				count: limited.length,
			});

			const { jiraClient } = await import('../../jira/client.js');
			const { trelloClient } = await import('../../trello/client.js');
			const { linearClient } = await import('../../linear/client.js');

			const results = await Promise.all(
				limited.map(async (ref) => {
					try {
						let downloaded: { buffer: Buffer; mimeType: string } | null = null;
						if (provider?.type === 'jira') {
							downloaded = await jiraClient.downloadAttachment(ref.url);
						} else if (provider?.type === 'linear') {
							downloaded = await linearClient.downloadAttachment(ref.url);
						} else {
							downloaded = await trelloClient.downloadAttachment(ref.url);
						}
						if (!downloaded) {
							params.logWriter('WARN', 'fetchWorkItemStep: image download returned null', {
								url: ref.url.split('?')[0],
							});
							return null;
						}
						return {
							base64Data: downloaded.buffer.toString('base64'),
							mimeType: downloaded.mimeType,
							altText: ref.altText,
						};
					} catch (err) {
						params.logWriter('WARN', 'fetchWorkItemStep: failed to download image', {
							url: ref.url.split('?')[0],
							error: err instanceof Error ? err.message : String(err),
						});
						return null;
					}
				}),
			);

			const images = results.filter((r) => r !== null);
			params.logWriter('INFO', 'fetchWorkItemStep: image download complete', {
				workItemId: params.input.workItemId,
				attempted: limited.length,
				downloaded: images.length,
				skipped: limited.length - images.length,
			});
			if (images.length > 0) {
				injection.images = images;
			}
		}

		return [injection];
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

	// Total changed files (now complete — `getPRDiff` paginates beyond the first 100).
	params.logWriter('INFO', 'Total changed files in PR', { totalChangedFiles: prDiff.length });

	// Compact per-file diffs (scales with PR size, not repo size). Files that
	// don't fit the budget or can't be diffed are surfaced in a separate
	// SKIPPED FILES injection so the agent can decide whether to fetch them.
	const diffContext = extractPRDiffs(prDiff);
	const skipReasons = countSkipsByReason(diffContext.skipped);
	params.logWriter('INFO', 'PR context prepared', {
		included: diffContext.included.length,
		skipped: diffContext.skipped.length,
		skipReasons,
	});

	injections.push({
		toolName: 'GetPRDiffContext',
		params: { comment: 'Pre-fetching compact per-file diffs for review', owner, repo, prNumber },
		result: formatPRDiffContext(diffContext),
		description: 'Pre-fetched PR diff context',
	});

	if (diffContext.skipped.length > 0) {
		injections.push({
			toolName: 'SkippedFiles',
			params: {
				comment: 'PR files omitted from the compact context — fetch on demand if relevant',
				prNumber,
			},
			result: formatSkippedFilesInjection(diffContext.skipped, prNumber),
			description: 'Skipped files',
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
 *
 * `statusKey` is the CASCADE-canonical status (`'backlog'`, `'todo'`, ...) that
 * gets passed to `provider.listWorkItems(undefined, { status: statusKey })`.
 * Each provider self-resolves its native identifier (Trello list ID, JIRA
 * status name, Linear state UUID) from its own config.
 */
interface PipelineList {
	name: string;
	statusKey: string;
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
	const linearConfig = getLinearConfig(project);

	const STATUS_KEYS = ['backlog', 'todo', 'inProgress', 'inReview', 'done', 'merged'] as const;
	const NAME_BY_KEY: Record<(typeof STATUS_KEYS)[number], string> = {
		backlog: 'BACKLOG',
		todo: 'TODO',
		inProgress: 'IN_PROGRESS',
		inReview: 'IN_REVIEW',
		done: 'DONE',
		merged: 'MERGED',
	};

	const lists: PipelineList[] = [];
	for (const statusKey of STATUS_KEYS) {
		// Skip statuses that no provider has configured — provider self-resolves
		// the actual native ID at fetch time.
		const hasMapping = Boolean(
			trelloConfig?.lists?.[statusKey] ??
				jiraConfig?.statuses?.[statusKey] ??
				linearConfig?.statuses?.[statusKey],
		);
		if (hasMapping) lists.push({ name: NAME_BY_KEY[statusKey], statusKey });
	}

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
				// Pass `undefined` as containerId so each provider self-resolves
				// the natural scope from its own config. The `status` filter is
				// the CASCADE status key — provider maps it to its native
				// identifier internally. This unified call shape works for all
				// providers; passing `list.id` (a status identifier) directly as
				// containerId silently returned [] for JIRA and Linear.
				const items = await provider.listWorkItems(undefined, { status: list.statusKey });
				return { list, items, error: null };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logWriter('WARN', `fetchPipelineSnapshotStep: Failed to fetch list ${list.name}`, {
					statusKey: list.statusKey,
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

	sections.push(`## ${list.name} (status: ${list.statusKey})`);
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
			sections.push(`- [${item.id}] ${item.title}${item.url ? ` (${item.url})` : ''}`);
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

// ============================================================================
// Sentry Issue Step
// ============================================================================

/**
 * Pre-fetch the latest alerting event (with full stacktrace and breadcrumbs)
 * so the agent starts with the error context already loaded.
 *
 * Reads alertIssueId and alertOrgId from AgentInput.
 * Silently skips if credentials or config are missing.
 */
export async function fetchAlertingIssueStep(
	params: FetchContextParams,
): Promise<ContextInjection[]> {
	const { alertIssueId, alertOrgId } = params.input;
	if (!alertIssueId || typeof alertIssueId !== 'string') return [];
	if (!alertOrgId || typeof alertOrgId !== 'string') return [];

	try {
		params.logWriter('INFO', 'fetchAlertingIssueStep: fetching latest alerting event', {
			issueId: alertIssueId,
			orgId: alertOrgId,
		});

		const client = getSentryClient();
		const event = await client.getIssueEvent(alertOrgId, alertIssueId, 'latest');
		const result = formatSentryEvent(event);

		params.logWriter('INFO', 'fetchAlertingIssueStep: fetched alerting event successfully', {
			issueId: alertIssueId,
			eventId: event.event_id,
		});

		return [
			{
				toolName: 'GetAlertingEventDetail',
				params: {
					organizationId: alertOrgId,
					issueId: alertIssueId,
					eventId: 'latest',
				},
				result,
				description: 'Pre-fetched alerting event with stacktrace and breadcrumbs',
			},
		];
	} catch (error) {
		params.logWriter('WARN', 'fetchAlertingIssueStep: failed to fetch alerting event', {
			issueId: alertIssueId,
			orgId: alertOrgId,
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}
