import { TrelloClient as TrelloJsClient } from 'trello.js';
import { logger } from '../utils/logging.js';

let client: TrelloJsClient | null = null;

function getClient(): TrelloJsClient {
	if (!client) {
		const apiKey = process.env.TRELLO_API_KEY;
		const token = process.env.TRELLO_TOKEN;

		if (!apiKey || !token) {
			throw new Error('TRELLO_API_KEY and TRELLO_TOKEN must be set');
		}

		client = new TrelloJsClient({ key: apiKey, token });
	}
	return client;
}

export interface TrelloCard {
	id: string;
	name: string;
	desc: string;
	url: string;
	shortUrl: string;
	idList: string;
	labels: Array<{ id: string; name: string; color: string }>;
}

export interface TrelloComment {
	id: string;
	date: string;
	data: {
		text: string;
	};
	memberCreator: {
		id: string;
		fullName: string;
		username: string;
	};
}

export const trelloClient = {
	async getCard(cardId: string): Promise<TrelloCard> {
		logger.debug('Fetching Trello card', { cardId });
		const card = await getClient().cards.getCard({ id: cardId });
		const labels = card.labels as Array<{ id?: string; name?: string; color?: string }> | undefined;
		return {
			id: card.id,
			name: card.name || '',
			desc: card.desc || '',
			url: card.url || '',
			shortUrl: card.shortUrl || '',
			idList: card.idList || '',
			labels: (labels || []).map((l) => ({
				id: l.id || '',
				name: l.name || '',
				color: l.color || '',
			})),
		};
	},

	async getCardComments(cardId: string): Promise<TrelloComment[]> {
		logger.debug('Fetching card comments', { cardId });
		const actions = await getClient().cards.getCardActions({
			id: cardId,
			filter: 'commentCard',
		});

		return actions.map((a) => ({
			id: a.id || '',
			date: a.date || '',
			data: {
				text: (a.data as { text?: string })?.text || '',
			},
			memberCreator: {
				id: a.memberCreator?.id || '',
				fullName: a.memberCreator?.fullName || '',
				username: a.memberCreator?.username || '',
			},
		}));
	},

	async updateCard(cardId: string, updates: { name?: string; desc?: string }): Promise<void> {
		logger.debug('Updating card', { cardId, hasName: !!updates.name, hasDesc: !!updates.desc });
		await getClient().cards.updateCard({
			id: cardId,
			name: updates.name,
			desc: updates.desc,
		});
	},

	async addComment(cardId: string, text: string): Promise<void> {
		logger.debug('Adding comment', { cardId, textLength: text.length });
		await getClient().cards.addCardComment({
			id: cardId,
			text,
		});
	},

	async addLabelToCard(cardId: string, labelId: string): Promise<void> {
		logger.debug('Adding label to card', { cardId, labelId });
		await getClient().cards.addCardLabel({
			id: cardId,
			value: labelId,
		});
	},

	async removeLabelFromCard(cardId: string, labelId: string): Promise<void> {
		logger.debug('Removing label from card', { cardId, labelId });
		await getClient().cards.deleteCardLabel({
			id: cardId,
			idLabel: labelId,
		});
	},

	async moveCardToList(cardId: string, listId: string): Promise<void> {
		logger.debug('Moving card to list', { cardId, listId });
		await getClient().cards.updateCard({
			id: cardId,
			idList: listId,
		});
	},

	async addAttachment(cardId: string, url: string, name: string): Promise<void> {
		logger.debug('Adding attachment', { cardId, name });
		// Use createCardAttachment instead of addCardAttachment
		await getClient().cards.createCardAttachment({
			id: cardId,
			url,
			name,
		});
	},
};

export function resetTrelloClient(): void {
	client = null;
}
