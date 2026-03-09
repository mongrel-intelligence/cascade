import { getPMProvider } from '../../../pm/index.js';

export interface MoveWorkItemParams {
	workItemId: string;
	destination: string;
}

export async function moveWorkItem(params: MoveWorkItemParams): Promise<string> {
	try {
		await getPMProvider().moveWorkItem(params.workItemId, params.destination);
		return `Work item ${params.workItemId} moved to ${params.destination} successfully`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error moving work item: ${message}`;
	}
}
