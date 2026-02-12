import { readFileSync } from 'node:fs';

// Minimal config types - what router needs
export interface ProjectConfig {
	id: string;
	repo: string; // owner/repo format
	trello: {
		boardId: string;
		lists: Record<string, string>;
		labels: Record<string, string>;
	};
}

export interface Config {
	projects: ProjectConfig[];
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

	// Secrets to pass to workers
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
	};
}

// Load project config at startup
const configPath = process.env.CONFIG_PATH || './config/projects.json';
let projectConfig: Config;
try {
	projectConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
	console.log(`[Router] Loaded config with ${projectConfig.projects.length} projects`);
} catch (err) {
	console.error('[Router] Failed to load config:', err);
	process.exit(1);
}

export { projectConfig };

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
	},
};
