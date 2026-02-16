import { getPMProvider } from '../../../pm/index.js';

export interface UpdateWorkItemParams {
	workItemId: string;
	title?: string;
	description?: string;
	addLabelIds?: string[];
}

export async function updateWorkItem(params: UpdateWorkItemParams): Promise<string> {
	if (!params.title && !params.description && !params.addLabelIds?.length) {
		return 'Nothing to update - provide title, description, or labels';
	}

	try {
		const provider = getPMProvider();

		if (params.title || params.description) {
			await provider.updateWorkItem(params.workItemId, {
				title: params.title,
				description: params.description,
			});
		}

		if (params.addLabelIds?.length) {
			for (const labelId of params.addLabelIds) {
				await provider.addLabel(params.workItemId, labelId);
			}
		}

		const updated: string[] = [];
		if (params.title) updated.push('title');
		if (params.description) updated.push('description');
		if (params.addLabelIds?.length) updated.push(`${params.addLabelIds.length} label(s)`);

		return `Work item updated: ${updated.join(', ')}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error updating work item: ${message}`;
	}
}
