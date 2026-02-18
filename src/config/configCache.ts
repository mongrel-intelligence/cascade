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
	private orgIdByProject = new Map<string, CacheEntry<string>>();
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

	getOrgIdForProject(projectId: string): string | null {
		const entry = this.orgIdByProject.get(projectId);
		return this.isValid(entry) ? entry.data : null;
	}

	setOrgIdForProject(projectId: string, orgId: string): void {
		this.orgIdByProject.set(projectId, this.makeEntry(orgId));
	}

	invalidate(): void {
		this.configEntry = null;
		this.projectByBoardId.clear();
		this.projectByRepo.clear();
		this.projectByJiraKey.clear();
		this.orgIdByProject.clear();
	}
}

export const configCache = new ConfigCache();
