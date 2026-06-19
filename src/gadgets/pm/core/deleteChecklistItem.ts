import { getPMProvider } from '../../../pm/index.js';
import type { ChecklistItemDeletedResult } from './mutationResults.js';
import { readWorkItemContext } from './readWorkItemContext.js';

/**
 * Delete a checklist item from a work item.
 *
 * Returns a structured `ChecklistItemDeletedResult` so downstream consumers
 * can branch on shape rather than parsing prose. The result carries the parent
 * work-item context (read back from the provider for URL + timestamp), the
 * deleted `checkItemId`, and the action status (`'deleted'`).
 *
 * Runtime provider errors propagate (no internal try/catch) per the spec
 * MNG-1424 contract. The gadget wrapper at
 * `src/gadgets/pm/DeleteChecklistItem.ts` wraps thrown errors with
 * `formatGadgetError`; the CLI factory wraps them in the spec-014 runtime
 * envelope. Read-back failures after a successful mutation fall back to a
 * synthesised URL + timestamp inside `readWorkItemContext` rather than
 * masking the mutation success.
 */
export async function deleteChecklistItem(
	workItemId: string,
	checkItemId: string,
): Promise<ChecklistItemDeletedResult> {
	const provider = getPMProvider();
	await provider.deleteChecklistItem(workItemId, checkItemId);

	const { workItemUrl, updatedAt } = await readWorkItemContext(workItemId);

	return {
		status: 'deleted',
		workItemId,
		workItemUrl,
		checkItemId,
		updatedAt,
	};
}
