import { and, eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { prWorkItems } from '../schema/index.js';

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
