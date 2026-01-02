import { readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

// Minimal config types - just what router needs
interface ProjectConfig {
	repo: string; // owner/repo format
	trello: {
		boardId: string;
		lists: Record<string, string>;
		labels: Record<string, string>;
	};
}

interface Config {
	projects: ProjectConfig[];
}

/**
 * Check if filename matches agent log pattern: {agent-type}-{timestamp}.zip
 * Examples: implementation-2026-01-02T16-30-24-339Z.zip, briefing-timeout-2026-01-02T12-34-56-789Z.zip
 */
function isAgentLogFilename(filename: string): boolean {
	return /^[a-z]+(?:-timeout)?-[\d-TZ]+\.zip$/i.test(filename);
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

const TRELLO_WORKER_URL =
	process.env.TRELLO_WORKER_URL || 'https://cascade-webhooks.fly.dev/trello/webhook';
const GITHUB_WORKER_URL =
	process.env.GITHUB_WORKER_URL || 'https://cascade-webhooks.fly.dev/github/webhook';

function shouldForwardTrelloToWorker(payload: unknown): boolean {
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

	// Agent log attachment uploaded? (triggers debug agent)
	if (actionType === 'addAttachmentToCard' && data?.attachment) {
		const attachment = data.attachment as Record<string, unknown>;
		const name = attachment.name as string | undefined;
		if (name && isAgentLogFilename(name) && !name.startsWith('debug-')) {
			// Only forward if debug list is configured (exclude debug agent logs to prevent loop)
			if (project.trello.lists.debug) {
				console.log(`[Router] Agent log attachment uploaded: ${name}`);
				return true;
			}
		}
	}

	return false;
}

function shouldForwardGitHubToWorker(payload: unknown, eventType: string): boolean {
	if (!payload || typeof payload !== 'object') return false;

	// Allowed event types and their required actions
	const allowedEvents: Record<string, string[]> = {
		pull_request_review_comment: ['created'],
		check_suite: ['completed'],
		pull_request_review: ['submitted'],
	};

	if (!allowedEvents[eventType]) return false;

	const p = payload as Record<string, unknown>;
	const action = p.action as string | undefined;
	const repository = p.repository as Record<string, unknown> | undefined;

	// Check action matches allowed actions for this event type
	if (!action || !allowedEvents[eventType].includes(action)) return false;

	// Check if repo matches a configured project
	const repoFullName = repository?.full_name as string | undefined;
	if (!repoFullName) return false;

	const project = config.projects.find((proj) => proj.repo === repoFullName);
	if (!project) return false;

	console.log(`[Router] GitHub ${eventType} (${action}) on ${repoFullName}`);
	return true;
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

	if (shouldForwardTrelloToWorker(payload)) {
		console.log(`[Router] Forwarding Trello to worker: ${actionType}`);

		// Forward to worker (fire-and-forget, don't wait)
		fetch(TRELLO_WORKER_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		}).catch((err) => {
			console.error('[Router] Failed to forward to worker:', err);
		});
	} else {
		console.log(`[Router] Ignoring Trello: ${actionType}`);
	}

	return c.text('OK', 200);
});

// GitHub webhook verification
app.get('/github/webhook', (c) => {
	return c.text('OK', 200);
});

// GitHub webhook handler
app.post('/github/webhook', async (c) => {
	const eventType = c.req.header('X-GitHub-Event') || 'unknown';

	let payload: unknown;
	try {
		payload = await c.req.json();
	} catch {
		return c.text('Bad Request', 400);
	}

	if (shouldForwardGitHubToWorker(payload, eventType)) {
		console.log(`[Router] Forwarding GitHub to worker: ${eventType}`);

		// Forward to worker (fire-and-forget, don't wait)
		fetch(GITHUB_WORKER_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-GitHub-Event': eventType,
			},
			body: JSON.stringify(payload),
		}).catch((err) => {
			console.error('[Router] Failed to forward GitHub to worker:', err);
		});
	} else {
		console.log(`[Router] Ignoring GitHub: ${eventType}`);
	}

	return c.text('OK', 200);
});

// Start server
const port = Number(process.env.PORT) || 3000;
console.log(`[Router] Starting on port ${port}`);

serve({ fetch: app.fetch, port });
