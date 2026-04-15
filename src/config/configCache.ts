import type { CascadeConfig, ProjectConfig } from '../types/index.js';

const DEFAULT_TTL_MS = 60_000;

interface CacheEntry<T> {
	data: T;
	expiresAt: number;
}

class ConfigCache {
	private configEntry: CacheEntry<CascadeConfig> | null = null;
	private projectByBoardId = new Map<string, CacheEntry<ProjectConfig | undefined>>();
	private projectByRepo = new Map<string, CacheEntry<ProjectConfig | undefined>>();
	private projectByJiraKey = new Map<string, CacheEntry<ProjectConfig | undefined>>();
	private projectByLinearTeamId = new Map<string, CacheEntry<ProjectConfig | undefined>>();
	private orgIdByProject = new Map<string, CacheEntry<string>>();
	/**
	 * Unified PM identifier cache, keyed by `${provider}:${identifier}`.
	 * Replaces per-provider caches for generic lookups.
	 */
	private projectByPMIdentifier = new Map<string, CacheEntry<ProjectConfig | undefined>>();
	private ttlMs: number;

	constructor(ttlMs = DEFAULT_TTL_MS) {
		this.ttlMs = ttlMs;
	}

	private isValid<T>(entry: CacheEntry<T> | null | undefined): entry is CacheEntry<T> {
		return entry != null && Date.now() < entry.expiresAt;
	}

	private makeEntry<T>(data: T): CacheEntry<T> {
		return { data, expiresAt: Date.now() + this.ttlMs };
	}

	getConfig(): CascadeConfig | null {
		return this.isValid(this.configEntry) ? this.configEntry.data : null;
	}

	setConfig(config: CascadeConfig): void {
		this.configEntry = this.makeEntry(config);
	}

	getProjectByBoardId(boardId: string): ProjectConfig | undefined | null {
		const entry = this.projectByBoardId.get(boardId);
		return this.isValid(entry) ? entry.data : null;
	}

	setProjectByBoardId(boardId: string, project: ProjectConfig | undefined): void {
		this.projectByBoardId.set(boardId, this.makeEntry(project));
	}

	getProjectByRepo(repo: string): ProjectConfig | undefined | null {
		const entry = this.projectByRepo.get(repo);
		return this.isValid(entry) ? entry.data : null;
	}

	setProjectByRepo(repo: string, project: ProjectConfig | undefined): void {
		this.projectByRepo.set(repo, this.makeEntry(project));
	}

	getProjectByJiraKey(projectKey: string): ProjectConfig | undefined | null {
		const entry = this.projectByJiraKey.get(projectKey);
		return this.isValid(entry) ? entry.data : null;
	}

	setProjectByJiraKey(projectKey: string, project: ProjectConfig | undefined): void {
		this.projectByJiraKey.set(projectKey, this.makeEntry(project));
	}

	getProjectByLinearTeamId(teamId: string): ProjectConfig | undefined | null {
		const entry = this.projectByLinearTeamId.get(teamId);
		return this.isValid(entry) ? entry.data : null;
	}

	setProjectByLinearTeamId(teamId: string, project: ProjectConfig | undefined): void {
		this.projectByLinearTeamId.set(teamId, this.makeEntry(project));
	}

	getOrgIdForProject(projectId: string): string | null {
		const entry = this.orgIdByProject.get(projectId);
		return this.isValid(entry) ? entry.data : null;
	}

	setOrgIdForProject(projectId: string, orgId: string): void {
		this.orgIdByProject.set(projectId, this.makeEntry(orgId));
	}

	/**
	 * Get a cached project by PM provider type + identifier.
	 * Key format: `${provider}:${identifier}` (e.g. `trello:boardId123`).
	 * Returns null if not cached or expired.
	 */
	getProjectByPMIdentifier(provider: string, identifier: string): ProjectConfig | undefined | null {
		const key = `${provider}:${identifier}`;
		const entry = this.projectByPMIdentifier.get(key);
		return this.isValid(entry) ? entry.data : null;
	}

	/**
	 * Cache a project lookup by PM provider type + identifier.
	 */
	setProjectByPMIdentifier(
		provider: string,
		identifier: string,
		project: ProjectConfig | undefined,
	): void {
		const key = `${provider}:${identifier}`;
		this.projectByPMIdentifier.set(key, this.makeEntry(project));
	}

	invalidate(): void {
		this.configEntry = null;
		this.projectByBoardId.clear();
		this.projectByRepo.clear();
		this.projectByJiraKey.clear();
		this.projectByLinearTeamId.clear();
		this.orgIdByProject.clear();
		this.projectByPMIdentifier.clear();
	}
}

export const configCache = new ConfigCache();
