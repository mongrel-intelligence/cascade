import { trelloClient } from '../../../trello/client.js';

export interface AddChecklistParams {
	cardId: string;
	checklistName: string;
	items: string[];
}

export async function addChecklist(params: AddChecklistParams): Promise<string> {
	try {
		const checklist = await trelloClient.createChecklist(params.cardId, params.checklistName);

		for (const item of params.items) {
			await trelloClient.addChecklistItem(checklist.id, item);
		}

		return `Checklist "${params.checklistName}" created with ${params.items.length} items on card ${params.cardId}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error adding checklist: ${message}`;
	}
}
