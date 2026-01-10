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

export class TodoUpsert extends Gadget({
	name: 'TodoUpsert',
	description: `Create a new todo or update an existing one.

Use this to plan your work at the start of a task and track progress as you go.
- Omit 'id' to create a new todo
- Provide 'id' to update an existing todo's content or status

Returns the full todo list after the operation.`,
	schema: z.object({
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
	}),
	examples: [
		{
			params: { content: 'Read and understand the Trello card requirements' },
			output:
				'➕ Created todo #1.\n\n📋 Todo List\n   Progress: 0/1 done, 0 in progress, 1 pending\n\n⬜ #1 [pending]: Read and understand the Trello card requirements',
			comment: 'Create a new todo item',
		},
		{
			params: { id: '1', status: 'in_progress' },
			output:
				'✏️ Updated todo #1.\n\n📋 Todo List\n   Progress: 0/1 done, 1 in progress, 0 pending\n\n🔄 #1 [in_progress]: Read and understand the Trello card requirements',
			comment: 'Mark a todo as in progress',
		},
		{
			params: { id: '1', status: 'done' },
			output:
				'✏️ Updated todo #1.\n\n📋 Todo List\n   Progress: 1/1 done, 0 in progress, 0 pending\n\n✅ #1 [done]: Read and understand the Trello card requirements',
			comment: 'Mark a todo as done',
		},
	],
}) {
	override execute(params: this['params']): string {
		const { id, content, status } = params;
		const todos = loadTodos();
		const now = new Date().toISOString();

		if (id) {
			// Try to update existing todo
			const index = todos.findIndex((t) => t.id === id);
			if (index === -1) {
				// True upsert: CREATE with the specified id when not found
				if (!content) {
					return `❌ Error: 'content' is required when creating a new todo.`;
				}
				const newTodo: Todo = {
					id,
					content,
					status: (status as TodoStatus) ?? 'pending',
					createdAt: now,
					updatedAt: now,
				};
				todos.push(newTodo);
				saveTodos(todos);
				return `➕ Created todo #${id}.\n\n${formatTodoList(todos)}`;
			}

			// Only update fields that are provided
			if (content !== undefined) {
				todos[index].content = content;
			}
			if (status !== undefined) {
				todos[index].status = status as TodoStatus;
			}
			todos[index].updatedAt = now;

			saveTodos(todos);
			return `✏️ Updated todo #${id}.\n\n${formatTodoList(todos)}`;
		}

		// Create new todo - content is required
		if (!content) {
			return `❌ Error: 'content' is required when creating a new todo.`;
		}

		const newId = getNextId(todos);
		const newTodo: Todo = {
			id: newId,
			content,
			status: (status as TodoStatus) ?? 'pending',
			createdAt: now,
			updatedAt: now,
		};

		todos.push(newTodo);
		saveTodos(todos);
		return `➕ Created todo #${newId}.\n\n${formatTodoList(todos)}`;
	}
}
