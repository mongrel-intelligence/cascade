import { gitlabClient } from '../../../gitlab/client.js';

export async function approveMR(
	projectPath: string,
	mrIid: number,
	action: 'approve' | 'unapprove',
): Promise<string> {
	try {
		if (action === 'approve') {
			await gitlabClient.approveMR(projectPath, mrIid);
			return `MR !${mrIid} approved`;
		} else {
			await gitlabClient.unapproveMR(projectPath, mrIid);
			return `MR !${mrIid} unapproved`;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error ${action === 'approve' ? 'approving' : 'unapproving'} MR: ${message}`;
	}
}
