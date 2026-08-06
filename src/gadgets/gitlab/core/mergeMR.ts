import { gitlabClient } from '../../../gitlab/client.js';

export async function mergeMR(
	projectPath: string,
	mrIid: number,
	squash?: boolean,
): Promise<string> {
	try {
		await gitlabClient.mergeMR(projectPath, mrIid, { squash });
		return `MR !${mrIid} merged successfully${squash ? ' (squashed)' : ''}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error merging MR: ${message}`;
	}
}
