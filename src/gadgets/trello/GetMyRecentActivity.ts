import { Gadget, z } from 'llmist';
import { trelloClient } from '../../trello/client.js';
import { formatGadgetError } from '../utils.js';

export class GetMyRecentActivity extends Gadget({
	name: 'GetMyRecentActivity',
	description:
		'Get your recent Trello activity (cards created, updated, comments posted). Use this to find cards you recently worked on or to understand context when the user refers to previous work.',
	timeoutMs: 30000,
	schema: z.object({
		limit: z
			.number()
			.int()
			.min(1)
			.max(50)
			.optional()
			.default(20)
			.describe('Number of recent actions to retrieve (default 20, max 50)'),
	}),
	examples: [
		{
			params: { limit: 10 },
			comment: 'Get my last 10 actions to find cards I recently created',
		},
		{
			params: { limit: 20 },
			comment: 'Get my recent activity with default limit of 20',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		try {
			const actions = await trelloClient.getMyActions(params.limit);

			if (actions.length === 0) {
				return 'No recent activity found.';
			}

			let result = `# My Recent Activity (${actions.length} actions)\n\n`;

			for (const action of actions) {
				const date = new Date(action.date).toISOString();
				const actionDesc = this.formatAction(action);
				result += `- **${action.type}** (${date}): ${actionDesc}\n`;
			}

			return result;
		} catch (error) {
			return formatGadgetError('getting recent activity', error);
		}
	}

	private formatAction(action: {
		type: string;
		data: {
			card?: { id: string; name: string; shortLink?: string };
			list?: { name: string };
			text?: string;
		};
	}): string {
		const card = action.data.card;
		const list = action.data.list;

		switch (action.type) {
			case 'createCard':
				return `Created card "${card?.name}" (ID: ${card?.id})${list ? ` in list "${list.name}"` : ''}`;
			case 'updateCard':
				return `Updated card "${card?.name}" (ID: ${card?.id})`;
			case 'commentCard':
				return `Commented on "${card?.name}" (ID: ${card?.id}): "${action.data.text?.slice(0, 50)}${(action.data.text?.length || 0) > 50 ? '...' : ''}"`;
			case 'addLabelToCard':
				return `Added label to "${card?.name}" (ID: ${card?.id})`;
			case 'removeLabelFromCard':
				return `Removed label from "${card?.name}" (ID: ${card?.id})`;
			case 'moveCardToBoard':
			case 'moveCardFromBoard':
				return `Moved card "${card?.name}" (ID: ${card?.id})`;
			default:
				return card ? `"${card.name}" (ID: ${card.id})` : 'Unknown action';
		}
	}
}
