/**
 * TodoUpsert gadget - Create or update todo items.
 * Helps agents track their progress through implementation tasks.
 */
import { Gadget, z } from 'llmist';
import {
	type Todo,
	type TodoStatus,
	formatTodoList,
	getNextId,
	loadTodos,
	saveTodos,
} from './storage.js';

interface TodoItem {
	id?: string;
	content?: string;
	status?: string;
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
				status: (item.status as TodoStatus) ?? 'pending',
				createdAt: now,
				updatedAt: now,
			});
			return 'created';
		}
		if (item.content !== undefined) todos[index].content = item.content;
		if (item.status !== undefined) todos[index].status = item.status as TodoStatus;
		todos[index].updatedAt = now;
		return 'updated';
	}

	if (!item.content) return null;
	todos.push({
		id: getNextId(todos),
		content: item.content,
		status: (item.status as TodoStatus) ?? 'pending',
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

function updateExistingTodo(
	index: number,
	todos: Todo[],
	content: string | undefined,
	status: string | undefined,
	now: string,
): void {
	if (content !== undefined) todos[index].content = content;
	if (status !== undefined) todos[index].status = status as TodoStatus;
	todos[index].updatedAt = now;
}

const todoItemSchema = z.object({
	id: z.string().optional().describe('ID of existing todo to update. Omit to create a new todo.'),
	content: z
		.string()
		.min(1)
		.optional()
		.describe('The todo item description. Required when creating, optional when updating.'),
	status: z
		.enum(['pending', 'in_progress', 'done'])
		.optional()
		.describe("Todo status: pending, in_progress, or done. Defaults to 'pending' for new items."),
});

export class TodoUpsert extends Gadget({
	name: 'TodoUpsert',
	description: `Create or update one or more todo items.

Use this to plan your work at the start of a task and track progress as you go.
- For a single item: use id/content/status directly
- For multiple items: use the 'items' array to batch create/update

Returns the full todo list after the operation.`,
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
		id: z.string().optional().describe('ID of existing todo to update. Omit to create a new todo.'),
		content: z
			.string()
			.min(1)
			.optional()
			.describe('The todo item description. Required when creating, optional when updating.'),
		status: z
			.enum(['pending', 'in_progress', 'done'])
			.optional()
			.describe("Todo status: pending, in_progress, or done. Defaults to 'pending' for new items."),
		items: z
			.array(todoItemSchema)
			.optional()
			.describe(
				'Batch mode: array of todo items to create/update. Each item has id/content/status. Use this to create multiple todos at once.',
			),
	}),
	examples: [
		{
			params: {
				comment: 'Starting task - tracking requirements analysis',
				content: 'Read and understand the Trello card requirements',
			},
			output:
				'➕ Created todo #1.\n\n📋 Todo List\n   Progress: 0/1 done, 0 in progress, 1 pending\n\n⬜ #1 [pending]: Read and understand the Trello card requirements',
			comment: 'Create a new todo item',
		},
		{
			params: { comment: 'Beginning work on requirements', id: '1', status: 'in_progress' },
			output:
				'✏️ Updated todo #1.\n\n📋 Todo List\n   Progress: 0/1 done, 1 in progress, 0 pending\n\n🔄 #1 [in_progress]: Read and understand the Trello card requirements',
			comment: 'Mark a todo as in progress',
		},
		{
			params: { comment: 'Finished reading requirements', id: '1', status: 'done' },
			output:
				'✏️ Updated todo #1.\n\n📋 Todo List\n   Progress: 1/1 done, 0 in progress, 0 pending\n\n✅ #1 [done]: Read and understand the Trello card requirements',
			comment: 'Mark a todo as done',
		},
		{
			params: {
				comment: 'Planning implementation steps',
				items: [
					{ content: 'Create feature branch' },
					{ content: 'Implement feature' },
					{ content: 'Write tests' },
					{ content: 'Run lint and typecheck' },
				],
			},
			output:
				'➕ Created 4 todos.\n\n📋 Todo List\n   Progress: 0/4 done, 0 in progress, 4 pending\n\n⬜ #1 [pending]: Create feature branch\n⬜ #2 [pending]: Implement feature\n⬜ #3 [pending]: Write tests\n⬜ #4 [pending]: Run lint and typecheck',
			comment: 'Batch create multiple todos at once',
		},
	],
}) {
	override execute(params: this['params']): string {
		const { id, content, status, items } = params;
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
					return `❌ Error: 'content' is required when creating a new todo.`;
				}
				todos.push({
					id,
					content,
					status: (status as TodoStatus) ?? 'pending',
					createdAt: now,
					updatedAt: now,
				});
				saveTodos(todos);
				return `➕ Created todo #${id}.\n\n${formatTodoList(todos)}`;
			}

			updateExistingTodo(index, todos, content, status, now);
			saveTodos(todos);
			return `✏️ Updated todo #${id}.\n\n${formatTodoList(todos)}`;
		}

		// Create new todo - content is required
		if (!content) {
			return `❌ Error: 'content' is required when creating a new todo.`;
		}

		const newId = getNextId(todos);
		todos.push({
			id: newId,
			content,
			status: (status as TodoStatus) ?? 'pending',
			createdAt: now,
			updatedAt: now,
		});
		saveTodos(todos);
		return `➕ Created todo #${newId}.\n\n${formatTodoList(todos)}`;
	}
}
