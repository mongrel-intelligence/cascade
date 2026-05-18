/**
 * Implementation freshness gate.
 *
 * Spec: MNG-1053. The PM router intentionally embeds a pre-resolved
 * `TriggerResult` for delayed / coalesced PM jobs, so an implementation
 * dispatch can fire against a snapshot that was correct when the webhook
 * arrived but stale by the time the worker actually starts. The
 * router-level work-item lock catches in-flight duplicates of the same
 * agent type, but it cannot see:
 *
 *   - a sibling implementation run that already completed (e.g. via the
 *     post-completion review chain or a manual run),
 *   - a checklist that an operator finished while the job was sitting
 *     in the coalesce window,
 *   - a PR that already exists for this work item.
 *
 * This gate runs the last-mile check inside the worker execution
 * pipeline, just before `persistAgentWorkItemLinks` and
 * `prepareForAgent`. It only fires for `implementation` runs with a
 * resolved `workItemId`; follow-up agents (review, respond-to-review,
 * respond-to-ci, respond-to-pr-comment, …) keep their existing dispatch
 * path.
 *
 * The gate is *fail-closed*: checklist read uncertainty always returns
 * `needs_human_reconciliation`, and PR lookup uncertainty does the same
 * when a DB/run-linked candidate exists. We would rather stop for human
 * reconciliation than let a stale implementation start.
 */

