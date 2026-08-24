import {
	and,
	countDistinct,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	max,
	type SQL,
	sql,
	sum,
} from 'drizzle-orm';
import type { AlertSource } from '../../integrations/alerting/_shared/types.js';
import { getDb } from '../client.js';
import { agentRuns, projects, prWorkItems } from '../schema/index.js';
import { buildAgentRunWorkItemJoin } from './joinHelpers.js';

export interface LinkPRToWorkItemOptions {
	workItemUrl?: string;
	workItemTitle?: string;
	prUrl?: string;
	prTitle?: string;
}

/**
 * Insert a work-item-only row into pr_work_items (no PR yet).
 * Called at agent run start for PM-triggered runs.
 *
 * Before inserting, checks if a row already exists for (projectId, workItemId)
 * regardless of prNumber to prevent duplicates when a work-item row is promoted.
 */
export async function createWorkItem(
	projectId: string,
	workItemId: string,
	options: Pick<LinkPRToWorkItemOptions, 'workItemUrl' | 'workItemTitle'> = {},
): Promise<void> {
	const db = getDb();
	const now = new Date();
	const { workItemUrl, workItemTitle } = options;

	// Check if a row already exists for (projectId, workItemId) regardless of prNumber.
	// This prevents duplicate rows when a work-item-only row has been promoted
	// (prNumber set) and the same PM card triggers again.
	const existing = await db
		.select({ id: prWorkItems.id })
		.from(prWorkItems)
		.where(and(eq(prWorkItems.projectId, projectId), eq(prWorkItems.workItemId, workItemId)))
		.limit(1);

	if (existing.length > 0) {
		// Row already exists (either work-item-only or promoted with prNumber).
		// For work-item-only rows, update display fields. For promoted rows, do nothing.
		await db
			.update(prWorkItems)
			.set({
				workItemUrl,
				workItemTitle,
				updatedAt: now,
			})
			.where(
				and(
					eq(prWorkItems.projectId, projectId),
					eq(prWorkItems.workItemId, workItemId),
					isNull(prWorkItems.prNumber),
				),
			);
		return;
	}

	// No existing row — insert a new work-item-only row
	await db.insert(prWorkItems).values({
		projectId,
		workItemId,
		workItemUrl,
		workItemTitle,
		updatedAt: now,
	});
}

/**
 * Upsert a PR ↔ work item link.
 *
 * Two-step logic:
 * 1. If `workItemId` is provided, drop any racing orphan `(projectId, NULL workItemId,
 *    prNumber)` row, then UPDATE the existing work-item-only row with PR data.
 * 2. Otherwise INSERT a new row, using onConflictDoUpdate on (projectId, prNumber).
 *
 * `workItemId` is optional to support "orphan" PRs (PRs created without a linked
 * work item).
 *
 * **Link-preservation invariant** — the `work_item_id` column is one-way set: once
 * an earlier writer landed a non-null value, a later writer that happens to lack
 * the workItemId must NOT unset it. Step 2's ON CONFLICT clause uses
 * `COALESCE(EXCLUDED.work_item_id, pr_work_items.work_item_id)` to enforce this.
 * Without it, a stale review-pipeline writeback (workItemId captured at PR-opened
 * time, before the implementation linked the PR) would clobber the correct value
 * and break downstream lookups (notably the `pr-ready-to-merge` auto-merge trigger).
 */
