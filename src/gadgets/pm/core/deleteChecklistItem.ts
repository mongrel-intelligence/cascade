import { getPMProvider } from '../../../pm/index.js';

export async function deleteChecklistItem(
	workItemId: string,
	checkItemId: string,
): Promise<string> {
	try {
		await getPMProvider().deleteChecklistItem(workItemId, checkItemId);
		return `Checklist item ${checkItemId} deleted from work item ${workItemId}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Error deleting checklist item: ${message}`);
	}
}
