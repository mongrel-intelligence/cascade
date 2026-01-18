import { Gadget, z } from 'llmist';
import { trelloClient } from '../../trello/client.js';
import { formatGadgetError } from '../utils.js';

export class ReadTrelloCard extends Gadget({
	name: 'ReadTrelloCard',
	description:
		'Read a Trello card to retrieve its title, description, comments, checklists, and attachments. Use this to understand the current state of the card before making changes.',
	timeoutMs: 30000,
	schema: z.object({
		cardId: z.string().describe('The Trello card ID'),
		includeComments: z
			.boolean()
			.optional()
			.default(true)
			.describe('Whether to include comments in the response'),
	}),
	examples: [
		{
			params: { cardId: 'abc123', includeComments: true },
			comment: 'Read the card with its comments to understand context',
		},
		{
			params: { cardId: 'abc123', includeComments: false },
			comment: 'Read just the card title and description',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return formatCardData(params.cardId, params.includeComments);
	}
}

export async function formatCardData(cardId: string, includeComments = true): Promise<string> {
	try {
		const [card, checklists, attachments] = await Promise.all([
			trelloClient.getCard(cardId),
			trelloClient.getCardChecklists(cardId),
			trelloClient.getCardAttachments(cardId),
		]);

		let result = formatHeader(card);
		result += formatLabels(card.labels);
		result += formatChecklists(checklists);
		result += formatAttachments(attachments);

		if (includeComments) {
			const comments = await trelloClient.getCardComments(cardId);
			result += formatComments(comments);
		}

		return result;
	} catch (error) {
		return formatGadgetError('reading card', error);
	}
}

// ============================================================================
// Section Formatters
// ============================================================================

type CardData = Awaited<ReturnType<typeof trelloClient.getCard>>;
type ChecklistData = Awaited<ReturnType<typeof trelloClient.getCardChecklists>>;
type AttachmentData = Awaited<ReturnType<typeof trelloClient.getCardAttachments>>;
type CommentData = Awaited<ReturnType<typeof trelloClient.getCardComments>>;

function formatHeader(card: CardData): string {
	return `# ${card.name}\n\n**URL:** ${card.url}\n\n## Description\n\n${card.desc || '(No description)'}\n\n`;
}

function formatLabels(labels: CardData['labels']): string {
	if (labels.length === 0) return '';
	return `## Labels\n\n${labels.map((l) => `- ${l.name} (${l.color})`).join('\n')}\n\n`;
}

function formatChecklists(checklists: ChecklistData): string {
	if (checklists.length === 0) return '';

	let result = '## Checklists\n\n';
	for (const checklist of checklists) {
		result += `### ${checklist.name} [checklistId: ${checklist.id}]\n\n`;
		for (const item of checklist.checkItems) {
			const checkbox = item.state === 'complete' ? '[x]' : '[ ]';
			result += `- ${checkbox} ${item.name} [checkItemId: ${item.id}]\n`;
		}
		result += '\n';
	}
	return result;
}

function formatAttachments(attachments: AttachmentData): string {
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

function formatComments(comments: CommentData): string {
	if (comments.length === 0) {
		return '## Comments\n\n(No comments)\n\n';
	}

	let result = `## Comments (${comments.length})\n\n`;
	for (const comment of comments.slice().reverse()) {
		const date = new Date(comment.date).toISOString();
		result += `### ${comment.memberCreator.fullName} (${date})\n\n`;
		result += `${comment.data.text}\n\n`;
	}
	return result;
}
