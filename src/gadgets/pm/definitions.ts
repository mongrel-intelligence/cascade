/**
 * Unified ToolDefinition objects for all 9 PM tools.
 *
 * These definitions are the single source of truth for:
 * - Gadget classes (generated via createGadgetClass)
 * - CLI commands (generated via createCLICommand)
 * - JSON Schema manifests (generated via buildManifest)
 */

import type { ToolDefinition } from '../shared/toolDefinition.js';

export const readWorkItemDef: ToolDefinition = {
	name: 'ReadWorkItem',
	description:
		'Read a work item (card/issue) to retrieve its title, description, comments, checklists, and attachments. Use this to understand the current state before making changes.',
	timeoutMs: 30000,
	parameters: {
		workItemId: {
			type: 'string',
			describe: 'The work item ID (Trello card ID or JIRA issue key)',
			required: true,
		},
		includeComments: {
			type: 'boolean',
			describe: 'Whether to include comments in the response',
			optional: true,
			default: true,
			allowNo: true,
		},
	},
	examples: [
		{
			params: { workItemId: 'abc123', includeComments: true },
			comment: 'Read the work item with its comments to understand context',
		},
	],
};

export const postCommentDef: ToolDefinition = {
	name: 'PostComment',
	description:
		'Post a comment to a work item (card/issue). Use this to communicate with the user, ask questions, or provide status updates.',
	timeoutMs: 30000,
	parameters: {
		workItemId: {
			type: 'string',
			describe: 'The work item ID (Trello card ID or JIRA issue key)',
			required: true,
		},
		text: {
			type: 'string',
			describe: 'The comment text to post (supports markdown)',
			required: true,
		},
	},
	examples: [
		{
			params: {
				workItemId: 'abc123',
				text: '**Brief Ready for Review**\n\nI have analyzed the codebase and updated the description.',
			},
			comment: 'Post a status update to the work item',
		},
	],
	cli: {
		fileInputAlternatives: [
			{
				paramName: 'text',
				fileFlag: 'text-file',
				description: 'Read comment text from file (use - for stdin)',
			},
		],
	},
};

export const updateWorkItemDef: ToolDefinition = {
	name: 'UpdateWorkItem',
	description:
		'Update a work item title and/or description. Use this to save your analysis, brief, or plan.',
	timeoutMs: 30000,
	parameters: {
		workItemId: {
			type: 'string',
			describe: 'The work item ID (Trello card ID or JIRA issue key)',
			required: true,
		},
		title: {
			type: 'string',
			describe: 'New title (max 200 chars). Should be action-oriented.',
			optional: true,
		},
		description: {
			type: 'string',
			describe: 'New description (markdown supported). Use this to save the full brief or plan.',
			optional: true,
		},
		addLabelIds: {
			type: 'array',
			items: 'string',
			describe: 'Label IDs/names to add to the work item',
			optional: true,
		},
	},
	examples: [
		{
			params: {
				workItemId: 'abc123',
				description: '## Context\n\nBackground info...\n\n## Requirements\n\n- Item 1\n- Item 2',
			},
			comment: 'Update the description with a structured brief',
		},
	],
	cli: {
		fileInputAlternatives: [
			{
				paramName: 'description',
				fileFlag: 'description-file',
				description: 'Read description from file (use - for stdin)',
			},
		],
	},
};

export const createWorkItemDef: ToolDefinition = {
	name: 'CreateWorkItem',
	description:
		'Create a new work item (card/issue). Use this to create user story cards or break down work into smaller tasks.',
	timeoutMs: 30000,
	parameters: {
		containerId: {
			type: 'string',
			describe: 'Container ID — Trello list ID or JIRA project key',
			required: true,
		},
		title: {
			type: 'string',
			describe: 'Work item title',
			required: true,
		},
		description: {
			type: 'string',
			describe:
				'Description (markdown supported). Include acceptance criteria and technical notes.',
			optional: true,
		},
	},
	examples: [
		{
			params: {
				containerId: 'abc123',
				title: 'Add email validation to signup form',
				description: '## Acceptance Criteria\n\n- [ ] Email format is validated on blur',
			},
			comment: 'Create a new work item',
		},
	],
	cli: {
		fileInputAlternatives: [
			{
				paramName: 'description',
				fileFlag: 'description-file',
				description: 'Read description from file (use - for stdin)',
			},
		],
	},
};

