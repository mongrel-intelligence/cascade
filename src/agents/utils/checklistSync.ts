/**
 * Checklist synchronization for syncing local TODOs to Trello checklists.
 *
 * Used by the implementation agent to progressively update Trello checklist
 * items as local TODOs are completed.
 */

import { type Todo, loadTodos } from '../../gadgets/todo/storage.js';
import { type TrelloCheckItem, type TrelloChecklist, trelloClient } from '../../trello/client.js';
import { logger } from '../../utils/logging.js';

/** Track which TODO IDs have been synced to avoid duplicate API calls */
const syncedTodoIds = new Set<string>();

/**
 * Normalize a string for fuzzy matching.
 * Lowercases, trims, and removes common prefixes/suffixes.
 */
function normalizeForMatch(str: string): string {
	return str
		.toLowerCase()
		.trim()
		.replace(/^[-•*]\s*/, '') // Remove bullet prefixes
		.replace(/\s+/g, ' '); // Collapse whitespace
}

/**
 * Check if two strings match for checklist synchronization.
 * Uses substring containment for flexible matching.
 *
 * @param todoContent - Content from local TODO
 * @param checkItemName - Name from Trello checklist item
 * @returns True if they match
 */
function stringsMatch(todoContent: string, checkItemName: string): boolean {
	const normalizedTodo = normalizeForMatch(todoContent);
	const normalizedCheck = normalizeForMatch(checkItemName);

	// Exact match
	if (normalizedTodo === normalizedCheck) {
		return true;
	}

	// Substring containment (either direction)
	if (normalizedTodo.includes(normalizedCheck) || normalizedCheck.includes(normalizedTodo)) {
		return true;
	}

	return false;
}

/**
 * Find a matching checklist item for a TODO.
 *
 * @param todo - Local TODO to match
 * @param checklists - Trello checklists to search
 * @returns Matching checklist item and its card ID, or undefined
 */
function findMatchingCheckItem(
	todo: Todo,
	checklists: TrelloChecklist[],
): { checkItem: TrelloCheckItem; cardId: string } | undefined {
	for (const checklist of checklists) {
		for (const checkItem of checklist.checkItems) {
			if (stringsMatch(todo.content, checkItem.name)) {
				return { checkItem, cardId: checklist.idCard };
			}
		}
	}
	return undefined;
}

/**
 * Sync completed local TODOs to Trello checklist items.
 *
 * For each TODO with status 'done':
 * 1. Find matching checklist item by content similarity
 * 2. If found and not already complete, mark it complete
 * 3. Track synced items to avoid duplicate calls
 *
 * @param cardId - Trello card ID to sync checklists for
 */
export async function syncCompletedTodosToChecklist(cardId: string): Promise<void> {
	try {
		const todos = loadTodos();
		const doneTodos = todos.filter((t) => t.status === 'done' && !syncedTodoIds.has(t.id));

		if (doneTodos.length === 0) {
			return;
		}

		const checklists = await trelloClient.getCardChecklists(cardId);
		if (checklists.length === 0) {
			return;
		}

		for (const todo of doneTodos) {
			const match = findMatchingCheckItem(todo, checklists);
			if (match && match.checkItem.state !== 'complete') {
				try {
					await trelloClient.updateChecklistItem(match.cardId, match.checkItem.id, 'complete');
					syncedTodoIds.add(todo.id);
					logger.debug('Synced TODO to checklist', {
						todoId: todo.id,
						todoContent: todo.content,
						checkItemName: match.checkItem.name,
					});
				} catch (err) {
					logger.warn('Failed to sync checklist item', {
						todoId: todo.id,
						checkItemId: match.checkItem.id,
						error: String(err),
					});
				}
			} else if (match && match.checkItem.state === 'complete') {
				// Already complete, just mark as synced to avoid re-checking
				syncedTodoIds.add(todo.id);
			}
		}
	} catch (err) {
		logger.warn('Failed to sync TODOs to checklist', { cardId, error: String(err) });
	}
}

/**
 * Clear the synced TODO tracking state.
 * Call this when starting a new agent session.
 */
export function clearSyncedTodos(): void {
	syncedTodoIds.clear();
}
