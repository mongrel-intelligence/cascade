import { gitlabClient } from '../../../gitlab/client.js';

export async function getPipelineStatus(projectPath: string, pipelineId: number): Promise<string> {
	try {
		const pipeline = await gitlabClient.getPipelineStatus(projectPath, pipelineId);

		return [
			`Pipeline #${pipeline.id}`,
			`Status: ${pipeline.status}`,
			`Ref: ${pipeline.ref}`,
			`SHA: ${pipeline.sha.slice(0, 7)}`,
			`URL: ${pipeline.webUrl}`,
		].join('\n');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error fetching pipeline status: ${message}`;
	}
}
