/**
 * TodoDelete gadget - Remove todo items by ID (single or batch).
 */
import { Gadget, z } from 'llmist';
import { formatTodoList, loadTodos, saveTodos } from './storage.js';

export class TodoDelete extends Gadget({
	name: 'TodoDelete',
	description: `Delete one or more todo items by ID.

Use this to remove todos that are no longer relevant.
Pass \`id\` for a single deletion or \`ids\` for batch deletion.
Returns the full remaining todo list.`,
	schema: z.object({
		id: z.string().optional().describe('ID of a single todo to delete'),
		ids: z.array(z.string()).min(1).optional().describe('Batch mode: array of IDs to delete'),
	}),
	examples: [
		{
			params: { id: '2' },
			output:
				'🗑️ Deleted todo #2: "Implement the feature"\n\n📋 Todo List\n   Progress: 1/1 done, 0 in progress, 0 pending\n\n✅ #1 [done]: Read requirements',
			comment: 'Delete a single todo item',
		},
		{
			params: { ids: ['2', '3', '4'] },
			output:
				'🗑️ Batch delete: 3 deleted\n- #2: "Implement the feature"\n- #3: "Write tests"\n- #4: "Update docs"\n\n📋 Todo List\n   Progress: 1/1 done, 0 in progress, 0 pending\n\n✅ #1 [done]: Read requirements',
			comment: 'Delete multiple todo items at once',
		},
	],
}) {
	override execute(params: this['params']): string {
		const { id, ids } = params;

		if (id && ids) {
			return '❌ Error: Provide either `id` (single) or `ids` (batch), not both.';
		}
		if (!id && !ids) {
			return '❌ Error: Provide either `id` (single) or `ids` (batch).';
		}

		if (id) {
			return this.deleteSingle(id);
		}
		// ids is guaranteed non-null here due to the checks above
		return this.deleteBatch(ids as string[]);
	}

	private deleteSingle(id: string): string {
		const todos = loadTodos();
		const index = todos.findIndex((t) => t.id === id);

		if (index === -1) {
			return `❌ Error: Todo #${id} not found.\n\n${formatTodoList(todos)}`;
		}

		const deleted = todos.splice(index, 1)[0];
		saveTodos(todos);

		return `🗑️ Deleted todo #${id}: "${deleted.content}"\n\n${formatTodoList(todos)}`;
	}

	private deleteBatch(ids: string[]): string {
		const todos = loadTodos();
		const deleted: Array<{ id: string; content: string }> = [];
		const notFound: string[] = [];

		for (const id of ids) {
			const index = todos.findIndex((t) => t.id === id);
			if (index === -1) {
				notFound.push(id);
			} else {
				const [removed] = todos.splice(index, 1);
				deleted.push({ id: removed.id, content: removed.content });
			}
		}

		if (deleted.length > 0) {
			saveTodos(todos);
		}

		const lines: string[] = [];
		if (deleted.length > 0) {
			lines.push(`🗑️ Batch delete: ${deleted.length} deleted`);
			for (const d of deleted) {
				lines.push(`- #${d.id}: "${d.content}"`);
			}
		}
		if (notFound.length > 0) {
			lines.push(`⚠️ Not found: ${notFound.map((id) => `#${id}`).join(', ')}`);
		}

		lines.push('');
		lines.push(formatTodoList(todos));
		return lines.join('\n');
	}
}