import { listPRsForWorkItem } from '../../db/repositories/prWorkItemsRepository.js';
import {
	countActiveRuns,
	DEFAULT_STALE_RUN_THRESHOLD_MS,
	getRunsByWorkItem,
} from '../../db/repositories/runsRepository.js';
import { githubClient, withGitHubToken } from '../../github/client.js';
import { getPersonaToken } from '../../github/personas.js';
import type { PMProvider } from '../../pm/index.js';
import type { AgentInput, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { extractPRNumber } from '../../utils/prUrl.js';
import { parseRepoFullName } from '../../utils/repo.js';

/**
 * Terminal-or-near-terminal outcome shapes the gate can emit. The
 * pipeline maps `dispatchable` → continue, everything else → stop and
 * post a durable PM comment.
 */
export type FreshnessOutcomeKind =
	| 'dispatchable'
	| 'already_implemented'
	| 'active_implementation'
	| 'implementation_pr_exists'
	| 'needs_human_reconciliation';

export interface FreshnessEvidence {
	/** Names of completed checklists that pushed the decision. */
	completedChecklists?: string[];
	/** Active running `agent_runs.id` values within the stale-run window. */
	activeRunIds?: string[];
	/** Completed `agent_runs.id` values from recent successful implementations. */
	completedRunIds?: string[];
	/** PR numbers (with state) the gate inspected. */
	pullRequests?: Array<{
		prNumber: number;
		prUrl?: string | null;
		state?: string;
		merged?: boolean;
	}>;
	/** Optional human description of why uncertainty fell into fail-closed mode. */
	uncertaintyReason?: string;
}

export interface FreshnessGateOutcome {
	kind: FreshnessOutcomeKind;
	/** Human-readable summary suitable for PM comment text. */
	message: string;
	/** Structured details for logs/tests. */
	evidence: FreshnessEvidence;
}

export interface FreshnessGateInput {
	agentType: string;
	workItemId: string | undefined;
	project: ProjectConfig;
	provider: PMProvider;
	/** Window matching the router's stale-run sweep. Defaults to 2h. */
	staleRunWindowMs?: number;
}

/**
 * Names that signal the agent's planned work is done. We deliberately
 * keep this list narrow so unrelated checklists (e.g. dependency
 * tracking, friction lists) cannot accidentally block reimplementation.
 */
const TERMINAL_CHECKLIST_NAMES = ['implementation steps', 'acceptance criteria'] as const;

function isTerminalChecklistName(name: string): boolean {
	const normalised = name.trim().toLowerCase();
	return TERMINAL_CHECKLIST_NAMES.some((candidate) => normalised.includes(candidate));
}

/**
 * Live PM checklist read. Returns the named checklists that are
 * fully complete + non-empty, or `null` if the provider read failed.
 * The pipeline treats `null` as "uncertain" so it can fail closed
 * when other ownership evidence exists.
 */
async function readCompletedTerminalChecklists(
	provider: PMProvider,
	workItemId: string,
): Promise<{ completedNames: string[] } | null> {
	try {
		const checklists = await provider.getChecklists(workItemId);
		const completed: string[] = [];
		for (const checklist of checklists) {
			if (!isTerminalChecklistName(checklist.name)) continue;
			if (checklist.items.length === 0) continue;
			if (checklist.items.every((item) => item.complete)) {
				completed.push(checklist.name);
			}
		}
		return { completedNames: completed };
	} catch (err) {
		logger.warn('[freshness-gate] failed to read live checklists', {
			workItemId,
			error: String(err),
		});
		return null;
	}
}

interface RecentRunSummary {
	id: string;
	prUrl: string | null;
	success: boolean | null;
	completedAt: Date | null;
}

/** Recent completed implementation runs for the work item — newest first. */
async function readRecentImplementationRuns(
	projectId: string,
	workItemId: string,
	windowMs: number,
): Promise<{ runs: RecentRunSummary[] } | null> {
	try {
		const rows = await getRunsByWorkItem(projectId, workItemId);
		const cutoff = Date.now() - windowMs;
		const completed = rows
			.filter(
				(row) =>
					row.agentType === 'implementation' &&
					row.status !== 'running' &&
					row.completedAt instanceof Date &&
					row.completedAt.getTime() >= cutoff,
			)
			.map<RecentRunSummary>((row) => ({
				id: row.id,
				prUrl: row.prUrl ?? null,
				success: row.success ?? null,
				completedAt: row.completedAt ?? null,
			}));
		return { runs: completed };
	} catch (err) {
		logger.warn('[freshness-gate] failed to read recent implementation runs', {
			projectId,
			workItemId,
			error: String(err),
		});
		return null;
	}
}

interface ActiveRunsSummary {
	count: number;
}

async function readActiveImplementationRuns(
	projectId: string,
	workItemId: string,
	windowMs: number,
): Promise<ActiveRunsSummary | null> {
	try {
		const count = await countActiveRuns({
			projectId,
			workItemId,
			agentType: 'implementation',
			maxAgeMs: windowMs,
		});
		return { count };
	} catch (err) {
		logger.warn('[freshness-gate] failed to count active implementation runs', {
			projectId,
			workItemId,
			error: String(err),
		});
		return null;
	}
}

interface CandidatePR {
	prNumber: number;
	prUrl: string | null;
}

async function loadPRRowsAsCandidates(
	projectId: string,
	workItemId: string,
	seen: Map<number, CandidatePR>,
): Promise<{ failed: boolean }> {
	try {
		const prRows = await listPRsForWorkItem(projectId, workItemId);
		for (const row of prRows) {
			if (typeof row.prNumber !== 'number') continue;
			if (seen.has(row.prNumber)) continue;
			seen.set(row.prNumber, { prNumber: row.prNumber, prUrl: row.prUrl ?? null });
		}
		return { failed: false };
	} catch (err) {
		logger.warn('[freshness-gate] failed to list pr_work_items rows', {
			projectId,
			workItemId,
			error: String(err),
		});
		return { failed: true };
	}
}

function addRunPRCandidates(recentRuns: RecentRunSummary[], seen: Map<number, CandidatePR>): void {
	for (const run of recentRuns) {
		if (!run.prUrl) continue;
		const prNumber = extractPRNumber(run.prUrl);
		if (typeof prNumber !== 'number') continue;
		if (seen.has(prNumber)) continue;
		seen.set(prNumber, { prNumber, prUrl: run.prUrl });
	}
}

/**
 * Merge PR candidates from `pr_work_items` and recent agent run rows.
 * De-duplicated by PR number.
 */
async function collectPRCandidates(
	projectId: string,
	workItemId: string,
	recentRuns: RecentRunSummary[],
): Promise<{ prs: CandidatePR[] } | null> {
	const seen = new Map<number, CandidatePR>();
	const { failed: prRowsFailed } = await loadPRRowsAsCandidates(projectId, workItemId, seen);
	addRunPRCandidates(recentRuns, seen);

	if (prRowsFailed && seen.size === 0) {
		// We were unable to read pr_work_items AND have no run-derived
		// candidates. Surface uncertainty so the caller can fail closed
		// when other ownership evidence exists.
		return null;
	}

	return { prs: Array.from(seen.values()) };
}

interface InspectedPR {
	prNumber: number;
	prUrl: string | null;
	state: string;
	merged: boolean;
}

/**
 * Verify each candidate PR via GitHub. The shared execution pipeline has
 * callers that do not establish an ambient GitHub scope (manual/retry jobs),
 * so this function resolves and scopes the implementation persona token
 * itself before touching the scoped singleton.
 *
 * `errored` collects PRs whose metadata could not be retrieved despite
 * being credible candidates. The pipeline fails closed when this list is
 * non-empty rather than assuming the linked PR is safe to ignore.
 */
async function inspectPullRequests(
	projectId: string,
	repo: string,
	candidates: CandidatePR[],
): Promise<{ inspected: InspectedPR[]; errored: CandidatePR[] }> {
	const inspected: InspectedPR[] = [];
	const errored: CandidatePR[] = [];
	let owner: string;
	let repoName: string;
	try {
		({ owner, repo: repoName } = parseRepoFullName(repo));
	} catch (err) {
		// Misconfigured repo — every candidate becomes uncertain.
		logger.warn('[freshness-gate] invalid repo full name; cannot verify PR state', {
			repo,
			error: String(err),
		});
		return { inspected: [], errored: [...candidates] };
	}

	let githubToken: string;
	try {
		githubToken = await getPersonaToken(projectId, 'implementation');
	} catch (err) {
		logger.warn('[freshness-gate] failed to resolve GitHub token for PR verification', {
			projectId,
			error: String(err),
		});
		return { inspected: [], errored: [...candidates] };
	}

	await withGitHubToken(githubToken, async () => {
		for (const candidate of candidates) {
			try {
				const pr = await githubClient.getPR(owner, repoName, candidate.prNumber);
				inspected.push({
					prNumber: candidate.prNumber,
					prUrl: pr.htmlUrl ?? candidate.prUrl,
					state: pr.state,
					merged: pr.merged,
				});
			} catch (err) {
				errored.push(candidate);
				logger.warn('[freshness-gate] failed to load PR metadata', {
					prNumber: candidate.prNumber,
					error: String(err),
				});
			}
		}
	});

	return { inspected, errored };
}

function formatPRDescriptor(pr: InspectedPR): string {
	return pr.prUrl ? `${pr.prUrl} (#${pr.prNumber})` : `PR #${pr.prNumber}`;
}

interface FreshnessSignals {
	checklistsResult: { completedNames: string[] } | null;
	completedChecklistNames: string[];
	activeRuns: ActiveRunsSummary | null;
	successfulRunsWithPR: RecentRunSummary[];
	successfulRunsWithoutPR: RecentRunSummary[];
	inspectedPRs: InspectedPR[];
	erroredPRs: CandidatePR[];
	openPRs: InspectedPR[];
	mergedPRs: InspectedPR[];
}

async function gatherFreshnessSignals(
	input: FreshnessGateInput,
	workItemId: string,
	windowMs: number,
): Promise<FreshnessSignals> {
	const projectId = input.project.id;

	const checklistsResult = await readCompletedTerminalChecklists(input.provider, workItemId);
	const completedChecklistNames = checklistsResult?.completedNames ?? [];

	const activeRuns = await readActiveImplementationRuns(projectId, workItemId, windowMs);

	const recentRunsResult = await readRecentImplementationRuns(projectId, workItemId, windowMs);
	const recentRuns = recentRunsResult?.runs ?? [];
	const successfulRunsWithPR = recentRuns.filter((r) => r.success === true && !!r.prUrl);
	const successfulRunsWithoutPR = recentRuns.filter((r) => r.success === true && !r.prUrl);

	const candidatesResult = await collectPRCandidates(projectId, workItemId, recentRuns);
	const candidates = candidatesResult?.prs ?? [];

	let inspectedPRs: InspectedPR[] = [];
	let erroredPRs: CandidatePR[] = [];
	if (input.project.repo && candidates.length > 0) {
		const verification = await inspectPullRequests(projectId, input.project.repo, candidates);
		inspectedPRs = verification.inspected;
		erroredPRs = verification.errored;
	}

	return {
		checklistsResult,
		completedChecklistNames,
		activeRuns,
		successfulRunsWithPR,
		successfulRunsWithoutPR,
		inspectedPRs,
		erroredPRs,
		openPRs: inspectedPRs.filter((pr) => pr.state === 'open' && !pr.merged),
		mergedPRs: inspectedPRs.filter((pr) => pr.merged),
	};
}

function buildEvidence(signals: FreshnessSignals): FreshnessEvidence {
	return {
		completedChecklists:
			signals.completedChecklistNames.length > 0 ? signals.completedChecklistNames : undefined,
		activeRunIds: undefined,
		completedRunIds:
			signals.successfulRunsWithPR.length > 0
				? signals.successfulRunsWithPR.map((r) => r.id)
				: undefined,
		pullRequests:
			signals.inspectedPRs.length > 0
				? signals.inspectedPRs.map((pr) => ({
						prNumber: pr.prNumber,
						prUrl: pr.prUrl,
						state: pr.state,
						merged: pr.merged,
					}))
				: undefined,
	};
}

function decideTerminalOutcome(
	signals: FreshnessSignals,
	evidence: FreshnessEvidence,
): FreshnessGateOutcome | null {
	if (signals.mergedPRs.length > 0) {
		const descriptor = formatPRDescriptor(signals.mergedPRs[0]);
		return {
			kind: 'already_implemented',
			message: `Implementation not started: already implemented — merged ${descriptor}.`,
			evidence,
		};
	}

	if (signals.openPRs.length > 0) {
		const descriptor = formatPRDescriptor(signals.openPRs[0]);
		return {
			kind: 'implementation_pr_exists',
			message: `Implementation not started: existing PR ${descriptor} is open for this work item.`,
			evidence,
		};
	}

	if (signals.completedChecklistNames.length > 0) {
		const names = signals.completedChecklistNames.map((n) => `"${n}"`).join(', ');
		return {
			kind: 'already_implemented',
			message: `Implementation not started: already implemented — checklist(s) ${names} are fully complete.`,
			evidence,
		};
	}

	if (signals.activeRuns && signals.activeRuns.count > 0) {
		return {
			kind: 'active_implementation',
			message:
				'Implementation not started: active implementation is already running for this work item.',
			evidence,
		};
	}

	return null;
}

function decideFailClosedOutcome(
	signals: FreshnessSignals,
	evidence: FreshnessEvidence,
): FreshnessGateOutcome | null {
	// A successful implementation run without a PR URL is unexpected (an
	// implementation should always produce a PR). Treat as needs-reconciliation.
	if (signals.successfulRunsWithoutPR.length > 0) {
		const augmented: FreshnessEvidence = {
			...evidence,
			uncertaintyReason: 'successful_implementation_without_pr',
			completedRunIds: signals.successfulRunsWithoutPR.map((r) => r.id),
		};
		return {
			kind: 'needs_human_reconciliation',
			message:
				'Implementation not started: needs human reconciliation — found a recent successful implementation run without a PR URL.',
			evidence: augmented,
		};
	}

	if (signals.erroredPRs.length > 0) {
		return {
			kind: 'needs_human_reconciliation',
			message:
				'Implementation not started: needs human reconciliation — could not verify the state of an existing PR linked to this work item.',
			evidence: { ...evidence, uncertaintyReason: 'pr_lookup_failed' },
		};
	}

	if (!signals.checklistsResult) {
		return {
			kind: 'needs_human_reconciliation',
			message:
				'Implementation not started: needs human reconciliation — could not read live work-item checklists to confirm freshness.',
			evidence: { ...evidence, uncertaintyReason: 'checklist_read_failed' },
		};
	}

	return null;
}

/**
 * Decide the freshness outcome.
 *
 * The contract is intentionally narrow:
 *   - implementation-only, with a resolved workItemId
 *   - reload live PM checklists (fail closed when the read is uncertain)
 *   - count active same-type runs, recent completed implementations
 *   - inspect linked open / merged PRs through GitHub
 */
export async function evaluateImplementationFreshness(
	input: FreshnessGateInput,
): Promise<FreshnessGateOutcome> {
	if (input.agentType !== 'implementation' || !input.workItemId) {
		return {
			kind: 'dispatchable',
			message: 'Freshness gate skipped: not an implementation run with workItemId',
			evidence: {},
		};
	}

	const windowMs = input.staleRunWindowMs ?? DEFAULT_STALE_RUN_THRESHOLD_MS;
	const signals = await gatherFreshnessSignals(input, input.workItemId, windowMs);
	const evidence = buildEvidence(signals);

	const terminal = decideTerminalOutcome(signals, evidence);
	if (terminal) return terminal;

	const failClosed = decideFailClosedOutcome(signals, evidence);
	if (failClosed) return failClosed;

	return {
		kind: 'dispatchable',
		message: 'Freshness gate passed: dispatchable.',
		evidence,
	};
}

/**
 * Persist the freshness-gate decision as a PM comment.
 *
 * Prefer updating the deferred/coalesced "starting" ack comment if the
 * agent input carries one; fall back to a fresh comment otherwise.
 * Failures are logged but never thrown — a comment-write hiccup must
 * not crash the worker on a normal skip.
 */
export async function postFreshnessSkipNotice(
	provider: PMProvider,
	workItemId: string,
	agentInput: AgentInput,
	outcome: FreshnessGateOutcome,
): Promise<void> {
	const ackCommentId = agentInput.ackCommentId;
	const message = outcome.message;

	if (ackCommentId !== undefined && ackCommentId !== null && ackCommentId !== '') {
		try {
			await provider.updateComment(workItemId, String(ackCommentId), message);
			return;
		} catch (err) {
			logger.warn('[freshness-gate] failed to update ack comment; falling back to addComment', {
				workItemId,
				ackCommentId: String(ackCommentId),
				error: String(err),
			});
		}
	}

	try {
		await provider.addComment(workItemId, message);
	} catch (err) {
		logger.warn('[freshness-gate] failed to post skip comment on work item', {
			workItemId,
			outcome: outcome.kind,
			error: String(err),
		});
	}
}
