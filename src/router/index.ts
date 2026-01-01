import { readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

// Minimal config types - just what router needs
interface ProjectConfig {
	trello: {
		boardId: string;
		lists: Record<string, string>;
		labels: Record<string, string>;
	};
}

interface Config {
	projects: ProjectConfig[];
}

// Load config at startup
const configPath = process.env.CONFIG_PATH || './config/projects.json';
let config: Config;
try {
	config = JSON.parse(readFileSync(configPath, 'utf-8'));
	console.log(`[Router] Loaded config with ${config.projects.length} projects`);
} catch (err) {
	console.error('[Router] Failed to load config:', err);
	process.exit(1);
}

const WORKER_URL = process.env.WORKER_URL || 'https://cascade-webhooks.fly.dev/trello/webhook';

function shouldForwardToWorker(payload: unknown): boolean {
	if (!payload || typeof payload !== 'object') return false;

	const p = payload as Record<string, unknown>;
	const action = p.action as Record<string, unknown> | undefined;
	const model = p.model as Record<string, unknown> | undefined;

	if (!action || !model) return false;

	const boardId = model.id as string;
	const actionType = action.type as string;
	const data = action.data as Record<string, unknown> | undefined;

	// Find matching project
	const project = config.projects.find((proj) => proj.trello.boardId === boardId);
	if (!project) return false;

	// Card moved to trigger list?
	if (actionType === 'updateCard' && data?.listAfter) {
		const listAfter = data.listAfter as Record<string, unknown>;
		const listId = listAfter.id as string;
		const triggerLists = [
			project.trello.lists.briefing,
			project.trello.lists.planning,
			project.trello.lists.todo,
		];
		if (triggerLists.includes(listId)) {
			console.log(`[Router] Card moved to trigger list: ${listId}`);
			return true;
		}
	}

	// Ready-to-process label added?
	if (actionType === 'addLabelToCard' && data?.label) {
		const label = data.label as Record<string, unknown>;
		const labelId = label.id as string;
		if (labelId === project.trello.labels.readyToProcess) {
			console.log('[Router] Ready-to-process label added');
			return true;
		}
	}

	return false;
}

const app = new Hono();

// Health check
app.get('/health', (c) => {
	return c.json({ status: 'ok', role: 'router' });
});

// Trello webhook verification
app.get('/trello/webhook', (c) => {
	return c.text('OK', 200);
});

// Trello webhook handler
app.post('/trello/webhook', async (c) => {
	let payload: unknown;
	try {
		payload = await c.req.json();
	} catch {
		return c.text('Bad Request', 400);
	}

	const actionType = ((payload as Record<string, unknown>)?.action as Record<string, unknown>)
		?.type;

	if (shouldForwardToWorker(payload)) {
		console.log(`[Router] Forwarding to worker: ${actionType}`);

		// Forward to worker (fire-and-forget, don't wait)
		fetch(WORKER_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		}).catch((err) => {
			console.error('[Router] Failed to forward to worker:', err);
		});
	} else {
		console.log(`[Router] Ignoring: ${actionType}`);
	}

	return c.text('OK', 200);
});

// Start server
const port = Number(process.env.PORT) || 3000;
console.log(`[Router] Starting on port ${port}`);

serve({ fetch: app.fetch, port });
