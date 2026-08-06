import { gitlabClient } from '../../../gitlab/client.js';
import { buildRunLinkFooterFromEnv } from '../../../utils/runLink.js';

export async function postMRNote(
	projectPath: string,
	mrIid: number,
	body: string,
): Promise<string> {
	try {
		const runLinkFooter = buildRunLinkFooterFromEnv();
		const fullBody = runLinkFooter ? body + runLinkFooter : body;
		const result = await gitlabClient.createMRNote(projectPath, mrIid, fullBody);
		return `Note posted (id: ${result.id})`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error posting MR note: ${message}`;
	}
}