export const listWorkItemsDef: ToolDefinition = {
	name: 'ListWorkItems',
	description:
		'List all work items in a container (Trello list or JIRA project). Use this to see items you created or to find items to update.',
	timeoutMs: 30000,
	parameters: {
		containerId: {
			type: 'string',
			describe: 'Container ID — Trello list ID or JIRA project key',
			required: true,
		},
	},
	examples: [
		{
			params: { containerId: 'abc123' },
			comment: 'List all work items to find ones to update',
		},
	],
};

export const moveWorkItemDef: ToolDefinition = {
	name: 'MoveWorkItem',
	description:
		'Move a work item to a different list or status. For Trello, the destination is a list ID. For JIRA, the destination is a status name (e.g. "To Do", "In Progress").',
	timeoutMs: 30000,
	parameters: {
		workItemId: {
			type: 'string',
			describe: 'Work item ID (Trello card ID or JIRA issue key)',
			required: true,
		},
		destination: {
			type: 'string',
			describe: 'Destination — Trello list ID or JIRA status name',
			required: true,
		},
	},
	examples: [
		{
			params: {
				workItemId: 'abc123',
				destination: 'list456',
			},
			comment: 'Move a Trello card to a different list',
		},
	],
};

export const addChecklistDef: ToolDefinition = {
	name: 'AddChecklist',
	description:
		'Add a checklist with items to a work item. Use this to create interactive checklists for acceptance criteria or implementation steps.',
	timeoutMs: 30000,
	parameters: {
		workItemId: {
			type: 'string',
			describe: 'The work item ID (Trello card ID or JIRA issue key)',
			required: true,
		},
		checklistName: {
			type: 'string',
			describe: 'Name of the checklist (e.g., "Acceptance Criteria" or "Implementation Steps")',
			required: true,
		},
		items: {
			type: 'array',
			items: 'object',
			describe:
				'List of checklist items to add. Use objects with name+description for richer subtasks.',
			required: true,
		},
	},
	examples: [
		{
			params: {
				workItemId: 'PROJ-42',
				checklistName: 'Implementation Steps',
				items: [
					JSON.stringify({
						name: 'Add reset password endpoint to API',
						description:
							'**Files:** `src/api/auth.ts`\n- Add POST /auth/reset-password route\n- Validate email format and lookup user\n- Generate time-limited reset token',
					}),
					JSON.stringify({
						name: 'Create email template for reset link',
						description:
							'**Files:** `src/templates/reset-password.html`\n- Create responsive HTML email template\n- Include reset link with token parameter',
					}),
				],
			},
			comment: 'Add implementation steps with descriptions to a JIRA issue',
		},
	],
};

export const pmUpdateChecklistItemDef: ToolDefinition = {
	name: 'UpdateChecklistItem',
	description:
		'Update a checklist item state on a work item. Use this to mark items as complete or incomplete.',
	timeoutMs: 15000,
	parameters: {
		workItemId: {
			type: 'string',
			describe: 'The work item ID (Trello card ID or JIRA issue key)',
			required: true,
		},
		checkItemId: {
			type: 'string',
			describe: 'The checklist item ID to update',
			required: true,
		},
		state: {
			type: 'enum',
			options: ['complete', 'incomplete'],
			describe: 'The new state',
			required: true,
		},
	},
	examples: [
		{
			params: {
				workItemId: 'abc123',
				checkItemId: 'item456',
				state: 'complete',
			},
			comment: 'Mark an item as complete',
		},
	],
};

export const pmDeleteChecklistItemDef: ToolDefinition = {
	name: 'DeleteChecklistItem',
	description:
		'Delete a checklist item from a work item. For JIRA this deletes the subtask issue. For Trello this removes the checklist item. Use this to remove descoped or invalid plan steps — do NOT mark items as "complete" if they were never done.',
	timeoutMs: 15000,
	parameters: {
		workItemId: {
			type: 'string',
			describe: 'The work item ID (Trello card ID or JIRA issue key)',
			required: true,
		},
		checkItemId: {
			type: 'string',
			describe: 'The checklist item ID to delete (JIRA subtask key or Trello check item ID)',
			required: true,
		},
	},
	examples: [
		{
			params: {
				workItemId: 'PROJ-42',
				checkItemId: 'PROJ-48',
			},
			comment: 'Delete a descoped subtask from a JIRA issue',
		},
	],
};
