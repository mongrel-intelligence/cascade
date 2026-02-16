import { getPMProvider } from '../../../pm/index.js';

interface Label {
	name: string;
	color?: string;
}

interface ChecklistItem {
	id: string;
	name: string;
	complete: boolean;
}

interface Checklist {
	id: string;
	name: string;
	items: ChecklistItem[];
}

interface Attachment {
	name: string;
	url: string;
	date?: string;
}

interface Comment {
	author: { name: string };
	date: string;
	text: string;
}

function formatLabels(labels: Label[]): string {
	if (labels.length === 0) return '';
	const items = labels.map((l) => `- ${l.name}${l.color ? ` (${l.color})` : ''}`).join('\n');
	return `## Labels\n\n${items}\n\n`;
}

function formatChecklists(checklists: Checklist[]): string {
	if (checklists.length === 0) return '';
	let result = '## Checklists\n\n';
	for (const checklist of checklists) {
		result += `### ${checklist.name} [checklistId: ${checklist.id}]\n\n`;
		for (const item of checklist.items) {
			const checkbox = item.complete ? '[x]' : '[ ]';
			result += `- ${checkbox} ${item.name} [checkItemId: ${item.id}]\n`;
		}
		result += '\n';
	}
	return result;
}

function formatAttachments(attachments: Attachment[]): string {
	if (attachments.length === 0) return '';
	let result = '## Attachments\n\n';
	for (const att of attachments) {
		result += `- [${att.name}](${att.url})`;
		if (att.date) {
			result += ` (${new Date(att.date).toISOString()})`;
		}
		result += '\n';
	}
	return `${result}\n`;
}

function formatComments(comments: Comment[]): string {
	if (comments.length === 0) return '## Comments\n\n(No comments)\n\n';
	let result = `## Comments (${comments.length})\n\n`;
	for (const comment of comments.slice().reverse()) {
		const date = new Date(comment.date).toISOString();
		result += `### ${comment.author.name} (${date})\n\n`;
		result += `${comment.text}\n\n`;
	}
	return result;
}

export async function readWorkItem(workItemId: string, includeComments = true): Promise<string> {
	try {
		const provider = getPMProvider();
		const [item, checklists, attachments] = await Promise.all([
			provider.getWorkItem(workItemId),
			provider.getChecklists(workItemId),
			provider.getAttachments(workItemId),
		]);

		let result = `# ${item.title}\n\n**URL:** ${item.url}\n\n## Description\n\n${item.description || '(No description)'}\n\n`;
		result += formatLabels(item.labels);
		result += formatChecklists(checklists);
		result += formatAttachments(attachments);

		if (includeComments) {
			const comments = await provider.getWorkItemComments(workItemId);
			result += formatComments(comments);
		}

		return result;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error reading work item: ${message}`;
	}
}
