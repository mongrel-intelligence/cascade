import { getPMProvider } from '../../../pm/index.js';

export interface AddChecklistParams {
	workItemId: string;
	checklistName: string;
	items: string[];
}

export async function addChecklist(params: AddChecklistParams): Promise<string> {
	const provider = getPMProvider();
	const checklist = await provider.createChecklist(params.workItemId, params.checklistName);

	for (const item of params.items) {
		await provider.addChecklistItem(checklist.id, item);
	}

	return `Checklist "${params.checklistName}" created with ${params.items.length} items on work item ${params.workItemId}`;
}