export async function linkPRToWorkItem(
	projectId: string,
	repoFullName: string,
	prNumber: number,
	workItemId: string | null,
	options: LinkPRToWorkItemOptions = {},
): Promise<void> {
	const db = getDb();
	const now = new Date();
	const { workItemUrl, workItemTitle, prUrl, prTitle } = options;

	// Step 1: If workItemId is provided, try to update the existing work-item-only row.
	if (workItemId) {
		// First, drop any racing orphan row (projectId, NULL workItemId, prNumber). It
		// only exists because no link existed when an earlier writer (e.g. the review
		// pipeline's pre-execution pass on a freshly opened PR) inserted it. Promoting
		// our work-item-only row to the same prNumber would otherwise hit
		// uq_pr_work_items_project_pr.
		await db
			.delete(prWorkItems)
			.where(
				and(
					eq(prWorkItems.projectId, projectId),
					eq(prWorkItems.prNumber, prNumber),
					isNull(prWorkItems.workItemId),
				),
			);

		const updated = await db
			.update(prWorkItems)
			.set({
				repoFullName,
				prNumber,
				workItemUrl,
				workItemTitle,
				prUrl,
				prTitle,
				updatedAt: now,
			})
			.where(
				and(
					eq(prWorkItems.projectId, projectId),
					eq(prWorkItems.workItemId, workItemId),
					isNull(prWorkItems.prNumber),
				),
			)
			.returning({ id: prWorkItems.id });

		if (updated.length > 0) {
			// Successfully updated the work-item-only row with PR data
			return;
		}
	}

	// Step 2: Insert or update by (projectId, prNumber)
	await db
		.insert(prWorkItems)
		.values({
			projectId,
			repoFullName,
			prNumber,
			workItemId,
			workItemUrl,
			workItemTitle,
			prUrl,
			prTitle,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [prWorkItems.projectId, prWorkItems.prNumber],
			targetWhere: isNotNull(prWorkItems.prNumber),
			set: {
				// COALESCE: never erase a known workItemId with null. The link is
				// one-way set — once an earlier writer landed it, later writers that
				// happen to lack the workItemId must not unset it.
				workItemId: sql`COALESCE(${workItemId}, ${prWorkItems.workItemId})`,
				repoFullName,
				workItemUrl,
				workItemTitle,
				prUrl,
				prTitle,
				updatedAt: now,
			},
		});
}

// ============================================================================
// Dual JOIN helper
// ============================================================================
// Note: The dual-join helper has been extracted to joinHelpers.ts for reuse

// ============================================================================
// Shared query helpers (DRY refactoring)
// ============================================================================

/**
 * Returns the shared select column map for PR summary queries.
 * Evaluated lazily (called at query time) to avoid module-load-time schema access,
 * which would break test files that mock schema/index.js without prWorkItems.
 *
 * Used by listPRsForProject, listPRsForOrg, listPRsForWorkItem, and listUnifiedWorkForProject.
 */
function getPRSummarySelect() {
	return {
		prNumber: prWorkItems.prNumber,
		repoFullName: prWorkItems.repoFullName,
		prUrl: prWorkItems.prUrl,
		prTitle: prWorkItems.prTitle,
		workItemId: prWorkItems.workItemId,
		workItemUrl: prWorkItems.workItemUrl,
		workItemTitle: prWorkItems.workItemTitle,
		runCount: countDistinct(agentRuns.id),
	};
}

/**
 * Returns the shared groupBy columns for PR summary queries.
 * Evaluated lazily (called at query time) to avoid module-load-time schema access.
 *
 * Used by listPRsForProject, listPRsForOrg, listPRsForWorkItem, and (via spread) listUnifiedWorkForProject.
 */
function getPRSummaryGroupBy() {
	return [
		prWorkItems.prNumber,
		prWorkItems.repoFullName,
		prWorkItems.prUrl,
		prWorkItems.prTitle,
		prWorkItems.workItemId,
		prWorkItems.workItemUrl,
		prWorkItems.workItemTitle,
	] as const;
}

/**
 * Internal query builder that executes the shared PR summary query pattern.
 * Accepts a WHERE condition and returns the matching PR summaries ordered by prNumber.
 */
async function queryPRSummaries(whereCondition: SQL): Promise<PRSummary[]> {
	const db = getDb();
	return db
		.select(getPRSummarySelect())
		.from(prWorkItems)
		.leftJoin(agentRuns, buildAgentRunWorkItemJoin())
		.where(whereCondition)
		.groupBy(...getPRSummaryGroupBy())
		.orderBy(prWorkItems.prNumber);
}

/**
 * Resolve project IDs for a given org. Returns an empty array if no projects found.
 * Used by listPRsForOrg and listWorkItems (org-scoped queries).
 */
async function resolveOrgProjectIds(orgId: string): Promise<string[]> {
	const db = getDb();
	const rows = await db.select({ id: projects.id }).from(projects).where(eq(projects.orgId, orgId));
	return rows.map((p) => p.id);
}

// ============================================================================
// List queries
// ============================================================================

export interface WorkItemSummary {
	workItemId: string;
	workItemUrl: string | null;
	workItemTitle: string | null;
	prCount: number;
	runCount: number;
}

/**
 * Returns distinct work items for an org (all projects), with optional projectId filter.
 * Includes counts of associated PRs and agent runs.
 * Only rows with a non-null workItemId are included.
 */
