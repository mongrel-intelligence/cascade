import { getPMProvider } from '../../../pm/index.js';

export interface ListWorkItemsParams {
	containerId?: string;
	status?: string;
}

function normalizeListParams(params: string | ListWorkItemsParams): ListWorkItemsParams {
	return typeof params === 'string' ? { containerId: params } : params;
}

function assertListParams(params: ListWorkItemsParams): void {
	if (!params.containerId && !params.status) {
		throw new Error('Either containerId or status is required.');
	}
	if (process.env.CASCADE_AGENT_TYPE === 'backlog-manager' && !params.status) {
		throw new Error(
			'Backlog-manager must list work items with a status filter, e.g. status: "backlog".',
		);
	}
}

export async function listWorkItems(params: string | ListWorkItemsParams): Promise<string> {
	try {
		const normalized = normalizeListParams(params);
		assertListParams(normalized);

		const items = await getPMProvider().listWorkItems(normalized.containerId, {
			...(normalized.status ? { status: normalized.status } : {}),
		});

		if (items.length === 0) {
			return 'No work items found.';
		}

		let result = `# Work Items (${items.length})\n\n`;
		for (const item of items) {
			result += `## ${item.title}\n`;
			result += `- **ID:** ${item.id}\n`;
			result += `- **URL:** ${item.url}\n`;
			if (item.description) {
				result += `- **Description:** ${item.description.slice(0, 100)}${item.description.length > 100 ? '...' : ''}\n`;
			}
			result += '\n';
		}

		return result;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Error listing work items: ${message}`);
	}
}
