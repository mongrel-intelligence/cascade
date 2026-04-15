/**
 * TodoUpdateStatus gadget - Update the status of existing todo items.
 * Helps agents track progress through implementation tasks.
 */
import { Gadget, z } from 'llmist';
import { type TodoStatus, formatTodoList, loadTodos, saveTodos } from './storage.js';

export class TodoUpdateStatus extends Gadget({
	name: 'TodoUpdateStatus',
	description: `Update the status of an existing todo item.
Use this to track progress: mark todos as in_progress when starting, done when complete.`,
	schema: z.object({
		id: z.string().describe('ID of the todo to update (required)'),
		status: z.enum(['pending', 'in_progress', 'done']).describe('New status'),
		comment: z.string().optional().describe('Brief explanation of why this change is needed'),
	}),
	examples: [
		{
			params: { id: '1', status: 'in_progress', comment: 'Starting work on first task' },
			output:
				'✏️ Updated todo #1 → in_progress.\n\n📋 Todo List\n   Progress: 0/1 done, 1 in progress, 0 pending\n\n🔄 #1 [in_progress]: Read and understand requirements',
			comment: 'Mark todo as in progress',
		},
		{
			params: { id: '1', status: 'done', comment: 'Task completed successfully' },
			output:
				'✏️ Updated todo #1 → done.\n\n📋 Todo List\n   Progress: 1/1 done, 0 in progress, 0 pending\n\n✅ #1 [done]: Read and understand requirements',
			comment: 'Mark todo as done',
		},
	],
}) {
	override execute(params: this['params']): string {
		const { id, status } = params;
		const todos = loadTodos();
		const index = todos.findIndex((t) => t.id === id);

		if (index === -1) {
			throw new Error(`Todo #${id} not found. Use TodoUpsert to create todos first.`);
		}

		todos[index].status = status as TodoStatus;
		todos[index].updatedAt = new Date().toISOString();
		saveTodos(todos);
		return `✏️ Updated todo #${id} → ${status}.\n\n${formatTodoList(todos)}`;
	}
}
