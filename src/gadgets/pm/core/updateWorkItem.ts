import { getPMProvider } from '../../../pm/index.js';
import { currentTimestamp, type WorkItemUpdatedResult } from './mutationResults.js';
import { readWorkItemContext } from './readWorkItemContext.js';

export interface UpdateWorkItemParams {
	workItemId: string;
	title?: string;
	description?: string;
	addLabelIds?: string[];
}

/**
 * Update a work item — any of `title`, `description`, or `addLabelIds`. Title
 * and description are sent in one provider call; label additions go through
 * `provider.addLabel` per label.
 *
 * Returns a structured `WorkItemUpdatedResult` so downstream consumers can
 * branch on shape rather than parsing prose. Two outcomes:
 *   - `'updated'` — at least one field or label was sent to the provider.
 *     `changedFields` lists the fields written; `addedLabelIds` echoes the
 *     applied label IDs. The current work-item metadata (`title`, `url`,
 *     `updatedAt`) is read back from the provider after the mutation so
 *     consumers see the post-write state.
 *   - `'noop'`    — the caller passed no updates. No provider write happens;
 *     the result still surfaces the work-item identity (best-effort URL +
 *     synthesised timestamp) so consumers can correlate the call back to a
 *     work item.
 *
 * Runtime provider errors propagate (no internal try/catch) so the CLI
 * factory emits the spec-014 `runtime` envelope and gadget wrappers can wrap
 * with `formatGadgetError`. Read-back failures after a successful mutation
 * fall back to a synthesised URL + timestamp rather than masking the mutation
 * success (delegated to `readWorkItemContext`).
 */
export async function updateWorkItem(params: UpdateWorkItemParams): Promise<WorkItemUpdatedResult> {
	const provider = getPMProvider();
	const hasTitle = Boolean(params.title);
	const hasDescription = Boolean(params.description);
	const labelIds = params.addLabelIds ?? [];
	const hasLabels = labelIds.length > 0;

	if (!hasTitle && !hasDescription && !hasLabels) {
		return buildNoopResult(params.workItemId);
	}

	if (hasTitle || hasDescription) {
		await provider.updateWorkItem(params.workItemId, {
			title: params.title,
			description: params.description,
		});
	}

	if (hasLabels) {
		for (const labelId of labelIds) {
			await provider.addLabel(params.workItemId, labelId);
		}
	}

	const changedFields: Array<'title' | 'description'> = [];
	if (hasTitle) changedFields.push('title');
	if (hasDescription) changedFields.push('description');

	const { title, workItemUrl, updatedAt } = await readWorkItemContext(params.workItemId);

	return {
		status: 'updated',
		id: params.workItemId,
		title: title ?? params.title ?? '',
		url: workItemUrl,
		updatedAt,
		changedFields,
		addedLabelIds: [...labelIds],
	};
}

async function buildNoopResult(workItemId: string): Promise<WorkItemUpdatedResult> {
	const { title, workItemUrl } = await readWorkItemContext(workItemId);
	return {
		status: 'noop',
		id: workItemId,
		title: title ?? '',
		url: workItemUrl,
		updatedAt: currentTimestamp(),
		changedFields: [],
		addedLabelIds: [],
		message: 'Nothing to update - provide title, description, or labels',
	};
}
