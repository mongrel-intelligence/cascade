import { loadConfig } from '../config/provider.js';
import { getJiraConfig, getLinearConfig, getTrelloConfig } from '../pm/config.js';
import type { CascadeConfig, ProjectConfig } from '../types/index.js';

// Minimal config types - what router needs for quick filtering
export interface RouterProjectConfig {
	id: string;
	repo?: string; // owner/repo format (optional for projects without SCM integration)
	pmType?: 'trello' | 'jira' | 'linear'; // undefined for SCM-only projects (no PM provider)
	trello?: {
		boardId: string;
		lists: Record<string, string>;
		labels: Record<string, string>;
	};
	jira?: {
		projectKey: string;
		baseUrl: string;
		/**
		 * Spec 024: which issues on a shared project key belong to this project.
		 * Absent ⇒ this project is the key's default. Must be threaded through
		 * the projection below or the router cannot route by it at all.
		 */
		routing?: {
			discriminator: { kind: 'label' | 'component'; value: string };
		};
	};
	linear?: {
		teamId: string;
		projectId?: string;
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
	/**
	 * How long a dispatcher will wait for a worker slot to free up before
	 * giving up and surfacing a transient SLOT_WAIT_TIMEOUT error (which
	 * BullMQ then retries). Spec 015/2.
	 */
	slotWaitTimeoutMs: number;
	/**
	 * Wall-clock budget (ms) for a single router-side worker-image BUILD (spec
	 * 023). A composed `docker build` that exceeds this resolves the project to
	 * `failed` (fail-closed) rather than hanging the dashboard-jobs consumer.
	 * Deliberately generous by default because a first build compiles Playwright
	 * / installs OS packages on top of the base; override via
	 * `WORKER_BUILD_TIMEOUT_MS`.
	 */
	workerBuildTimeoutMs: number;

	// Network settings
	dockerNetwork: string;

	// Email scheduler
	emailScheduleIntervalMs: number;

	// Webhook signature verification
	// Used for Trello HMAC which includes the full callback URL in the signature.
	// Falls back to deriving from request Host header + path at runtime if not set.
	webhookCallbackBaseUrl: string | undefined;

	// Snapshot defaults (project-level values override these)
	snapshotEnabled: boolean;
	snapshotDefaultTtlMs: number;
	snapshotMaxCount: number;
	snapshotMaxSizeBytes: number;
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
let _pendingConfigFetch: Promise<{
	projects: RouterProjectConfig[];
	fullProjects: ProjectConfig[];
}> | null = null;

/** @internal Visible for testing only */
export function _resetProjectConfigCache(): void {
	_projectConfigCache = null;
	_projectConfigExpiresAt = 0;
	_pendingConfigFetch = null;
}

export async function loadProjectConfig(): Promise<{
	projects: RouterProjectConfig[];
	fullProjects: ProjectConfig[];
}> {
	if (_projectConfigCache && Date.now() < _projectConfigExpiresAt) {
		return _projectConfigCache;
	}

	if (!_pendingConfigFetch) {
		_pendingConfigFetch = (async () => {
			const config: CascadeConfig = await loadConfig();
			const result = {
				projects: config.projects.map((p) => {
					const trelloConfig = getTrelloConfig(p);
					const jiraConfig = getJiraConfig(p);
					const linearConfig = getLinearConfig(p);
					return {
						id: p.id,
						repo: p.repo,
						pmType: p.pm?.type,
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
								// Hand-picked projection: a field omitted here is invisible to
								// the router no matter what the DB holds. Same drift class as
								// configMapper.buildJiraConfig (spec 024 plan 1) and MNG-1736's
								// authType — the JIRA config crosses three such projections.
								...(jiraConfig.routing && { routing: jiraConfig.routing }),
							},
						}),
						...(linearConfig && {
							linear: {
								teamId: linearConfig.teamId,
								...(linearConfig.projectId ? { projectId: linearConfig.projectId } : {}),
							},
						}),
					};
				}),
				fullProjects: config.projects,
			};
			_projectConfigCache = result;
			_projectConfigExpiresAt = Date.now() + PROJECT_CONFIG_TTL_MS;
			return result;
		})().finally(() => {
			_pendingConfigFetch = null;
		});
	}

	return _pendingConfigFetch;
}

// Router runtime config from environment
export const routerConfig: RouterConfig = {
	redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
	maxWorkers: Number(process.env.MAX_WORKERS) || 3,
	workerImage: process.env.WORKER_IMAGE || 'ghcr.io/mongrel-intelligence/cascade-worker:latest',
	workerMemoryMb: Number(process.env.WORKER_MEMORY_MB) || 4096,
	workerTimeoutMs: Number(process.env.WORKER_TIMEOUT_MS) || 30 * 60 * 1000, // 30 minutes
	slotWaitTimeoutMs: Number(process.env.SLOT_WAIT_TIMEOUT_MS) || 5 * 60 * 1000, // 5 minutes
	workerBuildTimeoutMs: Number(process.env.WORKER_BUILD_TIMEOUT_MS) || 10 * 60 * 1000, // 10 minutes
	dockerNetwork: process.env.DOCKER_NETWORK || 'services_default',
	emailScheduleIntervalMs: Number(process.env.EMAIL_SCHEDULE_INTERVAL_MS) || 5 * 60 * 1000,
	webhookCallbackBaseUrl: process.env.WEBHOOK_CALLBACK_BASE_URL,

	// Snapshot defaults — project-level values override these when set
	snapshotEnabled: process.env.SNAPSHOT_ENABLED === 'true',
	snapshotDefaultTtlMs: Number(process.env.SNAPSHOT_DEFAULT_TTL_MS) || 24 * 60 * 60 * 1000, // 24 hours
	snapshotMaxCount: Number(process.env.SNAPSHOT_MAX_COUNT) || 5,
	snapshotMaxSizeBytes: Number(process.env.SNAPSHOT_MAX_SIZE_BYTES) || 10 * 1024 * 1024 * 1024, // 10 GB
};
