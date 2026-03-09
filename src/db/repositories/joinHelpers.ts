import { type SQL, and, eq, or, sql } from 'drizzle-orm';
import { agentRuns, prWorkItems } from '../schema/index.js';

/**
 * Build the OR condition for joining agent_runs to pr_work_items via either:
 * - (projectId, prNumber) — existing PR-linked runs
 * - (projectId, cardId = workItemId) — PM-triggered runs (work-item-only rows)
 *
 * This dual-join approach ensures PM-triggered runs appear linked in the
 * dashboard even before a PR is created. Once a PR is created and the
 * work-item row is promoted (prNumber set), PM-triggered runs (which have
 * cardId but no prNumber) will still match via the second branch because
 * their cardId = workItemId.
 */
export function buildAgentRunWorkItemJoin(): SQL | undefined {
	return or(
		// Branch 1: Match by prNumber (for PR-triggered runs)
		and(
			eq(agentRuns.projectId, prWorkItems.projectId),
			eq(agentRuns.prNumber, prWorkItems.prNumber),
		),
		// Branch 2: Match by cardId = workItemId (only for PM-triggered runs that have no prNumber)
		// The isNull(agentRuns.prNumber) guard prevents duplicate rows in non-aggregate queries
		// when a work item has multiple linked PRs.
		and(
			eq(agentRuns.projectId, prWorkItems.projectId),
			sql`${agentRuns.cardId} = ${prWorkItems.workItemId}`,
			sql`${agentRuns.prNumber} IS NULL`,
		),
	);
}