export async function listWorkItems(orgId: string, projectId?: string): Promise<WorkItemSummary[]> {
	const db = getDb();

	const conditions: SQL[] = [isNotNull(prWorkItems.workItemId)];

	if (projectId) {
		conditions.push(eq(prWorkItems.projectId, projectId));
	} else {
		// Filter by org: resolve project IDs for this org
		const ids = await resolveOrgProjectIds(orgId);
		if (ids.length === 0) return [];
		conditions.push(inArray(prWorkItems.projectId, ids));
	}

	const rows = await db
		.select({
			workItemId: prWorkItems.workItemId,
			workItemUrl: max(prWorkItems.workItemUrl),
			workItemTitle: max(prWorkItems.workItemTitle),
			prCount: countDistinct(prWorkItems.id),
			runCount: countDistinct(agentRuns.id),
		})
		.from(prWorkItems)
		.leftJoin(agentRuns, buildAgentRunWorkItemJoin())
		.where(and(...conditions))
		.groupBy(prWorkItems.workItemId);

	return rows.map((r) => ({
		workItemId: r.workItemId as string,
		workItemUrl: r.workItemUrl,
		workItemTitle: r.workItemTitle,
		prCount: r.prCount,
		runCount: r.runCount,
	}));
}

export interface PRSummary {
	prNumber: number | null;
	repoFullName: string | null;
	prUrl: string | null;
	prTitle: string | null;
	workItemId: string | null;
	workItemUrl: string | null;
	workItemTitle: string | null;
	runCount: number;
}

/**
 * Returns all PR entries for a project (with associated work item display info and run count).
 * Optionally filter by projectId; if omitted, returns all PRs across the org.
 */
export async function listPRsForProject(projectId: string): Promise<PRSummary[]> {
	return queryPRSummaries(eq(prWorkItems.projectId, projectId));
}

/**
 * Returns all PR entries for an org (all projects), with associated work item display info and run count.
 */
export async function listPRsForOrg(orgId: string): Promise<PRSummary[]> {
	const ids = await resolveOrgProjectIds(orgId);
	if (ids.length === 0) return [];
	return queryPRSummaries(inArray(prWorkItems.projectId, ids));
}

/**
 * Returns all PRs linked to a specific work item within a project.
 */
export async function listPRsForWorkItem(
	projectId: string,
	workItemId: string,
): Promise<PRSummary[]> {
	return queryPRSummaries(
		and(eq(prWorkItems.projectId, projectId), eq(prWorkItems.workItemId, workItemId)) as SQL,
	);
}

/**
 * Look up the work item ID linked to a PR.
 * Returns null if no link exists.
 */
export async function lookupWorkItemForPR(
	projectId: string,
	prNumber: number,
): Promise<string | null> {
	const db = getDb();
	const rows = await db
		.select({ workItemId: prWorkItems.workItemId })
		.from(prWorkItems)
		.where(and(eq(prWorkItems.projectId, projectId), eq(prWorkItems.prNumber, prNumber)))
		.limit(1);
	return rows.length > 0 ? rows[0].workItemId : null;
}

/**
 * Which project owns a PR, by repository (spec 024).
 *
 * The mirror of {@link lookupWorkItemForPR}: that one asks "given a project,
 * which work item?", this asks "given a repository, which project?". It is the
 * authoritative answer for every PR CASCADE created, which is what lets several
 * projects share one repository — an event about a linked PR goes to its owner
 * regardless of which project is the repository's primary.
 *
 * Newest row wins if a PR was somehow linked twice; a PR with no link returns
 * null and the caller falls back to the repository's primary project.
 */
export async function findProjectIdByRepoPrFromDb(
	repoFullName: string,
	prNumber: number,
): Promise<string | null> {
	const db = getDb();
	const rows = await db
		.select({ projectId: prWorkItems.projectId })
		.from(prWorkItems)
		.where(and(eq(prWorkItems.repoFullName, repoFullName), eq(prWorkItems.prNumber, prNumber)))
		.orderBy(desc(prWorkItems.updatedAt))
		.limit(1);
	return rows.length > 0 ? rows[0].projectId : null;
}

// ============================================================================
// Unified work view
// ============================================================================

export interface UnifiedWorkItem {
	id: string;
	type: 'pr' | 'linked' | 'work-item';
	prNumber: number | null;
	repoFullName: string | null;
	prUrl: string | null;
	prTitle: string | null;
	workItemId: string | null;
	workItemUrl: string | null;
	workItemTitle: string | null;
	runCount: number;
	updatedAt: Date | null;
	totalCostUsd: string | null;
}

