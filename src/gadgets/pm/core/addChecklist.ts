import { getPMProvider } from '../../../pm/index.js';
import type { ChecklistItemDraft } from '../../../pm/types.js';

export type ChecklistItemInput = string | { name: string; description?: string };

export interface AddChecklistParams {
	workItemId: string;
	checklistName: string;
	items: ChecklistItemInput[];
}

export async function addChecklist(params: AddChecklistParams): Promise<string> {
	if (params.items.length === 0) {
		throw new Error('At least one checklist item is required');
	}

	const provider = getPMProvider();
	const items = params.items.map(normalizeChecklistItem);

	if (typeof provider.createChecklistWithItems === 'function') {
		await provider.createChecklistWithItems(params.workItemId, params.checklistName, items);
		return successMessage(params.workItemId, params.checklistName, items.length);
	}

	const checklist = await provider.createChecklist(params.workItemId, params.checklistName);

	for (const item of items) {
		await provider.addChecklistItem(checklist.id, item.name, item.checked, item.description);
	}

	return successMessage(params.workItemId, params.checklistName, items.length);
}

function normalizeChecklistItem(item: ChecklistItemInput): ChecklistItemDraft {
	if (typeof item === 'string') return { name: item, checked: false };
	return { name: item.name, checked: false, description: item.description };
}

function successMessage(workItemId: string, checklistName: string, itemCount: number): string {
	return `Checklist "${checklistName}" created with ${itemCount} items on work item ${workItemId}`;
}
