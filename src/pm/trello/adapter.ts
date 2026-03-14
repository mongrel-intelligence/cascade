/**
 * TrelloPMProvider — wraps the existing trelloClient singleton
 * to implement the PMProvider interface.
 *
 * Assumes trelloClient credentials are already in scope via
 * withTrelloCredentials() — this adapter simply delegates.
 */

import { trelloClient } from '../../trello/client.js';
import type {
	Attachment,
	Checklist,
	ChecklistItem,
	CreateWorkItemConfig,
	ListWorkItemsFilter,
	PMProvider,
	WorkItem,
	WorkItemComment,
	WorkItemLabel,
} from '../types.js';

export class TrelloPMProvider implements PMProvider {
	readonly type = 'trello' as const;

	async getWorkItem(id: string): Promise<WorkItem> {
		const card = await trelloClient.getCard(id);
		return {
			id: card.id,
			title: card.name,
			description: card.desc,
			url: card.url,
			status: card.idList,
			labels: card.labels.map(
				(l): WorkItemLabel => ({
					id: l.id,
					name: l.name,
					color: l.color,
				}),
			),
		};
	}

	async getWorkItemComments(id: string): Promise<WorkItemComment[]> {
		const comments = await trelloClient.getCardComments(id);
		return comments.map((c) => ({
			id: c.id,
			date: c.date,
			text: c.data.text,
			author: {
				id: c.memberCreator.id,
				name: c.memberCreator.fullName,
				username: c.memberCreator.username,
			},
		}));
	}

	async updateWorkItem(
		id: string,
		updates: { title?: string; description?: string },
	): Promise<void> {
		await trelloClient.updateCard(id, {
			name: updates.title,
			desc: updates.description,
		});
	}

	async addComment(id: string, text: string): Promise<string> {
		return trelloClient.addComment(id, text);
	}

	async updateComment(_id: string, commentId: string, text: string): Promise<void> {
		await trelloClient.updateComment(commentId, text);
	}

	async createWorkItem(config: CreateWorkItemConfig): Promise<WorkItem> {
		const card = await trelloClient.createCard(config.containerId, {
			name: config.title,
			desc: config.description,
			idLabels: config.labels,
		});
		return {
			id: card.id,
			title: card.name,
			description: card.desc,
			url: card.url,
			labels: card.labels.map(
				(l): WorkItemLabel => ({
					id: l.id,
					name: l.name,
					color: l.color,
				}),
			),
		};
	}

	async listWorkItems(containerId: string, _filter?: ListWorkItemsFilter): Promise<WorkItem[]> {
		const cards = await trelloClient.getListCards(containerId);
		return cards.map((card) => ({
			id: card.id,
			title: card.name,
			description: card.desc,
			url: card.url,
			labels: card.labels.map(
				(l): WorkItemLabel => ({
					id: l.id,
					name: l.name,
					color: l.color,
				}),
			),
		}));
	}

	async moveWorkItem(id: string, destination: string): Promise<void> {
		await trelloClient.moveCardToList(id, destination);
	}

	async addLabel(id: string, labelId: string): Promise<void> {
		await trelloClient.addLabelToCard(id, labelId);
	}

	async removeLabel(id: string, labelId: string): Promise<void> {
		await trelloClient.removeLabelFromCard(id, labelId);
	}

	async getChecklists(workItemId: string): Promise<Checklist[]> {
		const checklists = await trelloClient.getCardChecklists(workItemId);
		return checklists.map((cl) => ({
			id: cl.id,
			name: cl.name,
			workItemId: cl.idCard,
			items: cl.checkItems.map(
				(item): ChecklistItem => ({
					id: item.id,
					name: item.name,
					complete: item.state === 'complete',
				}),
			),
		}));
	}

	async createChecklist(workItemId: string, name: string): Promise<Checklist> {
		const cl = await trelloClient.createChecklist(workItemId, name);
		return {
			id: cl.id,
			name: cl.name,
			workItemId: cl.idCard,
			items: [],
		};
	}

	async addChecklistItem(
		checklistId: string,
		name: string,
		checked = false,
		_description?: string,
	): Promise<void> {
		await trelloClient.addChecklistItem(checklistId, name, checked);
	}

	async updateChecklistItem(
		workItemId: string,
		checkItemId: string,
		complete: boolean,
	): Promise<void> {
		await trelloClient.updateChecklistItem(
			workItemId,
			checkItemId,
			complete ? 'complete' : 'incomplete',
		);
	}

	async deleteChecklistItem(workItemId: string, checkItemId: string): Promise<void> {
		const checklists = await trelloClient.getCardChecklists(workItemId);
		for (const cl of checklists) {
			const item = cl.checkItems.find((i) => i.id === checkItemId);
			if (item) {
				await trelloClient.deleteChecklistItem(cl.id, checkItemId);
				return;
			}
		}
		throw new Error(`Checklist item ${checkItemId} not found on card ${workItemId}`);
	}

	async getAttachments(workItemId: string): Promise<Attachment[]> {
		const attachments = await trelloClient.getCardAttachments(workItemId);
		return attachments.map((a) => ({
			id: a.id,
			name: a.name,
			url: a.url,
			mimeType: a.mimeType,
			bytes: a.bytes,
			date: a.date,
		}));
	}

	async addAttachment(workItemId: string, url: string, name: string): Promise<void> {
		await trelloClient.addAttachment(workItemId, url, name);
	}

	async linkPR(workItemId: string, prUrl: string, prTitle: string): Promise<void> {
		await trelloClient.addAttachment(workItemId, prUrl, prTitle);
	}

	async addAttachmentFile(
		workItemId: string,
		buffer: Buffer,
		name: string,
		mimeType: string,
	): Promise<void> {
		await trelloClient.addAttachmentFile(workItemId, buffer, name, mimeType);
	}

	async getCustomFieldNumber(workItemId: string, fieldId: string): Promise<number> {
		const items = await trelloClient.getCardCustomFieldItems(workItemId);
		const item = items.find((i) => i.idCustomField === fieldId);
		return Number.parseFloat(item?.value?.number ?? '0');
	}

	async updateCustomFieldNumber(workItemId: string, fieldId: string, value: number): Promise<void> {
		await trelloClient.updateCardCustomFieldNumber(workItemId, fieldId, value);
	}

	getWorkItemUrl(id: string): string {
		return `https://trello.com/c/${id}`;
	}

	async getAuthenticatedUser(): Promise<{ id: string; name: string; username: string }> {
		const me = await trelloClient.getMe();
		return {
			id: me.id,
			name: me.fullName,
			username: me.username,
		};
	}
}
