import { loadConfig } from '../config/provider.js';
import { getJiraConfig, getTrelloConfig } from '../pm/config.js';
import type { CascadeConfig, ProjectConfig } from '../types/index.js';

// Minimal config types - what router needs for quick filtering
export interface RouterProjectConfig {
	id: string;
	repo?: string; // owner/repo format (optional for projects without SCM integration)
	pmType: 'trello' | 'jira';
	trello?: {
		boardId: string;
		lists: Record<string, string>;
		labels: Record<string, string>;
	};
	jira?: {
		projectKey: string;
		baseUrl: string;
	};
}

export interface RouterConfig {
	// Redis connection
	redisUrl: string;

	// Worker settings
	maxWorkers: number;
	workerImage: string;
	workerMemoryMb: number;
	workerTimeoutMs: number;

	// Network settings
	dockerNetwork: string;

	// Email scheduler
	emailScheduleIntervalMs: number;

	// Webhook signature verification
	// Used for Trello HMAC which includes the full callback URL in the signature.
	// Falls back to deriving from request Host header + path at runtime if not set.
	webhookCallbackBaseUrl: string | undefined;
}

// ---------------------------------------------------------------------------
// Cached project config — 5s TTL to eliminate ~10 redundant DB queries per
// webhook event across parseWebhook / isSelfAuthored / resolveProject /
// dispatchWithCredentials calls in the adapter chain.
// ---------------------------------------------------------------------------

const PROJECT_CONFIG_TTL_MS = 5_000;

let _projectConfigCache: { projects: RouterProjectConfig[]; fullProjects: ProjectConfig[] } | null =
	null;
let _projectConfigExpiresAt = 0;

/** @internal Visible for testing only */
export function _resetProjectConfigCache(): void {
	_projectConfigCache = null;
	_projectConfigExpiresAt = 0;
}

export async function loadProjectConfig(): Promise<{
	projects: RouterProjectConfig[];
	fullProjects: ProjectConfig[];
}> {
	if (_projectConfigCache && Date.now() < _projectConfigExpiresAt) {
		return _projectConfigCache;
	}

	const config: CascadeConfig = await loadConfig();
	const result = {
		projects: config.projects.map((p) => {
			const trelloConfig = getTrelloConfig(p);
			const jiraConfig = getJiraConfig(p);
			return {
				id: p.id,
				repo: p.repo,
				pmType: p.pm?.type ?? 'trello',
				...(trelloConfig && {
					trello: {
						boardId: trelloConfig.boardId,
						lists: trelloConfig.lists,
						labels: trelloConfig.labels,
					},
				}),
				...(jiraConfig && {
					jira: {
						projectKey: jiraConfig.projectKey,
						baseUrl: jiraConfig.baseUrl,
					},
				}),
			};
		}),
		fullProjects: config.projects,
	};

	_projectConfigCache = result;
	_projectConfigExpiresAt = Date.now() + PROJECT_CONFIG_TTL_MS;

	return result;
}

// Router runtime config from environment
export const routerConfig: RouterConfig = {
	redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
	maxWorkers: Number(process.env.MAX_WORKERS) || 3,
	workerImage: process.env.WORKER_IMAGE || 'ghcr.io/zbigniewsobiecki/cascade-worker:latest',
	workerMemoryMb: Number(process.env.WORKER_MEMORY_MB) || 4096,
	workerTimeoutMs: Number(process.env.WORKER_TIMEOUT_MS) || 30 * 60 * 1000, // 30 minutes
	dockerNetwork: process.env.DOCKER_NETWORK || 'services_default',
	emailScheduleIntervalMs: Number(process.env.EMAIL_SCHEDULE_INTERVAL_MS) || 5 * 60 * 1000,
	webhookCallbackBaseUrl: process.env.WEBHOOK_CALLBACK_BASE_URL,
};
