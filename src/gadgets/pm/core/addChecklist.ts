import { getPMProvider } from '../../../pm/index.js';

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
	const checklist = await provider.createChecklist(params.workItemId, params.checklistName);

	for (const item of params.items) {
		const name = typeof item === 'string' ? item : item.name;
		const description = typeof item === 'string' ? undefined : item.description;
		await provider.addChecklistItem(checklist.id, name, false, description);
	}

	return `Checklist "${params.checklistName}" created with ${params.items.length} items on work item ${params.workItemId}`;
}