/**
 * Returns all PR entries for a project as a unified work view, ordered by updatedAt desc.
 * PRs without a linked work item have type 'pr'; rows with both have type 'linked'.
 * Work-item-only rows (no PR yet) have type 'work-item'.
 */
export async function listUnifiedWorkForProject(projectId: string): Promise<UnifiedWorkItem[]> {
	const db = getDb();
	const rows = await db
		.select({
			id: prWorkItems.id,
			...getPRSummarySelect(),
			updatedAt: prWorkItems.updatedAt,
			totalCostUsd: sum(agentRuns.costUsd),
		})
		.from(prWorkItems)
		.leftJoin(agentRuns, buildAgentRunWorkItemJoin())
		.where(eq(prWorkItems.projectId, projectId))
		.groupBy(prWorkItems.id, ...getPRSummaryGroupBy(), prWorkItems.updatedAt)
		.orderBy(desc(prWorkItems.updatedAt));

	return rows.map((r) => {
		let type: 'pr' | 'linked' | 'work-item';
		if (r.prNumber === null) {
			type = 'work-item';
		} else if (r.workItemId) {
			type = 'linked';
		} else {
			type = 'pr';
		}
		return {
			id: r.id,
			type,
			prNumber: r.prNumber,
			repoFullName: r.repoFullName,
			prUrl: r.prUrl,
			prTitle: r.prTitle,
			workItemId: r.workItemId,
			workItemUrl: r.workItemUrl,
			workItemTitle: r.workItemTitle,
			runCount: r.runCount,
			updatedAt: r.updatedAt,
			totalCostUsd: r.totalCostUsd ?? null,
		};
	});
}

// ============================================================================
// Unified work view with durations
// ============================================================================

export interface WorkItemRunBreakdown {
	agentType: string;
	durationMs: number;
	status: string;
}

export interface UnifiedWorkItemWithDurations extends UnifiedWorkItem {
	runs: WorkItemRunBreakdown[];
}

export interface UnifiedWorkWithDurationsResult {
	items: UnifiedWorkItemWithDurations[];
	projectAvgDurationMs: number | null;
}

/**
 * Returns unified work items for a project, each with an array of per-run duration breakdowns.
 * Also computes the project-wide average total duration for outlier detection.
 *
 * Two-query approach:
 * - Query 1: existing unified items (same as listUnifiedWorkForProject)
 * - Query 2: agent_runs for the project (completed/failed/timed_out, durationMs IS NOT NULL),
 *   joined back to pr_work_items via the dual-join logic to associate runs with work items.
 */
export async function listUnifiedWorkWithDurations(
	projectId: string,
): Promise<UnifiedWorkWithDurationsResult> {
	const db = getDb();

	// Query 1: Fetch unified work items (same as listUnifiedWorkForProject)
	const items = await listUnifiedWorkForProject(projectId);

	// Query 2: Fetch per-work-item run breakdowns (completed/failed/timed_out with durationMs)
	// We join agent_runs to pr_work_items using the dual-join condition to attribute
	// each run to a pr_work_items row.
	const runRows = await db
		.select({
			prWorkItemId: prWorkItems.id,
			agentType: agentRuns.agentType,
			durationMs: agentRuns.durationMs,
			status: agentRuns.status,
		})
		.from(agentRuns)
		.innerJoin(prWorkItems, buildAgentRunWorkItemJoin())
		.where(
			and(
				eq(prWorkItems.projectId, projectId),
				isNotNull(agentRuns.durationMs),
				inArray(agentRuns.status, ['completed', 'failed', 'timed_out']),
			),
		);

	// Build a map of prWorkItems.id → runs
	const runsByWorkItemId = new Map<string, WorkItemRunBreakdown[]>();
	for (const row of runRows) {
		const existing = runsByWorkItemId.get(row.prWorkItemId) ?? [];
		existing.push({
			agentType: row.agentType,
			durationMs: row.durationMs as number,
			status: row.status,
		});
		runsByWorkItemId.set(row.prWorkItemId, existing);
	}

	// Compute project-wide average total duration across all work items that have runs
	let projectAvgDurationMs: number | null = null;
	const itemTotals: number[] = [];
	for (const [, runs] of runsByWorkItemId) {
		const total = runs.reduce((s, r) => s + r.durationMs, 0);
		if (total > 0) itemTotals.push(total);
	}
	if (itemTotals.length > 0) {
		projectAvgDurationMs = itemTotals.reduce((s, v) => s + v, 0) / itemTotals.length;
	}

	// Merge runs into unified items
	const itemsWithDurations: UnifiedWorkItemWithDurations[] = items.map((item) => ({
		...item,
		runs: runsByWorkItemId.get(item.id) ?? [],
	}));

	return { items: itemsWithDurations, projectAvgDurationMs };
}

