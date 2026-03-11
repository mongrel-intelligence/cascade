import { type ChecklistItemInput, addChecklist } from '../../gadgets/pm/core/addChecklist.js';
import { addChecklistDef } from '../../gadgets/pm/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

/**
 * Parses a raw --item flag string into a ChecklistItemInput.
 *
 * When the Claude Code backend invokes this CLI, it serialises object items
 * (with `name` and optional `description`) as JSON strings. This function
 * attempts to parse such strings so that JIRA subtask titles contain only the
 * clean `name` value rather than the raw JSON blob.
 *
 * Falls back to the original string for plain-text items and any string that
 * is not a JSON object with a `name` property.
 */
export function parseItem(raw: string): ChecklistItemInput {
	try {
		const parsed = JSON.parse(raw);
		if (
			parsed &&
			typeof parsed === 'object' &&
			!Array.isArray(parsed) &&
			typeof parsed.name === 'string'
		) {
			return {
				name: parsed.name,
				...(typeof parsed.description === 'string' ? { description: parsed.description } : {}),
			};
		}
	} catch {
		// Not JSON — treat as a plain string
	}
	return raw;
}

export default createCLICommand(addChecklistDef, async (params) => {
	const rawItems = params.item as string[];
	const items = rawItems.map(parseItem);
	return addChecklist({
		workItemId: params.workItemId as string,
		checklistName: params.checklistName as string,
		items,
	});
});
