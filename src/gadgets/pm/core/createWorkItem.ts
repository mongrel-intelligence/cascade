import { getPMProvider } from '../../../pm/index.js';
import { pickTimestamp, type WorkItemCreatedResult } from './mutationResults.js';

export interface CreateWorkItemParams {
	containerId: string;
	title: string;
	description?: string;
}

/**
 * Create a work item in a container (Trello list / JIRA project / Linear
 * team).
 *
 * Returns a structured `WorkItemCreatedResult` so downstream consumers can
 * branch on shape rather than parsing prose. The result carries the
 * freshly-created work-item identity (`id`, `title`, `url`), the action
 * status (`'created'`), a provider-preferred `updatedAt`, and any
 * workflow-state fields the provider surfaced (`workflowStatus`,
 * `workflowStatusId`). Each provider populates these fields opportunistically
 * — JIRA's create endpoint does not echo a status, while Trello returns the
 * destination list ID and Linear surfaces the workflow state name via
 * `WorkItem.status`.
 *
 * Runtime provider errors propagate (no internal try/catch) so the CLI
 * factory emits the spec-014 `runtime` envelope and gadget wrappers can wrap
 * with `formatGadgetError`. The previous prose-returning contract was
 * lossy — consumers had to regex out `[id: ...]` and `https://...` from the
 * sentence to act on the result.
 */
export async function createWorkItem(params: CreateWorkItemParams): Promise<WorkItemCreatedResult> {
	const item = await getPMProvider().createWorkItem({
		containerId: params.containerId,
		title: params.title,
		description: params.description,
	});

	const result: WorkItemCreatedResult = {
		status: 'created',
		id: item.id,
		title: item.title,
		url: item.url,
		updatedAt: pickTimestamp(item.updatedAt ?? item.createdAt),
	};
	if (item.status) result.workflowStatus = item.status;
	if (item.statusId) result.workflowStatusId = item.statusId;
	return result;
}
