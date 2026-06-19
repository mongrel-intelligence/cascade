import { getPMProvider } from '../../../pm/index.js';
import type { Checklist, ChecklistItemDraft } from '../../../pm/types.js';
import type { ChecklistCreatedResult } from './mutationResults.js';
import { readWorkItemContext } from './readWorkItemContext.js';

export type ChecklistItemInput = string | { name: string; description?: string };

export interface AddChecklistParams {
	workItemId: string;
	checklistName: string;
	items: ChecklistItemInput[];
}

/**
 * Create a checklist on a work item with one or more items.
 *
 * Returns a structured `ChecklistCreatedResult` so downstream consumers can
 * branch on shape rather than parsing prose. The result carries the freshly-
 * created checklist identity, parent work-item URL/timestamp (read back from
 * the provider), the item count, and any per-item IDs the provider surfaced.
 *
 * Inline-description providers (Linear, JIRA) consume the optional bulk
 * `createChecklistWithItems` fast path and emit deterministic hashed IDs in
 * `result.itemIds`. Trello's native-checklist provider falls through to the
 * per-item path; `addChecklistItem` returns `void` there so `itemIds` ends up
 * empty — that's expected, and the field documentation calls it out.
 *
 * Runtime provider errors propagate (no internal try/catch) per the spec
 * MNG-1424 contract. The gadget wrapper at `src/gadgets/pm/AddChecklist.ts`
 * wraps thrown errors with `formatGadgetError`; the CLI factory wraps them in
 * the spec-014 runtime envelope.
 */
export async function addChecklist(params: AddChecklistParams): Promise<ChecklistCreatedResult> {
	if (params.items.length === 0) {
		throw new Error('At least one checklist item is required');
	}

	const provider = getPMProvider();
	const items = params.items.map(normalizeChecklistItem);

	let checklist: Checklist;
	if (typeof provider.createChecklistWithItems === 'function') {
		checklist = await provider.createChecklistWithItems(
			params.workItemId,
			params.checklistName,
			items,
		);
	} else {
		checklist = await provider.createChecklist(params.workItemId, params.checklistName);
		for (const item of items) {
			await provider.addChecklistItem(checklist.id, item.name, item.checked, item.description);
		}
	}

	const itemIds = (checklist.items ?? []).map((i) => i.id);
	const { workItemUrl, updatedAt } = await readWorkItemContext(params.workItemId);

	return {
		status: 'created',
		checklistId: checklist.id,
		checklistName: params.checklistName,
		workItemId: params.workItemId,
		workItemUrl,
		updatedAt,
		itemCount: items.length,
		itemIds,
	};
}

function normalizeChecklistItem(item: ChecklistItemInput): ChecklistItemDraft {
	if (typeof item === 'string') return { name: item, checked: false };
	return { name: item.name, checked: false, description: item.description };
}
