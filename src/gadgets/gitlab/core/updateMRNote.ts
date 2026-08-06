import { gitlabClient } from '../../../gitlab/client.js';

export async function updateMRNote(
	projectPath: string,
	mrIid: number,
	noteId: number,
	body: string,
): Promise<string> {
	try {
		const result = await gitlabClient.updateMRNote(projectPath, mrIid, noteId, body);
		return `Note updated (id: ${result.id})`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error updating MR note: ${message}`;
	}
}
