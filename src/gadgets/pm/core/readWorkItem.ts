import { getPMProvider } from '../../../pm/index.js';

export async function readWorkItem(workItemId: string, includeComments = true): Promise<string> {
	try {
		const provider = getPMProvider();
		const [item, checklists, attachments] = await Promise.all([
			provider.getWorkItem(workItemId),
			provider.getChecklists(workItemId),
			provider.getAttachments(workItemId),
		]);

		let result = `# ${item.title}\n\n**URL:** ${item.url}\n\n## Description\n\n${item.description || '(No description)'}\n\n`;

		if (item.labels.length > 0) {
			result += `## Labels\n\n${item.labels.map((l) => `- ${l.name}${l.color ? ` (${l.color})` : ''}`).join('\n')}\n\n`;
		}

		if (checklists.length > 0) {
			result += '## Checklists\n\n';
			for (const checklist of checklists) {
				result += `### ${checklist.name} [checklistId: ${checklist.id}]\n\n`;
				for (const item of checklist.items) {
					const checkbox = item.complete ? '[x]' : '[ ]';
					result += `- ${checkbox} ${item.name} [checkItemId: ${item.id}]\n`;
				}
				result += '\n';
			}
		}

		if (attachments.length > 0) {
			result += '## Attachments\n\n';
			for (const att of attachments) {
				result += `- [${att.name}](${att.url})`;
				if (att.date) {
					result += ` (${new Date(att.date).toISOString()})`;
				}
				result += '\n';
			}
			result += '\n';
		}

		if (includeComments) {
			const comments = await provider.getWorkItemComments(workItemId);
			if (comments.length === 0) {
				result += '## Comments\n\n(No comments)\n\n';
			} else {
				result += `## Comments (${comments.length})\n\n`;
				for (const comment of comments.slice().reverse()) {
					const date = new Date(comment.date).toISOString();
					result += `### ${comment.author.name} (${date})\n\n`;
					result += `${comment.text}\n\n`;
				}
			}
		}

		return result;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error reading work item: ${message}`;
	}
}
