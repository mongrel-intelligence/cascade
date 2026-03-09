import {
	type SQL,
	and,
	countDistinct,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	max,
	or,
	sql,
	sum,
} from 'drizzle-orm';
import { getDb } from '../client.js';
import { agentRuns, prWorkItems, projects } from '../schema/index.js';

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
 * Uses an upsert on (projectId, workItemId) WHERE prNumber IS NULL
 * so re-triggering the same card is idempotent.
 */
export async function createWorkItem(
	projectId: string,
	workItemId: string,
	options: Pick<LinkPRToWorkItemOptions, 'workItemUrl' | 'workItemTitle'> = {},
): Promise<void> {
	const db = getDb();
	const now = new Date();
	const { workItemUrl, workItemTitle } = options;

	// Try to insert a work-item-only row. If a row already exists for this
	// (projectId, workItemId) with no prNumber, update the display fields.
	// If a row already exists WITH a prNumber (PR was already linked), do nothing.
	await db
		.insert(prWorkItems)
		.values({
			projectId,
			workItemId,
			workItemUrl,
			workItemTitle,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [prWorkItems.projectId, prWorkItems.workItemId],
			targetWhere: isNull(prWorkItems.prNumber),
			set: {
				workItemUrl,
				workItemTitle,
				updatedAt: now,
			},
		});
}

/**
 * Upsert a PR ↔ work item link.
 *
 * Two-step logic:
 * 1. If a work-item-only row exists for (projectId, workItemId), UPDATE it with PR data.
 * 2. Otherwise INSERT a new row, using onConflictDoUpdate on (projectId, prNumber).
 *
 * workItemId is optional to support "orphan" PRs (PRs created without a linked work item).
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

	// Step 1: If workItemId is provided, try to update the existing work-item-only row
	if (workItemId) {
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
			set: {
				workItemId,
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

/**
 * Build the OR condition for joining agent_runs to pr_work_items via either:
 * - (projectId, prNumber) — existing PR-linked runs
 * - (projectId, cardId = workItemId) — PM-triggered runs (work-item-only rows)
 */
function dualJoinCondition() {
	return or(
		and(
			eq(agentRuns.projectId, prWorkItems.projectId),
			eq(agentRuns.prNumber, prWorkItems.prNumber),
		),
		and(
			eq(agentRuns.projectId, prWorkItems.projectId),
			sql`${agentRuns.cardId} = ${prWorkItems.workItemId}`,
			isNull(prWorkItems.prNumber),
		),
	);
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
		// Filter by org: join with projects and restrict to org
		const projectIds = await db
			.select({ id: projects.id })
			.from(projects)
			.where(eq(projects.orgId, orgId));
		const ids = projectIds.map((p) => p.id);
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
		.leftJoin(agentRuns, dualJoinCondition())
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
	const db = getDb();
	const rows = await db
		.select({
			prNumber: prWorkItems.prNumber,
			repoFullName: prWorkItems.repoFullName,
			prUrl: prWorkItems.prUrl,
			prTitle: prWorkItems.prTitle,
			workItemId: prWorkItems.workItemId,
			workItemUrl: prWorkItems.workItemUrl,
			workItemTitle: prWorkItems.workItemTitle,
			runCount: countDistinct(agentRuns.id),
		})
		.from(prWorkItems)
		.leftJoin(agentRuns, dualJoinCondition())
		.where(eq(prWorkItems.projectId, projectId))
		.groupBy(
			prWorkItems.prNumber,
			prWorkItems.repoFullName,
			prWorkItems.prUrl,
			prWorkItems.prTitle,
			prWorkItems.workItemId,
			prWorkItems.workItemUrl,
			prWorkItems.workItemTitle,
		)
		.orderBy(prWorkItems.prNumber);

	return rows;
}

/**
 * Returns all PR entries for an org (all projects), with associated work item display info and run count.
 */
export async function listPRsForOrg(orgId: string): Promise<PRSummary[]> {
	const db = getDb();

	const projectIds = await db
		.select({ id: projects.id })
		.from(projects)
		.where(eq(projects.orgId, orgId));
	const ids = projectIds.map((p) => p.id);
	if (ids.length === 0) return [];

	const rows = await db
		.select({
			prNumber: prWorkItems.prNumber,
			repoFullName: prWorkItems.repoFullName,
			prUrl: prWorkItems.prUrl,
			prTitle: prWorkItems.prTitle,
			workItemId: prWorkItems.workItemId,
			workItemUrl: prWorkItems.workItemUrl,
			workItemTitle: prWorkItems.workItemTitle,
			runCount: countDistinct(agentRuns.id),
		})
		.from(prWorkItems)
		.leftJoin(agentRuns, dualJoinCondition())
		.where(inArray(prWorkItems.projectId, ids))
		.groupBy(
			prWorkItems.prNumber,
			prWorkItems.repoFullName,
			prWorkItems.prUrl,
			prWorkItems.prTitle,
			prWorkItems.workItemId,
			prWorkItems.workItemUrl,
			prWorkItems.workItemTitle,
		)
		.orderBy(prWorkItems.prNumber);

	return rows;
}

/**
 * Returns all PRs linked to a specific work item within a project.
 */
export async function listPRsForWorkItem(
	projectId: string,
	workItemId: string,
): Promise<PRSummary[]> {
	const db = getDb();
	const rows = await db
		.select({
			prNumber: prWorkItems.prNumber,
			repoFullName: prWorkItems.repoFullName,
			prUrl: prWorkItems.prUrl,
			prTitle: prWorkItems.prTitle,
			workItemId: prWorkItems.workItemId,
			workItemUrl: prWorkItems.workItemUrl,
			workItemTitle: prWorkItems.workItemTitle,
			runCount: countDistinct(agentRuns.id),
		})
		.from(prWorkItems)
		.leftJoin(agentRuns, dualJoinCondition())
		.where(and(eq(prWorkItems.projectId, projectId), eq(prWorkItems.workItemId, workItemId)))
		.groupBy(
			prWorkItems.prNumber,
			prWorkItems.repoFullName,
			prWorkItems.prUrl,
			prWorkItems.prTitle,
			prWorkItems.workItemId,
			prWorkItems.workItemUrl,
			prWorkItems.workItemTitle,
		)
		.orderBy(prWorkItems.prNumber);

	return rows;
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
			prNumber: prWorkItems.prNumber,
			repoFullName: prWorkItems.repoFullName,
			prUrl: prWorkItems.prUrl,
			prTitle: prWorkItems.prTitle,
			workItemId: prWorkItems.workItemId,
			workItemUrl: prWorkItems.workItemUrl,
			workItemTitle: prWorkItems.workItemTitle,
			updatedAt: prWorkItems.updatedAt,
			runCount: countDistinct(agentRuns.id),
			totalCostUsd: sum(agentRuns.costUsd),
		})
		.from(prWorkItems)
		.leftJoin(agentRuns, dualJoinCondition())
		.where(eq(prWorkItems.projectId, projectId))
		.groupBy(
			prWorkItems.id,
			prWorkItems.prNumber,
			prWorkItems.repoFullName,
			prWorkItems.prUrl,
			prWorkItems.prTitle,
			prWorkItems.workItemId,
			prWorkItems.workItemUrl,
			prWorkItems.workItemTitle,
			prWorkItems.updatedAt,
		)
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
