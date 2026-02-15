import { loadConfig } from '../config/provider.js';
import type { CascadeConfig } from '../types/index.js';

// Minimal config types - what router needs for quick filtering
export interface RouterProjectConfig {
	id: string;
	repo: string; // owner/repo format
	trello: {
		boardId: string;
		lists: Record<string, string>;
		labels: Record<string, string>;
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

	// Secrets to pass to workers (global fallbacks)
	secrets: {
		trelloApiKey: string;
		trelloToken: string;
		githubToken: string;
		hfToken?: string;
		geminiApiKey?: string;
		anthropicApiKey?: string;
		openaiApiKey?: string;
		openrouterApiKey?: string;
		githubReviewerToken?: string;
		claudeCodeOauthToken?: string;
	};
}

// Cached project config for fast webhook filtering
let projectConfig: { projects: RouterProjectConfig[] } | null = null;

export async function loadProjectConfig(): Promise<{ projects: RouterProjectConfig[] }> {
	if (projectConfig) return projectConfig;

	const config: CascadeConfig = await loadConfig();
	projectConfig = {
		projects: config.projects.map((p) => ({
			id: p.id,
			repo: p.repo,
			trello: {
				boardId: p.trello.boardId,
				lists: p.trello.lists,
				labels: p.trello.labels,
			},
		})),
	};
	console.log(`[Router] Loaded config with ${projectConfig.projects.length} projects`);
	return projectConfig;
}

export function getProjectConfig(): { projects: RouterProjectConfig[] } {
	if (!projectConfig) {
		throw new Error('[Router] Config not loaded yet. Call loadProjectConfig() first.');
	}
	return projectConfig;
}

// Router runtime config from environment
export const routerConfig: RouterConfig = {
	redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
	maxWorkers: Number(process.env.MAX_WORKERS) || 3,
	workerImage: process.env.WORKER_IMAGE || 'ghcr.io/zbigniewsobiecki/cascade-worker:latest',
	workerMemoryMb: Number(process.env.WORKER_MEMORY_MB) || 4096,
	workerTimeoutMs: Number(process.env.WORKER_TIMEOUT_MS) || 30 * 60 * 1000, // 30 minutes
	dockerNetwork: process.env.DOCKER_NETWORK || 'services_default',
	secrets: {
		trelloApiKey: process.env.TRELLO_API_KEY || '',
		trelloToken: process.env.TRELLO_TOKEN || '',
		githubToken: process.env.GITHUB_TOKEN || '',
		hfToken: process.env.HF_TOKEN,
		geminiApiKey: process.env.GEMINI_API_KEY,
		anthropicApiKey: process.env.ANTHROPIC_API_KEY,
		openaiApiKey: process.env.OPENAI_API_KEY,
		openrouterApiKey: process.env.OPENROUTER_API_KEY,
		githubReviewerToken: process.env.GITHUB_REVIEWER_TOKEN,
		claudeCodeOauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN,
	},
};
