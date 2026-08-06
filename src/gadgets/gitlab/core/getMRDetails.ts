import { gitlabClient } from '../../../gitlab/client.js';

export async function getMRDetails(projectPath: string, mrIid: number): Promise<string> {
	try {
		const mr = await gitlabClient.getMR(projectPath, mrIid);

		return [
			`MR !${mr.iid}: ${mr.title}`,
			`State: ${mr.state}`,
			`Branch: ${mr.sourceBranch} -> ${mr.targetBranch}`,
			`Author: ${mr.author.username}`,
			`URL: ${mr.webUrl}`,
			`Has conflicts: ${mr.hasConflicts}`,
			'',
			'Description:',
			mr.description || '(no description)',
		].join('\n');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error fetching MR details: ${message}`;
	}
}
