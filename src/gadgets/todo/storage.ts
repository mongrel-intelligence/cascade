/**
 * Todo storage utilities for CASCADE agents.
 * Stores todos in workspace directory for visibility during debugging.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getWorkspaceDir } from '../../utils/repo.js';

export type TodoStatus = 'pending' | 'in_progress' | 'done';

export interface Todo {
	id: string;
	content: string;
	status: TodoStatus;
	createdAt: string;
	updatedAt: string;
}

// Session ID set when agent starts - shared across gadget instances
let currentSessionId: string | null = null;

/**
 * Initialize todo storage for a session.
 * Call this once when the agent starts.
 */
export function initTodoSession(sessionId: string): void {
	currentSessionId = sessionId;
	ensureDir();
}

/**
 * Get the current session ID.
 */
export function getSessionId(): string {
	if (!currentSessionId) {
		// Generate a default session ID if not initialized
		currentSessionId = `session-${Date.now()}`;
	}
	return currentSessionId;
}

/**
 * Get the todos directory path.
 */
function getTodosDir(): string {
	return join(getWorkspaceDir(), 'todos');
}

/**
 * Get the session file path.
 */
function getSessionFile(): string {
	return join(getTodosDir(), `${getSessionId()}.json`);
}

/**
 * Ensures the todos directory exists.
 */
function ensureDir(): void {
	const todosDir = getTodosDir();
	if (!existsSync(todosDir)) {
		mkdirSync(todosDir, { recursive: true });
	}
}

/**
 * Loads todos from the current session file.
 */
export function loadTodos(): Todo[] {
	ensureDir();
	const sessionFile = getSessionFile();
	if (!existsSync(sessionFile)) {
		return [];
	}
	const content = readFileSync(sessionFile, 'utf-8');
	return JSON.parse(content) || [];
}

/**
 * Saves todos to the current session file.
 */
export function saveTodos(todos: Todo[]): void {
	ensureDir();
	writeFileSync(getSessionFile(), JSON.stringify(todos, null, 2));
}

/**
 * Generates the next available todo ID (incrementing integer).
 */
export function getNextId(todos: Todo[]): string {
	const maxId = todos.reduce((max, t) => Math.max(max, Number.parseInt(t.id, 10) || 0), 0);
	return String(maxId + 1);
}

/**
 * Formats the full todo list for display.
 */
export function formatTodoList(todos: Todo[]): string {
	if (todos.length === 0) {
		return '📋 Todo list is empty.';
	}

	const statusIcons: Record<TodoStatus, string> = {
		pending: '⬜',
		in_progress: '🔄',
		done: '✅',
	};

	const lines = todos.map((t) => {
		const icon = statusIcons[t.status];
		return `${icon} #${t.id} [${t.status}]: ${t.content}`;
	});

	const stats = {
		pending: todos.filter((t) => t.status === 'pending').length,
		in_progress: todos.filter((t) => t.status === 'in_progress').length,
		done: todos.filter((t) => t.status === 'done').length,
	};

	return [
		'📋 Todo List',
		`   Progress: ${stats.done}/${todos.length} done, ${stats.in_progress} in progress, ${stats.pending} pending`,
		'',
		...lines,
	].join('\n');
}
