import { getPMProvider } from '../../../pm/index.js';

export interface CreateWorkItemParams {
	containerId: string;
	title: string;
	description?: string;
}

export async function createWorkItem(params: CreateWorkItemParams): Promise<string> {
	const item = await getPMProvider().createWorkItem({
		containerId: params.containerId,
		title: params.title,
		description: params.description,
	});

	return `Work item created successfully: "${item.title}" - ${item.url}`;
}
