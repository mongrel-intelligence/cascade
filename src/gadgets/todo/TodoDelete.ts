/**
 * TodoDelete gadget - Remove a todo item by ID.
 */
import { Gadget, z } from 'llmist';
import { formatTodoList, loadTodos, saveTodos } from './storage.js';

export class TodoDelete extends Gadget({
	name: 'TodoDelete',
	description: `Delete a todo item by ID.

Use this to remove todos that are no longer relevant.
Returns the full remaining todo list.`,
	schema: z.object({
		id: z.string().describe('ID of the todo to delete.'),
	}),
	examples: [
		{
			params: { id: '2' },
			output:
				'🗑️ Deleted todo #2: "Implement the feature"\n\n📋 Todo List\n   Progress: 1/1 done, 0 in progress, 0 pending\n\n✅ #1 [done]: Read requirements',
			comment: 'Delete a todo item',
		},
	],
}) {
	override execute(params: this['params']): string {
		const { id } = params;
		const todos = loadTodos();
		const index = todos.findIndex((t) => t.id === id);

		if (index === -1) {
			return `❌ Error: Todo #${id} not found.\n\n${formatTodoList(todos)}`;
		}

		const deleted = todos.splice(index, 1)[0];
		saveTodos(todos);

		return `🗑️ Deleted todo #${id}: "${deleted.content}"\n\n${formatTodoList(todos)}`;
	}
}
