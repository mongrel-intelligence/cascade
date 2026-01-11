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

function isCardMovedToTriggerList(
	actionType: string,
	data: Record<string, unknown> | undefined,
	project: ProjectConfig,
): boolean {
	if (actionType !== 'updateCard' || !data?.listAfter) return false;

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
	return false;
}

function isReadyToProcessLabelAdded(
	actionType: string,
	data: Record<string, unknown> | undefined,
	project: ProjectConfig,
): boolean {
	if (actionType !== 'addLabelToCard' || !data?.label) return false;

	const label = data.label as Record<string, unknown>;
	const labelId = label.id as string;

	if (labelId === project.trello.labels.readyToProcess) {
		console.log('[Router] Ready-to-process label added');
		return true;
	}
	return false;
}

function isAgentLogAttachmentUploaded(
	actionType: string,
	data: Record<string, unknown> | undefined,
	project: ProjectConfig,
): boolean {
	if (actionType !== 'addAttachmentToCard' || !data?.attachment) return false;
	if (!project.trello.lists.debug) return false;

	const attachment = data.attachment as Record<string, unknown>;
	const name = attachment.name as string | undefined;

	if (name && isAgentLogFilename(name) && !name.startsWith('debug-')) {
		console.log(`[Router] Agent log attachment uploaded: ${name}`);
		return true;
	}
	return false;
}

function shouldForwardTrelloToWorker(payload: unknown): boolean {
	if (!payload || typeof payload !== 'object') return false;

	const p = payload as Record<string, unknown>;
	const action = p.action as Record<string, unknown> | undefined;
	const model = p.model as Record<string, unknown> | undefined;

	if (!action || !model) return false;

	const boardId = model.id as string;
	const actionType = action.type as string;
	const data = action.data as Record<string, unknown> | undefined;

	const project = config.projects.find((proj) => proj.trello.boardId === boardId);
	if (!project) return false;

	return (
		isCardMovedToTriggerList(actionType, data, project) ||
		isReadyToProcessLabelAdded(actionType, data, project) ||
		isAgentLogAttachmentUploaded(actionType, data, project)
	);
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
	const contentType = c.req.header('Content-Type') || '';

	let payload: unknown;
	let rawBody: string | undefined;

	try {
		// GitHub can send webhooks as JSON or form-urlencoded
		if (contentType.includes('application/x-www-form-urlencoded')) {
			// Form-urlencoded: payload is in the 'payload' field
			const formData = await c.req.parseBody();
			const payloadStr = formData.payload;
			if (typeof payloadStr === 'string') {
				rawBody = payloadStr;
				payload = JSON.parse(payloadStr);
			} else {
				throw new Error('Missing payload field in form data');
			}
		} else {
			// Assume JSON
			rawBody = await c.req.text();
			payload = JSON.parse(rawBody);
		}
	} catch (err) {
		// Log the raw request for debugging
		console.log('[Router] GitHub webhook parse error:', {
			error: String(err),
			contentType,
			eventType,
			rawBodyPreview: rawBody?.slice(0, 500) || '(not captured)',
		});
		return c.text('Bad Request', 400);
	}

	// Log full GitHub webhook request
	console.log('[Router] GitHub webhook received:', {
		eventType,
		contentType,
		headers: {
			'X-GitHub-Event': eventType,
			'X-GitHub-Delivery': c.req.header('X-GitHub-Delivery'),
			'X-Hub-Signature': c.req.header('X-Hub-Signature'),
			'X-Hub-Signature-256': c.req.header('X-Hub-Signature-256'),
			'User-Agent': c.req.header('User-Agent'),
		},
		payload: JSON.stringify(payload, null, 2),
	});

	// Do nothing else with GitHub webhooks for now
	console.log('[Router] GitHub webhook logged, no further processing');

	return c.text('OK', 200);
});

// Start server
const port = Number(process.env.PORT) || 3000;
console.log(`[Router] Starting on port ${port}`);

serve({ fetch: app.fetch, port });
