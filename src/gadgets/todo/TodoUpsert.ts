/**
 * TodoUpsert gadget - Create or update todo item content.
 * Helps agents plan and organize their implementation tasks.
 */
import { Gadget, z } from 'llmist';
import { type Todo, formatTodoList, getNextId, loadTodos, saveTodos } from './storage.js';

interface TodoItem {
	id?: string;
	content?: string;
}

interface BatchResult {
	created: number;
	updated: number;
}

function upsertBatchItem(item: TodoItem, todos: Todo[], now: string): 'created' | 'updated' | null {
	if (item.id) {
		const index = todos.findIndex((t) => t.id === item.id);
		if (index === -1) {
			if (!item.content) return null;
			todos.push({
				id: item.id,
				content: item.content,
				status: 'pending',
				createdAt: now,
				updatedAt: now,
			});
			return 'created';
		}
		if (item.content !== undefined) todos[index].content = item.content;
		todos[index].updatedAt = now;
		return 'updated';
	}

	if (!item.content) return null;
	todos.push({
		id: getNextId(todos),
		content: item.content,
		status: 'pending',
		createdAt: now,
		updatedAt: now,
	});
	return 'created';
}

function processBatchItems(items: TodoItem[], todos: Todo[], now: string): BatchResult {
	let created = 0;
	let updated = 0;

	for (const item of items) {
		const result = upsertBatchItem(item, todos, now);
		if (result === 'created') created++;
		else if (result === 'updated') updated++;
	}

	return { created, updated };
}

function formatBatchResult(result: BatchResult, todos: Todo[]): string {
	const parts = [];
	if (result.created > 0)
		parts.push(`➕ Created ${result.created} todo${result.created > 1 ? 's' : ''}`);
	if (result.updated > 0)
		parts.push(`✏️ Updated ${result.updated} todo${result.updated > 1 ? 's' : ''}`);
	return `${parts.join(', ')}.\n\n${formatTodoList(todos)}`;
}

const todoItemSchema = z.object({
	id: z.string().optional().describe('ID of existing todo to update. Omit to create a new todo.'),
	content: z
		.string()
		.min(1)
		.optional()
		.describe('The todo item description. Required when creating, optional when updating.'),
});

export class TodoUpsert extends Gadget({
	name: 'TodoUpsert',
	description: `Create or update todo item content.

Use this to plan your work at the start of a task.
- For a single item: use id/content directly
- For multiple items: use the 'items' array to batch create/update

All new todos start with status 'pending'. Use TodoUpdateStatus to change status.
Returns the full todo list after the operation.`,
	schema: z.object({
		id: z.string().optional().describe('ID of existing todo to update. Omit to create a new todo.'),
		content: z
			.string()
			.min(1)
			.optional()
			.describe('The todo item description. Required when creating, optional when updating.'),
		items: z
			.array(todoItemSchema)
			.optional()
			.describe(
				'Batch mode: array of todo items to create/update. Each item has id/content. Use this to create multiple todos at once.',
			),
		comment: z.string().optional().describe('Brief explanation of why this change is needed'),
	}),
	examples: [
		{
			params: {
				content: 'Read and understand the Trello card requirements',
				comment: 'Planning initial task',
			},
			output:
				'➕ Created todo #1.\n\n📋 Todo List\n   Progress: 0/1 done, 0 in progress, 1 pending\n\n⬜ #1 [pending]: Read and understand the Trello card requirements',
			comment: 'Create a new todo item',
		},
		{
			params: {
				items: [
					{ content: 'Create feature branch' },
					{ content: 'Implement feature' },
					{ content: 'Write tests' },
					{ content: 'Run lint and typecheck' },
				],
				comment: 'Planning implementation steps',
			},
			output:
				'➕ Created 4 todos.\n\n📋 Todo List\n   Progress: 0/4 done, 0 in progress, 4 pending\n\n⬜ #1 [pending]: Create feature branch\n⬜ #2 [pending]: Implement feature\n⬜ #3 [pending]: Write tests\n⬜ #4 [pending]: Run lint and typecheck',
			comment: 'Batch create multiple todos at once',
		},
	],
}) {
	override execute(params: this['params']): string {
		const { id, content, items } = params;

		// Prevent mixing single-item update with batch create (silently fails otherwise)
		if (items && items.length > 0 && (id !== undefined || content !== undefined)) {
			throw new Error(
				"Cannot combine top-level id/content with 'items' array. " +
					'Use either single-item mode (id/content) OR batch mode (items array), not both. ' +
					'To update one todo and create others, make two separate calls.',
			);
		}

		const todos = loadTodos();
		const now = new Date().toISOString();

		// Handle batch mode
		if (items && items.length > 0) {
			const result = processBatchItems(items, todos, now);
			saveTodos(todos);
			return formatBatchResult(result, todos);
		}

		// Single item mode with ID (update or upsert)
		if (id) {
			const index = todos.findIndex((t) => t.id === id);
			if (index === -1) {
				if (!content) {
					throw new Error("'content' is required when creating a new todo.");
				}
				todos.push({
					id,
					content,
					status: 'pending',
					createdAt: now,
					updatedAt: now,
				});
				saveTodos(todos);
				return `➕ Created todo #${id}.\n\n${formatTodoList(todos)}`;
			}

			if (content !== undefined) todos[index].content = content;
			todos[index].updatedAt = now;
			saveTodos(todos);
			return `✏️ Updated todo #${id}.\n\n${formatTodoList(todos)}`;
		}

		// Create new todo - content is required
		if (!content) {
			throw new Error("'content' is required when creating a new todo.");
		}

		const newId = getNextId(todos);
		todos.push({
			id: newId,
			content,
			status: 'pending',
			createdAt: now,
			updatedAt: now,
		});
		saveTodos(todos);
		return `➕ Created todo #${newId}.\n\n${formatTodoList(todos)}`;
	}
}
