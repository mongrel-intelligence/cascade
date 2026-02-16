import { getPMProvider } from '../../../pm/index.js';

export async function listWorkItems(containerId: string): Promise<string> {
	try {
		const items = await getPMProvider().listWorkItems(containerId);

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
		return `Error listing work items: ${message}`;
	}
}
