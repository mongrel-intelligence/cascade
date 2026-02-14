import { trelloClient } from '../../../trello/client.js';

export async function updateChecklistItem(
	cardId: string,
	checkItemId: string,
	state: 'complete' | 'incomplete',
): Promise<string> {
	try {
		await trelloClient.updateChecklistItem(cardId, checkItemId, state);

		const action = state === 'complete' ? 'marked complete' : 'marked incomplete';
		return `Checklist item ${checkItemId} ${action} on card ${cardId}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error updating checklist item: ${message}`;
	}
}
