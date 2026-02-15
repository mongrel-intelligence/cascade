import { AsyncLocalStorage } from 'node:async_hooks';
import { TrelloClient as TrelloJsClient } from 'trello.js';
import { logger } from '../utils/logging.js';

interface TrelloCredentials {
	apiKey: string;
	token: string;
}

const trelloCredentialStore = new AsyncLocalStorage<TrelloCredentials>();

export function withTrelloCredentials<T>(
	creds: TrelloCredentials,
	fn: () => Promise<T>,
): Promise<T> {
	return trelloCredentialStore.run(creds, fn);
}

export function getTrelloCredentials(): TrelloCredentials {
	const scoped = trelloCredentialStore.getStore();
	if (!scoped) {
		throw new Error(
			'No Trello credentials in scope. Wrap the call with withTrelloCredentials() or ensure per-project TRELLO_API_KEY/TRELLO_TOKEN are set in the database.',
		);
	}
	return scoped;
}

function getClient(): TrelloJsClient {
	const creds = getTrelloCredentials();
	return new TrelloJsClient({ key: creds.apiKey, token: creds.token });
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

export interface TrelloAction {
	id: string;
	type: string;
	date: string;
	data: {
		card?: { id: string; name: string; shortLink?: string };
		list?: { id: string; name: string };
		board?: { id: string; name: string };
		text?: string;
	};
}

export interface TrelloCheckItem {
	id: string;
	name: string;
	state: 'complete' | 'incomplete';
}

export interface TrelloChecklist {
	id: string;
	name: string;
	idCard: string;
	checkItems: TrelloCheckItem[];
}

export interface CustomFieldItem {
	id: string;
	idCustomField: string;
	value?: { number?: string; text?: string; checked?: string };
}

export interface TrelloAttachment {
	id: string;
	name: string;
	url: string;
	mimeType: string;
	bytes: number;
	date: string;
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

	async addAttachmentFile(
		cardId: string,
		fileBuffer: Buffer,
		name: string,
		mimeType = 'application/gzip',
	): Promise<void> {
		logger.debug('Adding file attachment', { cardId, name, size: fileBuffer.length });
		await getClient().cards.createCardAttachment({
			id: cardId,
			file: fileBuffer,
			name,
			mimeType,
		});
	},

	async getMyActions(limit = 20): Promise<TrelloAction[]> {
		logger.debug('Fetching my recent actions', { limit });
		// Use raw fetch since trello.js types don't expose 'limit' parameter
		const { apiKey, token } = getTrelloCredentials();
		const response = await fetch(
			`https://api.trello.com/1/members/me/actions?key=${apiKey}&token=${token}&limit=${limit}`,
		);
		if (!response.ok) {
			throw new Error(`Failed to fetch actions: ${response.status}`);
		}
		const actions = (await response.json()) as Array<{
			id?: string;
			type?: string;
			date?: string;
			data?: {
				card?: { id?: string; name?: string; shortLink?: string };
				list?: { id?: string; name?: string };
				board?: { id?: string; name?: string };
				text?: string;
			};
		}>;
		return actions.map((a) => ({
			id: a.id || '',
			type: a.type || '',
			date: a.date || '',
			data: {
				card: a.data?.card
					? {
							id: a.data.card.id || '',
							name: a.data.card.name || '',
							shortLink: a.data.card.shortLink,
						}
					: undefined,
				list: a.data?.list
					? {
							id: a.data.list.id || '',
							name: a.data.list.name || '',
						}
					: undefined,
				board: a.data?.board
					? {
							id: a.data.board.id || '',
							name: a.data.board.name || '',
						}
					: undefined,
				text: a.data?.text,
			},
		}));
	},

	async getMe(): Promise<{ id: string; fullName: string; username: string }> {
		logger.debug('Fetching authenticated member info');
		const { apiKey, token } = getTrelloCredentials();
		const response = await fetch(
			`https://api.trello.com/1/members/me?key=${apiKey}&token=${token}`,
		);
		if (!response.ok) {
			throw new Error(`Failed to fetch member: ${response.status}`);
		}
		const member = (await response.json()) as {
			id?: string;
			fullName?: string;
			username?: string;
		};
		return {
			id: member.id || '',
			fullName: member.fullName || '',
			username: member.username || '',
		};
	},

	async getListCards(listId: string): Promise<TrelloCard[]> {
		logger.debug('Fetching cards from list', { listId });
		const cards = await getClient().lists.getListCards({ id: listId });
		return cards.map((card) => {
			const labels = card.labels as
				| Array<{ id?: string; name?: string; color?: string }>
				| undefined;
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
		});
	},

	async createCard(
		listId: string,
		data: { name: string; desc?: string; idLabels?: string[] },
	): Promise<TrelloCard> {
		logger.debug('Creating card', { listId, name: data.name });
		const card = await getClient().cards.createCard({
			idList: listId,
			name: data.name,
			desc: data.desc,
			idLabels: data.idLabels,
			pos: 'bottom',
		});
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

	async createChecklist(cardId: string, name: string): Promise<TrelloChecklist> {
		logger.debug('Creating checklist', { cardId, name });
		const checklist = (await getClient().cards.createCardChecklist({
			id: cardId,
			name,
		})) as { id?: string; name?: string; idCard?: string };
		return {
			id: checklist.id || '',
			name: checklist.name || '',
			idCard: checklist.idCard || '',
			checkItems: [],
		};
	},

	async addChecklistItem(
		checklistId: string,
		name: string,
		checked = false,
	): Promise<TrelloCheckItem> {
		logger.debug('Adding checklist item', { checklistId, name, checked });
		const item = (await getClient().checklists.createChecklistCheckItems({
			id: checklistId,
			name,
			checked,
		})) as { id?: string; name?: string; state?: string };
		return {
			id: item.id || '',
			name: item.name || '',
			state: item.state === 'complete' ? 'complete' : 'incomplete',
		};
	},

	async getCardChecklists(cardId: string): Promise<TrelloChecklist[]> {
		logger.debug('Fetching card checklists', { cardId });
		const checklists = (await getClient().cards.getCardChecklists({ id: cardId })) as Array<{
			id?: string;
			name?: string;
			idCard?: string;
			checkItems?: Array<{ id?: string; name?: string; state?: string }>;
		}>;
		return checklists.map((cl) => ({
			id: cl.id || '',
			name: cl.name || '',
			idCard: cl.idCard || '',
			checkItems: (cl.checkItems || []).map((item) => ({
				id: item.id || '',
				name: item.name || '',
				state: item.state === 'complete' ? 'complete' : ('incomplete' as const),
			})),
		}));
	},

	async updateChecklistItem(
		cardId: string,
		checkItemId: string,
		state: 'complete' | 'incomplete',
	): Promise<void> {
		logger.debug('Updating checklist item', { cardId, checkItemId, state });
		await getClient().cards.updateCardCheckItem({
			id: cardId,
			idCheckItem: checkItemId,
			state,
		});
	},

	async getCardCustomFieldItems(cardId: string): Promise<CustomFieldItem[]> {
		logger.debug('Fetching card custom field items', { cardId });
		const { apiKey, token } = getTrelloCredentials();
		const response = await fetch(
			`https://api.trello.com/1/cards/${cardId}/customFieldItems?key=${apiKey}&token=${token}`,
		);
		if (!response.ok) {
			throw new Error(`Failed to get custom fields: ${response.status}`);
		}
		const items = (await response.json()) as Array<{
			id?: string;
			idCustomField?: string;
			value?: { number?: string; text?: string; checked?: string };
		}>;
		return items.map((item) => ({
			id: item.id || '',
			idCustomField: item.idCustomField || '',
			value: item.value,
		}));
	},

	async getCardAttachments(cardId: string): Promise<TrelloAttachment[]> {
		logger.debug('Fetching card attachments', { cardId });
		const { apiKey, token } = getTrelloCredentials();
		const response = await fetch(
			`https://api.trello.com/1/cards/${cardId}/attachments?key=${apiKey}&token=${token}`,
		);
		if (!response.ok) {
			throw new Error(`Failed to get attachments: ${response.status}`);
		}
		const attachments = (await response.json()) as Array<{
			id?: string;
			name?: string;
			url?: string;
			mimeType?: string;
			bytes?: number;
			date?: string;
		}>;
		return attachments.map((a) => ({
			id: a.id || '',
			name: a.name || '',
			url: a.url || '',
			mimeType: a.mimeType || '',
			bytes: a.bytes || 0,
			date: a.date || '',
		}));
	},

	async updateCardCustomFieldNumber(
		cardId: string,
		customFieldId: string,
		value: number,
	): Promise<void> {
		logger.debug('Updating card custom field', { cardId, customFieldId, value });
		const { apiKey, token } = getTrelloCredentials();
		const response = await fetch(
			`https://api.trello.com/1/cards/${cardId}/customField/${customFieldId}/item?key=${apiKey}&token=${token}`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ value: { number: value.toString() } }),
			},
		);
		if (!response.ok) {
			throw new Error(`Failed to update custom field: ${response.status}`);
		}
	},
};
