import { getPMProvider } from '../../../pm/index.js';

export async function updateChecklistItem(
	workItemId: string,
	checkItemId: string,
	complete: boolean,
): Promise<string> {
	try {
		await getPMProvider().updateChecklistItem(workItemId, checkItemId, complete);

		const action = complete ? 'marked complete' : 'marked incomplete';
		return `Checklist item ${checkItemId} ${action} on work item ${workItemId}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error updating checklist item: ${message}`;
	}
}
