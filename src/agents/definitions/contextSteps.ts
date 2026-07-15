/**
 * Context pipeline step implementations and pre-execute hooks.
 *
 * Each step function takes a FetchContextParams and returns ContextInjection[].
 * These are the building blocks composed by the YAML contextPipeline arrays.
 */

import {
	formatCheckStatus,
	formatCheckStatusUnavailable,
} from '../../gadgets/github/core/getPRChecks.js';
import { ListDirectory } from '../../gadgets/ListDirectory.js';
import {
	readStructuredWorkItemDetails,
	readWorkItemWithMedia,
	type StructuredWorkItemDetails,
} from '../../gadgets/pm/core/readWorkItem.js';
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
import type {
	Attachment,
	Checklist,
	MediaReference,
	WorkItem,
	WorkItemLabel,
} from '../../pm/index.js';
import { getPMProviderOrNull } from '../../pm/index.js';
import { getSentryClient } from '../../sentry/client.js';
import type { AgentInput, ProjectConfig } from '../../types/index.js';
import { parseRepoFullName } from '../../utils/repo.js';
import type { ContextInjection, LogWriter } from '../contracts/index.js';
import { sourceLocalPRDiffs } from '../shared/prDiffSource.js';
import {
	countSkipsByReason,
	extractPRDiffs,
	formatPRComments,
	formatPRDetails,
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
		const {
			text: cardData,
			media,
			urlsDetected,
		} = await readWorkItemWithMedia(params.input.workItemId, true);

		const injection: ContextInjection = {
			toolName: 'ReadWorkItem',
			params: { workItemId: params.input.workItemId, includeComments: true },
			result: cardData,
			description: 'Pre-fetched work item data',
		};

		// Spec 016/1: defer the actual download + base64 prep to the shared
		// `downloadAndPrepareImages` helper so the runtime gadget (spec 016/2)
		// uses the same code path.
		const { downloadAndPrepareImages } = await import('../../pm/download-and-prepare.js');
		const { images, failures } = await downloadAndPrepareImages(
			params.input.workItemId,
			media,
			params.logWriter,
		);

		// Spec 016/1 AC#5: single grep-stable diagnostic log line summarising
		// the entire boot-path image pipeline outcome. Operators triage any
		// "no image delivered" report by grepping for `[image-pipeline]
		// work-item-fetch summary`.
		const provider = getPMProviderOrNull();
		const urlsByMimeType: Record<string, number> = {};
		for (const ref of media) {
			urlsByMimeType[ref.mimeType] = (urlsByMimeType[ref.mimeType] ?? 0) + 1;
		}
		params.logWriter('INFO', '[image-pipeline] work-item-fetch summary', {
			provider: provider?.type ?? 'unknown',
			workItemId: params.input.workItemId,
			urlsDetected,
			urlsAfterFilter: media.length,
			urlsDownloaded: images.length,
			urlsFailed: failures.length,
			urlsByMimeType,
		});

		if (images.length > 0) {
			injection.images = images;
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

	// CI check status is informational, not fatal (MNG-1750). A reviewer PAT
	// without the "Actions: Read" permission throws 403 here; degrade gracefully
	// so the review still boots instead of dying with a BootFailureError. The
	// PR details + diff above stay fatal — a review without the PR is meaningless.
	let checkStatusFormatted: string;
	let checkStatusDescription = 'Pre-fetched CI check status';
	try {
		const checkStatus = await githubClient.getCheckSuiteStatus(owner, repo, prDetails.headSha);
		checkStatusFormatted = formatCheckStatus(prNumber, checkStatus);
	} catch (error) {
		// Log/inject only `error.message`, never the raw Octokit RequestError
		// object — it can carry the Authorization header.
		const message = error instanceof Error ? error.message : String(error);
		params.logWriter('WARN', 'CI check status unavailable', {
			owner,
			repo,
			prNumber,
			error: message,
		});
		checkStatusFormatted = formatCheckStatusUnavailable(prNumber, message);
		checkStatusDescription = 'CI check status unavailable';
	}

	const prDetailsFormatted = formatPRDetails(prDetails);

	injections.push({
		toolName: 'GetPRDetails',
		params: { comment: 'Pre-fetching PR details for review context', owner, repo, prNumber },
		result: prDetailsFormatted,
		description: 'Pre-fetched PR details',
	});

	injections.push({
		toolName: 'GetPRChecks',
		params: { comment: 'Pre-fetching CI check status for review', owner, repo, prNumber },
		result: checkStatusFormatted,
		description: checkStatusDescription,
	});

	// Total changed files (now complete — `getPRDiff` paginates beyond the first 100).
	params.logWriter('INFO', 'Total changed files in PR', { totalChangedFiles: prDiff.length });

	// Compact per-file diffs (scales with PR size, not repo size). Files that
	// don't fit the budget or can't be diffed are surfaced in a separate
	// SKIPPED FILES injection so the agent can decide whether to fetch them.
	// Use prDetails.baseRef (the PR's actual target branch) rather than the
	// project base branch so stacked PRs targeting a feature branch don't
	// include parent-branch commits in the diff context.
	const baseBranch = prDetails.baseRef;
	const localDiffSource = await sourceLocalPRDiffs({
		files: prDiff,
		repoDir: params.repoDir,
		baseBranch,
		logWriter: params.logWriter,
	});
	const diffContext = extractPRDiffs(localDiffSource.files);
	const skipReasons = countSkipsByReason(diffContext.skipped);
	const patchSources = localDiffSource.files.reduce<Record<string, number>>((acc, file) => {
		acc[file.patchSource] = (acc[file.patchSource] ?? 0) + 1;
		return acc;
	}, {});
	params.logWriter('INFO', 'PR context prepared', {
		included: diffContext.included.length,
		skipped: diffContext.skipped.length,
		skipReasons,
		patchSources,
		totalDiffTokens: diffContext.totalDiffTokens,
		perFileTokenCap: diffContext.perFileTokenCap,
		localGitMismatches: localDiffSource.mismatches.slice(0, 20),
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

type PipelineStatusKey = PipelineList['statusKey'];

interface PipelineCommentSummary {
	id: string;
	authorName: string;
	date: string;
	text: string;
}

interface PipelineDependencySignal {
	sourceType: 'description' | 'comment' | 'checklist' | 'attachment';
	sourceId?: string;
	text: string;
	matches: string[];
}

interface PipelineStatusSummary {
	statusKey: PipelineStatusKey;
	statusName: string;
	itemIds: string[];
	count: number;
	error?: string;
}

interface PipelineItemSummary {
	id: string;
	title: string;
	url: string;
	statusKey: PipelineStatusKey;
	statusName: string;
	providerStatus?: string;
	providerStatusId?: string;
	description?: string;
	labels: WorkItemLabel[];
	checklists: Checklist[];
	comments: PipelineCommentSummary[];
	attachments: Attachment[];
	mediaReferences: MediaReference[];
	dependencySignals: PipelineDependencySignal[];
	error?: string;
}

interface PipelineSnapshotSummary {
	schemaVersion: 1;
	provider: string;
	statuses: Partial<Record<PipelineStatusKey, PipelineStatusSummary>>;
	activePipelineCount: number;
	/**
	 * `true` when all active-status list fetches (todo, inProgress, inReview) succeeded.
	 * `false` when any active-status fetch failed — the count is a lower bound, not authoritative.
	 * When false, the backlog-manager MUST abort without moving items.
	 */
	activeCapacityReliable: boolean;
	activeStatusKeys: PipelineStatusKey[];
	itemsById: Record<string, PipelineItemSummary>;
	errors: Array<{ statusKey?: PipelineStatusKey; itemId?: string; message: string }>;
}

const PIPELINE_DETAIL_LISTS = new Set(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW']);
const PIPELINE_DETAIL_CONCURRENCY = 5;
const ACTIVE_PIPELINE_STATUS_KEYS: PipelineStatusKey[] = ['todo', 'inProgress', 'inReview'];
const DEPENDENCY_SIGNAL_REGEX =
	/\b(?:blocked by|depends on|waiting for|after|requires)\b|[A-Z][A-Z0-9]+-\d+|https?:\/\/\S+/gi;

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
): Promise<Map<string, StructuredWorkItemDetails | { error: string }>> {
	const fullDetails = new Map<string, StructuredWorkItemDetails | { error: string }>();

	for (let i = 0; i < items.length; i += PIPELINE_DETAIL_CONCURRENCY) {
		const batch = items.slice(i, i + PIPELINE_DETAIL_CONCURRENCY);
		await Promise.all(
			batch.map(async ({ id }) => {
				try {
					const details = await readStructuredWorkItemDetails(id, true);
					fullDetails.set(id, details);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					logWriter('WARN', 'fetchPipelineSnapshotStep: Failed to read card details', {
						workItemId: id,
						error: message,
					});
					fullDetails.set(id, { error: message });
				}
			}),
		);
	}

	return fullDetails;
}

function collectDependencySignalsFromText(
	sourceType: PipelineDependencySignal['sourceType'],
	text: string | undefined,
	sourceId?: string,
): PipelineDependencySignal[] {
	const matches = Array.from(new Set(text?.match(DEPENDENCY_SIGNAL_REGEX) ?? []));
	if (!text || matches.length === 0) return [];
	return [{ sourceType, sourceId, text, matches }];
}

function collectDependencySignals(details: {
	item: WorkItem;
	checklists: Checklist[];
	attachments: Attachment[];
	comments: PipelineCommentSummary[];
}): PipelineDependencySignal[] {
	const signals: PipelineDependencySignal[] = [
		...collectDependencySignalsFromText('description', details.item.description),
	];

	for (const checklist of details.checklists) {
		for (const item of checklist.items) {
			signals.push(...collectDependencySignalsFromText('checklist', item.name, item.id));
		}
	}

	for (const comment of details.comments) {
		signals.push(...collectDependencySignalsFromText('comment', comment.text, comment.id));
	}

	for (const attachment of details.attachments) {
		signals.push(...collectDependencySignalsFromText('attachment', attachment.url, attachment.id));
	}

	return signals;
}

function summarizeComments(details: StructuredWorkItemDetails): PipelineCommentSummary[] {
	return details.comments.map((comment) => ({
		id: comment.id,
		authorName: comment.author.name,
		date: comment.date,
		text: comment.text,
	}));
}

function buildItemSummary(
	list: PipelineList,
	listItem: WorkItem,
	fullDetails: Map<string, StructuredWorkItemDetails | { error: string }>,
): PipelineItemSummary {
	const detail = fullDetails.get(listItem.id);
	if (detail && 'error' in detail) {
		return {
			id: listItem.id,
			title: listItem.title,
			url: listItem.url,
			statusKey: list.statusKey,
			statusName: list.name,
			providerStatus: listItem.status,
			providerStatusId: listItem.statusId,
			description: listItem.description,
			labels: listItem.labels,
			checklists: [],
			comments: [],
			attachments: [],
			mediaReferences: [],
			dependencySignals: collectDependencySignalsFromText('description', listItem.description),
			error: detail.error,
		};
	}

	if (detail) {
		const comments = summarizeComments(detail);
		const item = detail.item;
		return {
			id: item.id,
			title: item.title,
			url: item.url,
			statusKey: list.statusKey,
			statusName: list.name,
			providerStatus: item.status,
			providerStatusId: item.statusId,
			description: item.description,
			labels: item.labels,
			checklists: detail.checklists,
			comments,
			attachments: detail.attachments,
			mediaReferences: detail.media,
			dependencySignals: collectDependencySignals({
				item,
				checklists: detail.checklists,
				attachments: detail.attachments,
				comments,
			}),
		};
	}

	const compactDetails = {
		item: listItem,
		checklists: [] as Checklist[],
		attachments: [] as Attachment[],
		comments: [] as PipelineCommentSummary[],
	};
	return {
		id: listItem.id,
		title: listItem.title,
		url: listItem.url,
		statusKey: list.statusKey,
		statusName: list.name,
		providerStatus: listItem.status,
		providerStatusId: listItem.statusId,
		description: listItem.description,
		labels: listItem.labels,
		checklists: [],
		comments: [],
		attachments: [],
		mediaReferences: listItem.inlineMedia ?? [],
		dependencySignals: collectDependencySignals(compactDetails),
	};
}

function buildPipelineSnapshotSummary(
	listResults: PipelineListResult[],
	fullDetails: Map<string, StructuredWorkItemDetails | { error: string }>,
	provider: NonNullable<ReturnType<typeof getPMProviderOrNull>>,
): PipelineSnapshotSummary {
	const statuses: PipelineSnapshotSummary['statuses'] = {};
	const itemsById: Record<string, PipelineItemSummary> = {};
	const errors: PipelineSnapshotSummary['errors'] = [];

	for (const { list, items, error } of listResults) {
		const itemIds = items?.map((item) => item.id) ?? [];
		statuses[list.statusKey] = {
			statusKey: list.statusKey,
			statusName: list.name,
			itemIds,
			count: itemIds.length,
			...(error ? { error } : {}),
		};

		if (error) {
			errors.push({ statusKey: list.statusKey, message: error });
			continue;
		}

		for (const item of items ?? []) {
			const summary = buildItemSummary(list, item, fullDetails);
			itemsById[item.id] = summary;
			if (summary.error) {
				errors.push({ statusKey: list.statusKey, itemId: item.id, message: summary.error });
			}
		}
	}

	const activePipelineCount = ACTIVE_PIPELINE_STATUS_KEYS.reduce(
		(total, statusKey) => total + (statuses[statusKey]?.count ?? 0),
		0,
	);

	// If any active-status list fetch failed, the count is a lower bound, not authoritative.
	// Callers must treat capacity as unknown and abort moves when this is false.
	const activeCapacityReliable = ACTIVE_PIPELINE_STATUS_KEYS.every(
		(statusKey) => !statuses[statusKey]?.error,
	);

	return {
		schemaVersion: 1,
		provider: provider.type,
		statuses,
		activePipelineCount,
		activeCapacityReliable,
		activeStatusKeys: ACTIVE_PIPELINE_STATUS_KEYS,
		itemsById,
		errors,
	};
}

/**
 * Fetch pipeline state (BACKLOG, TODO, IN_PROGRESS, IN_REVIEW, DONE, MERGED)
 * and inject it as the structured PipelineSnapshotSummary JSON contract.
 *
 * This allows the backlog-manager agent to make decisions without parsing the
 * runtime ReadWorkItem markdown format.
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
	const summary = buildPipelineSnapshotSummary(listResults, fullDetails, provider);

	return [
		{
			toolName: 'PipelineSnapshotSummary',
			params: { comment: 'Pre-fetched structured pipeline snapshot across all statuses' },
			result: JSON.stringify(summary, null, 2),
			description: `Pre-fetched structured pipeline snapshot (${lists.length} statuses, ${itemsNeedingFullDetails.length} items with full details)`,
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
	const { alertIssueId, alertOrgId, alertIssueUrl, alertTitle } = params.input;
	if (!alertIssueId || typeof alertIssueId !== 'string') return [];
	if (!alertOrgId || typeof alertOrgId !== 'string') return [];

	try {
		params.logWriter('INFO', 'fetchAlertingIssueStep: fetching latest alerting event', {
			issueId: alertIssueId,
			orgId: alertOrgId,
		});

		const client = getSentryClient();
		const event = await client.getIssueEvent(alertOrgId, alertIssueId, 'latest');
		const issue =
			typeof alertIssueUrl === 'string' && alertIssueUrl.trim()
				? {
						id: alertIssueId,
						permalink: alertIssueUrl,
						title: typeof alertTitle === 'string' ? alertTitle : undefined,
					}
				: await client.getIssue(alertOrgId, alertIssueId).catch(() => undefined);
		const result = formatSentryEvent(event, issue);

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
