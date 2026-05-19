/**
 * Unified ToolDefinition objects for all PM tools.
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
				description:
					'Read comment text from file (use - for stdin). Strongly preferred over --text for markdown / multiline content with backticks, code fences, $(...) or newlines.',
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
		addLabelId: {
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
				description:
					'Read description from file (use - for stdin). Strongly preferred over --description for markdown / multiline content with backticks, code fences, $(...) or newlines.',
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
			describe: 'Work item title (max 200 characters)',
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
				description:
					'Read description from file (use - for stdin). Strongly preferred over --description for markdown / multiline content with backticks, code fences, $(...) or newlines.',
			},
		],
	},
};

export const reportFrictionDef: ToolDefinition = {
	name: 'ReportFriction',
	description:
		'File an incidental friction report with structured context. Use this for papercuts, tool issues, missing permissions, flaky dependencies, or confusing PM/SCM data discovered while working.',
	timeoutMs: 30000,
	parameters: {
		summary: {
			type: 'string',
			describe: 'Short one-line summary of the friction encountered',
			required: true,
		},
		details: {
			type: 'string',
			describe: 'Markdown details with concrete symptoms, impact, and useful reproduction context',
			required: true,
		},
		category: {
			type: 'string',
			describe:
				'Friction category (e.g. tooling, environment, permissions, dependency, test-failure, pm-data, scm-data, other)',
			required: true,
		},
		severity: {
			type: 'string',
			describe: 'Severity (e.g. low, medium, high, critical)',
			required: true,
		},
		whileDoing: {
			type: 'string',
			describe: 'Optional short description of the task or operation in progress',
			optional: true,
		},
	},
	examples: [
		{
			params: {
				summary: 'Typecheck requires undocumented Redis env var',
				details:
					'`npm run typecheck` failed until REDIS_URL was set. The setup docs mention Redis for router runtime but not for this command path.',
				category: 'environment',
				severity: 'medium',
				whileDoing: 'Running pre-PR verification',
			},
			comment: 'Report a non-blocking setup papercut discovered during implementation',
		},
	],
	cli: {
		fileInputAlternatives: [
			{
				paramName: 'details',
				fileFlag: 'details-file',
				description:
					'Read friction details from file (use - for stdin). Strongly preferred over --details for markdown / multiline content with backticks, code fences, $(...) or newlines.',
			},
		],
	},
};

export const listWorkItemsDef: ToolDefinition = {
	name: 'ListWorkItems',
	description:
		'List work items in a container or by CASCADE status. Prefer status filtering for pipeline stages such as backlog.',
	timeoutMs: 30000,
	parameters: {
		containerId: {
			type: 'string',
			describe: 'Container ID — Trello list ID, JIRA project key, or Linear team ID',
			optional: true,
		},
		status: {
			type: 'string',
			describe:
				'Optional CASCADE status key to filter by, e.g. backlog, todo, inProgress, inReview, done, merged',
			optional: true,
		},
	},
	examples: [
		{
			params: { containerId: 'abc123' },
			comment: 'List all work items to find ones to update',
		},
		{
			params: { status: 'backlog' },
			comment: 'Safely list configured backlog items across providers',
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
		expectedSourceState: {
			type: 'string',
			describe:
				'Optional pre-move guard. If set, the move only proceeds when the work item\'s current status matches this value (case-insensitive). Use this whenever the move depends on a prior pipeline-state assumption (e.g. "BACKLOG" before moving to TODO) to defend against parallel-agent races. If the work item is already in the destination state, the move is skipped as a no-op.',
			required: false,
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
		{
			params: {
				workItemId: 'MNG-538',
				destination: 'TODO_LIST_ID',
				expectedSourceState: 'Backlog',
			},
			comment:
				'Backlog-manager moving a freshly-picked item to TODO — guarded so a parallel run that already moved it cannot duplicate the move.',
		},
	],
};

export const addChecklistDef: ToolDefinition = {
	name: 'AddChecklist',
	description:
		'Add a checklist with items to a work item. Use this to create interactive checklists for acceptance criteria or implementation steps.',
	timeoutMs: 60000,
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
		item: {
			type: 'array',
			items: 'object',
			describe:
				'List of checklist items to add (at least one required). Each item can be a string or an object with name (required) and description (optional) properties. Use objects with name+description for richer subtasks.',
			required: true,
		},
	},
	examples: [
		{
			params: {
				workItemId: 'PROJ-42',
				checklistName: 'Implementation Steps',
				item: [
					{
						name: 'Add reset password endpoint to API',
						description:
							'**Files:** `src/api/auth.ts`\n- Add POST /auth/reset-password route\n- Validate email format and lookup user\n- Generate time-limited reset token',
					},
					{
						name: 'Create email template for reset link',
						description:
							'**Files:** `src/templates/reset-password.html`\n- Create responsive HTML email template\n- Include reset link with token parameter',
					},
				],
			},
			comment: 'Add implementation steps with descriptions to a JIRA issue',
		},
	],
};

export const pmUpdateChecklistItemDef: ToolDefinition = {
	name: 'PMUpdateChecklistItem',
	description:
		'Update a checklist item state on a work item. Use this to mark items as complete or incomplete.',
	timeoutMs: 60000,
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
	name: 'PMDeleteChecklistItem',
	description:
		'Delete a checklist item from a work item. For JIRA this deletes the subtask issue. For Trello this removes the checklist item. Use this to remove descoped or invalid plan steps — do NOT mark items as "complete" if they were never done.',
	timeoutMs: 60000,
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
