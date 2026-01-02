import type { TriggerContext, TriggerHandler, TriggerResult } from '../types/index.js';

export type { TriggerContext, TriggerHandler, TriggerResult };

export interface TrelloWebhookPayload {
	model: {
		id: string; // Board ID
		name: string;
	};
	action: {
		id: string;
		idMemberCreator: string;
		type: string;
		date: string;
		data: {
			card?: {
				id: string;
				name: string;
				idShort: number;
				shortLink: string;
			};
			list?: {
				id: string;
				name: string;
			};
			listBefore?: {
				id: string;
				name: string;
			};
			listAfter?: {
				id: string;
				name: string;
			};
			label?: {
				id: string;
				name: string;
				color: string;
			};
			board?: {
				id: string;
				name: string;
				shortLink: string;
			};
			attachment?: {
				id: string;
				name: string;
				url: string;
				mimeType: string;
				bytes?: number;
			};
			old?: Record<string, unknown>;
		};
		memberCreator?: {
			id: string;
			fullName: string;
			username: string;
		};
	};
}

export function isTrelloWebhookPayload(payload: unknown): payload is TrelloWebhookPayload {
	if (typeof payload !== 'object' || payload === null) return false;
	const p = payload as Record<string, unknown>;
	return (
		typeof p.model === 'object' &&
		p.model !== null &&
		typeof p.action === 'object' &&
		p.action !== null
	);
}
