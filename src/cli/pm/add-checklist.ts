import { Flags } from '@oclif/core';
import { type ChecklistItemInput, addChecklist } from '../../gadgets/pm/core/addChecklist.js';
import { CredentialScopedCommand } from '../base.js';

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

export default class AddChecklist extends CredentialScopedCommand {
	static override description = 'Add a checklist with items to a work item.';

	static override flags = {
		workItemId: Flags.string({ description: 'The work item ID', required: true }),
		name: Flags.string({ description: 'Checklist name', required: true }),
		item: Flags.string({
			description: 'Checklist item (repeatable, specify multiple times)',
			required: true,
			multiple: true,
		}),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(AddChecklist);
		const items = flags.item.map(parseItem);
		const result = await addChecklist({
			workItemId: flags.workItemId,
			checklistName: flags.name,
			items,
		});
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
