import { type SQL, and, countDistinct, eq, inArray, isNotNull, max } from 'drizzle-orm';
import { getDb } from '../client.js';
import { agentRuns, prWorkItems, projects } from '../schema/index.js';

export interface LinkPRToWorkItemOptions {
	workItemUrl?: string;
	workItemTitle?: string;
	prUrl?: string;
	prTitle?: string;
}

/**
 * Upsert a PR ↔ work item link. If a row already exists for the
 * (projectId, prNumber) pair, update the work item ID and optional display fields.
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
		.leftJoin(
			agentRuns,
			and(
				eq(agentRuns.projectId, prWorkItems.projectId),
				eq(agentRuns.prNumber, prWorkItems.prNumber),
			),
		)
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
	prNumber: number;
	repoFullName: string;
	prUrl: string | null;
	prTitle: string | null;
	workItemId: string | null;
	workItemUrl: string | null;
	workItemTitle: string | null;
}

/**
 * Returns all PR entries for a project (with associated work item display info).
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
		})
		.from(prWorkItems)
		.where(eq(prWorkItems.projectId, projectId))
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
		})
		.from(prWorkItems)
		.where(and(eq(prWorkItems.projectId, projectId), eq(prWorkItems.workItemId, workItemId)))
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
