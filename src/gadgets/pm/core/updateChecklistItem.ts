import { getPMProvider } from '../../../pm/index.js';
import type { ChecklistItemUpdatedResult } from './mutationResults.js';
import { readWorkItemContext } from './readWorkItemContext.js';

/**
 * Toggle a checklist item's complete state on a work item.
 *
 * Returns a structured `ChecklistItemUpdatedResult` so downstream consumers
 * can branch on shape rather than parsing prose. The result carries the parent
 * work-item context (read back from the provider for URL + timestamp), the
 * affected `checkItemId`, the resulting boolean state, and the action status
 * (`'updated'`).
 *
 * Runtime provider errors propagate (no internal try/catch) per the spec
 * MNG-1424 contract. The gadget wrapper at
 * `src/gadgets/pm/UpdateChecklistItem.ts` wraps thrown errors with
 * `formatGadgetError`; the CLI factory wraps them in the spec-014 runtime
 * envelope. Read-back failures after a successful mutation fall back to a
 * synthesised URL + timestamp inside `readWorkItemContext` rather than
 * masking the mutation success.
 */
export async function updateChecklistItem(
	workItemId: string,
	checkItemId: string,
	complete: boolean,
): Promise<ChecklistItemUpdatedResult> {
	const provider = getPMProvider();
	await provider.updateChecklistItem(workItemId, checkItemId, complete);

	const { workItemUrl, updatedAt } = await readWorkItemContext(workItemId);

	return {
		status: 'updated',
		workItemId,
		workItemUrl,
		checkItemId,
		complete,
		updatedAt,
	};
}