// ── Alert-materialization repository methods (spec 019) ──────────────────────

/** Find an existing alert-mapping row by (projectId, source, externalId). */
export async function findByExternal(
	projectId: string,
	source: AlertSource,
	externalId: string,
): Promise<{ id: string; workItemId: string | null } | null> {
	const db = getDb();
	const rows = await db
		.select({ id: prWorkItems.id, workItemId: prWorkItems.workItemId })
		.from(prWorkItems)
		.where(
			and(
				eq(prWorkItems.projectId, projectId),
				eq(prWorkItems.externalSource, source),
				eq(prWorkItems.externalId, externalId),
			),
		)
		.limit(1);
	return rows[0] ?? null;
}

type ClaimResult =
	| { ownedHere: true; rowId: string }
	| { ownedHere: false; existing: { id: string; workItemId: string | null } };

/**
 * Atomically get-or-create an alert mapping row.
 *
 * Executes INSERT … ON CONFLICT (project_id, external_source, external_id)
 * WHERE external_source IS NOT NULL DO NOTHING RETURNING id.
 * If the insert wins (no conflict), returns ownedHere=true with the new row id.
 * If the insert loses (conflict), follows up with a SELECT to find the winner.
 */
export async function claimExternalMapping(
	projectId: string,
	source: AlertSource,
	externalId: string,
): Promise<ClaimResult> {
	const db = getDb();

	const inserted = await db
		.insert(prWorkItems)
		.values({ projectId, externalSource: source, externalId })
		.onConflictDoNothing()
		.returning({ id: prWorkItems.id });

	if (inserted.length > 0) {
		return { ownedHere: true, rowId: inserted[0].id };
	}

	// Conflict path — find the winning row
	const existing = await findByExternal(projectId, source, externalId);
	if (!existing) {
		// Should be unreachable: if insert was rejected on conflict there MUST be a winner
		throw new Error(
			`[claimExternalMapping] conflict but no row found for (${projectId}, ${source}, ${externalId})`,
		);
	}
	return { ownedHere: false, existing };
}

/** Write the native PM work-item id into the claimed alert-mapping row. */
export async function attachWorkItemId(rowId: string, workItemId: string): Promise<void> {
	const db = getDb();
	await db
		.update(prWorkItems)
		.set({ workItemId, updatedAt: new Date() })
		.where(eq(prWorkItems.id, rowId));
}

/**
 * Atomically replace the native PM work-item id (lazy-heal path).
 * Only updates when the current value matches `oldWorkItemId`.
 * Returns true when the row was updated, false when the value was stale.
 */
export async function replaceWorkItemId(
	rowId: string,
	oldWorkItemId: string,
	newWorkItemId: string,
): Promise<boolean> {
	const db = getDb();
	const updated = await db
		.update(prWorkItems)
		.set({ workItemId: newWorkItemId, updatedAt: new Date() })
		.where(and(eq(prWorkItems.id, rowId), eq(prWorkItems.workItemId, oldWorkItemId)))
		.returning({ id: prWorkItems.id });
	return updated.length > 0;
}

/**
 * Delete an alert-mapping claim row that still has a NULL work_item_id.
 *
 * Called when PM side effects (createWorkItem, attachWorkItemId) fail after
 * `claimExternalMapping` inserted the row. Without cleanup, a NULL-work_item_id
 * row permanently blocks future retries: `claimExternalMapping` loses the race
 * to the stale row and polls until `MaterializationRetryExhausted`.
 *
 * The `isNull(workItemId)` guard makes this a no-op when another process has
 * already successfully filled in the PM id — safe to call unconditionally in
 * error handlers.
 */
export async function deleteExternalMappingClaim(rowId: string): Promise<void> {
	const db = getDb();
	await db
		.delete(prWorkItems)
		.where(and(eq(prWorkItems.id, rowId), isNull(prWorkItems.workItemId)));
}
