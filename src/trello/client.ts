import { AsyncLocalStorage } from 'node:async_hooks';
import { TrelloClient as TrelloJsClient } from 'trello.js';
import { logger } from '../utils/logging.js';
import type { TrelloCredentials } from './types.js';

const trelloCredentialStore = new AsyncLocalStorage<TrelloCredentials>();

export function withTrelloCredentials<T>(
	creds: TrelloCredentials,
	fn: () => Promise<T>,
): Promise<T> {
	return trelloCredentialStore.run(creds, fn);
}

function getTrelloCredentials(): TrelloCredentials {
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

/**
 * Make an authenticated request to the Trello REST API.
 * Handles credential injection, URL construction, error checking, and JSON parsing.
 *
 * @param path - The API path, e.g. `/cards/${cardId}/attachments`. Query params may be
 *   included in the path itself (e.g. `?filter=open`).
 * @param opts - Optional method, headers, and body for non-GET requests.
 */
async function trelloFetch<T>(
	path: string,
	opts?: { method?: string; headers?: Record<string, string>; body?: unknown },
): Promise<T> {
	const { apiKey, token } = getTrelloCredentials();
	const separator = path.includes('?') ? '&' : '?';
	const url = `https://api.trello.com/1${path}${separator}key=${apiKey}&token=${token}`;

	const fetchOpts: RequestInit = {};
	if (opts?.method) fetchOpts.method = opts.method;
	if (opts?.headers) fetchOpts.headers = opts.headers;
	if (opts?.body !== undefined) fetchOpts.body = JSON.stringify(opts.body);

	const response = await fetch(url, fetchOpts);
	if (!response.ok) {
		throw new Error(`Trello API error ${response.status} for ${path.split('?')[0]}`);
	}
	return response.json() as Promise<T>;
}

// ============================================================================
// Shared utilities
// ============================================================================

function mapLabels(
	labels: Array<{ id?: string; name?: string; color?: string }> | undefined,
): Array<{ id: string; name: string; color: string }> {
	return (labels || []).map((l) => ({
		id: l.id || '',
		name: l.name || '',
		color: l.color || '',
	}));
}

// ============================================================================
// Types
// ============================================================================

export interface TrelloCard {
	id: string;
	name: string;
	desc: string;
	url: string;
	shortUrl: string;
	idList: string;
	labels: Array<{ id: string; name: string; color: string }>;
}

function mapCardResponse(card: {
	id?: string;
	name?: string;
	desc?: string;
	url?: string;
	shortUrl?: string;
	idList?: string;
	labels?: unknown;
}): TrelloCard {
	const labels = card.labels as Array<{ id?: string; name?: string; color?: string }> | undefined;
	return {
		id: card.id ?? '',
		name: card.name || '',
		desc: card.desc || '',
		url: card.url || '',
		shortUrl: card.shortUrl || '',
		idList: card.idList || '',
		labels: mapLabels(labels),
	};
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

// ============================================================================
// Trello client
// ============================================================================

export const trelloClient = {
	// ===== Card Ops =====

	async getCard(cardId: string): Promise<TrelloCard> {
		logger.debug('Fetching Trello card', { cardId });
		const card = await getClient().cards.getCard({ id: cardId });
		return mapCardResponse(card);
	},

	async updateCard(cardId: string, updates: { name?: string; desc?: string }): Promise<void> {
		logger.debug('Updating card', { cardId, hasName: !!updates.name, hasDesc: !!updates.desc });
		await getClient().cards.updateCard({
			id: cardId,
			name: updates.name,
			desc: updates.desc,
		});
	},

	async moveCardToList(cardId: string, listId: string): Promise<void> {
		logger.debug('Moving card to list', { cardId, listId });
		await getClient().cards.updateCard({
			id: cardId,
			idList: listId,
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
		return mapCardResponse(card);
	},

	async getListCards(listId: string): Promise<TrelloCard[]> {
		logger.debug('Fetching cards from list', { listId });
		const cards = await getClient().lists.getListCards({ id: listId });
		return cards.map(mapCardResponse);
	},

	// ===== Comments =====

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

	async addComment(cardId: string, text: string): Promise<string> {
		logger.debug('Adding comment', { cardId, textLength: text.length });
		const result = (await getClient().cards.addCardComment({
			id: cardId,
			text,
		})) as { id?: string };
		return result?.id ?? '';
	},

	async updateComment(actionId: string, text: string): Promise<void> {
		logger.debug('Updating comment', { actionId, textLength: text.length });
		await trelloFetch(`/actions/${actionId}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: { text },
		});
	},

	// ===== Labels =====

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

	// ===== Attachments =====

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

	/**
	 * Downloads an attachment from Trello CDN with API key/token authentication.
	 *
	 * Trello CDN attachment URLs require the same `key`/`token` query-param
	 * authentication as the REST API.  Returns `null` on any failure so the
	 * caller pipeline never crashes.
	 *
	 * @param url - The Trello attachment URL to download.
	 * @returns `{ buffer, mimeType }` on success, `null` on failure.
	 */
	async downloadAttachment(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
		const { apiKey, token } = getTrelloCredentials();
		// Append credentials as query parameters (same pattern as trelloFetch)
		const separator = url.includes('?') ? '&' : '?';
		const authedUrl = `${url}${separator}key=${apiKey}&token=${token}`;
		const { downloadMedia } = await import('../pm/media.js');
		return downloadMedia(authedUrl);
	},

	async getCardAttachments(cardId: string): Promise<TrelloAttachment[]> {
		logger.debug('Fetching card attachments', { cardId });
		const attachments = await trelloFetch<
			Array<{
				id?: string;
				name?: string;
				url?: string;
				mimeType?: string;
				bytes?: number;
				date?: string;
			}>
		>(`/cards/${cardId}/attachments`);
		return attachments.map((a) => ({
			id: a.id || '',
			name: a.name || '',
			url: a.url || '',
			mimeType: a.mimeType || '',
			bytes: a.bytes || 0,
			date: a.date || '',
		}));
	},

	// ===== Checklists =====

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

	async deleteChecklistItem(checklistId: string, checkItemId: string): Promise<void> {
		logger.debug('Deleting checklist item', { checklistId, checkItemId });
		await getClient().checklists.deleteChecklistCheckItem({
			id: checklistId,
			idCheckItem: checkItemId,
		});
	},

	// ===== Custom Fields =====

	async getCardCustomFieldItems(cardId: string): Promise<CustomFieldItem[]> {
		logger.debug('Fetching card custom field items', { cardId });
		const items = await trelloFetch<
			Array<{
				id?: string;
				idCustomField?: string;
				value?: { number?: string; text?: string; checked?: string };
			}>
		>(`/cards/${cardId}/customFieldItems`);
		return items.map((item) => ({
			id: item.id || '',
			idCustomField: item.idCustomField || '',
			value: item.value,
		}));
	},

	async updateCardCustomFieldNumber(
		cardId: string,
		customFieldId: string,
		value: number,
	): Promise<void> {
		logger.debug('Updating card custom field', { cardId, customFieldId, value });
		await trelloFetch(`/cards/${cardId}/customField/${customFieldId}/item`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: { value: { number: value.toString() } },
		});
	},

	// ===== Board Ops =====

	async getBoards(): Promise<Array<{ id: string; name: string; url: string }>> {
		logger.debug('Fetching boards for authenticated member');
		const boards = await trelloFetch<Array<{ id?: string; name?: string; url?: string }>>(
			'/members/me/boards?filter=open&fields=id,name,url',
		);
		return boards.map((b) => ({
			id: b.id || '',
			name: b.name || '',
			url: b.url || '',
		}));
	},

	async getBoardLists(boardId: string): Promise<Array<{ id: string; name: string }>> {
		logger.debug('Fetching board lists', { boardId });
		const lists = await trelloFetch<Array<{ id?: string; name?: string }>>(
			`/boards/${boardId}/lists?filter=open`,
		);
		return lists.map((l) => ({
			id: l.id || '',
			name: l.name || '',
		}));
	},

	async getBoardLabels(
		boardId: string,
	): Promise<Array<{ id: string; name: string; color: string }>> {
		logger.debug('Fetching board labels', { boardId });
		const labels = await trelloFetch<Array<{ id?: string; name?: string; color?: string }>>(
			`/boards/${boardId}/labels`,
		);
		return labels.map((l) => ({
			id: l.id || '',
			name: l.name || '',
			color: l.color || '',
		}));
	},

	async createBoardLabel(
		boardId: string,
		name: string,
		color = 'blue',
	): Promise<{ id: string; name: string; color: string }> {
		logger.debug('Creating board label', { boardId, name, color });
		const label = await trelloFetch<{ id?: string; name?: string; color?: string }>(
			`/boards/${boardId}/labels`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: { name, color },
			},
		);
		return {
			id: label.id || '',
			name: label.name || '',
			color: label.color || '',
		};
	},

	async getBoardCustomFields(
		boardId: string,
	): Promise<Array<{ id: string; name: string; type: string }>> {
		logger.debug('Fetching board custom fields', { boardId });
		const fields = await trelloFetch<Array<{ id?: string; name?: string; type?: string }>>(
			`/boards/${boardId}/customFields`,
		);
		return fields.map((f) => ({
			id: f.id || '',
			name: f.name || '',
			type: f.type || '',
		}));
	},

	async createBoardCustomField(
		boardId: string,
		name: string,
		type: string,
	): Promise<{ id: string; name: string; type: string }> {
		logger.debug('Creating board custom field', { boardId, name, type });
		const field = await trelloFetch<{ id?: string; name?: string; type?: string }>(
			'/customFields',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: { idModel: boardId, modelType: 'board', name, type, pos: 'bottom' },
			},
		);
		return {
			id: field.id || '',
			name: field.name || '',
			type: field.type || '',
		};
	},

	// ===== Member / Actions =====

	async getMe(): Promise<{ id: string; fullName: string; username: string }> {
		logger.debug('Fetching authenticated member info');
		const member = await trelloFetch<{ id?: string; fullName?: string; username?: string }>(
			'/members/me',
		);
		return {
			id: member.id || '',
			fullName: member.fullName || '',
			username: member.username || '',
		};
	},

	async addActionReaction(
		actionId: string,
		emoji: { shortName: string; native: string; unified: string },
	): Promise<void> {
		logger.debug('Adding reaction to Trello action', { actionId, emoji: emoji.shortName });
		await trelloFetch(`/actions/${actionId}/reactions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: { emoji },
		});
	},
};
