import { getPMProvider } from '../../../pm/index.js';

export interface AddChecklistParams {
	workItemId: string;
	checklistName: string;
	items: string[];
}

export async function addChecklist(params: AddChecklistParams): Promise<string> {
	try {
		const provider = getPMProvider();
		const checklist = await provider.createChecklist(params.workItemId, params.checklistName);

		for (const item of params.items) {
			await provider.addChecklistItem(checklist.id, item);
		}

		return `Checklist "${params.checklistName}" created with ${params.items.length} items on work item ${params.workItemId}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error adding checklist: ${message}`;
	}
}
