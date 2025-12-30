import { existsSync, readFileSync } from 'node:fs';
import type { CascadeConfig, ProjectConfig } from '../types/index.js';
import { validateConfig } from './schema.js';

let cachedConfig: CascadeConfig | null = null;

export function loadProjectsConfig(configPath: string): CascadeConfig {
	if (cachedConfig) {
		return cachedConfig;
	}

	if (!existsSync(configPath)) {
		throw new Error(`Config file not found: ${configPath}`);
	}

	const configContent = readFileSync(configPath, 'utf-8');
	const rawConfig = JSON.parse(configContent);
	cachedConfig = validateConfig(rawConfig);
	return cachedConfig;
}

export function findProjectByBoardId(
	config: CascadeConfig,
	boardId: string,
): ProjectConfig | undefined {
	return config.projects.find((p) => p.trello.boardId === boardId);
}

export function findProjectById(config: CascadeConfig, id: string): ProjectConfig | undefined {
	return config.projects.find((p) => p.id === id);
}

export function getProjectGitHubToken(project: ProjectConfig): string {
	const tokenEnvVar = project.githubTokenEnv || 'GITHUB_TOKEN';
	const token = process.env[tokenEnvVar];
	if (!token) {
		throw new Error(`Missing GitHub token for project ${project.id}: ${tokenEnvVar} not set`);
	}
	return token;
}

export function clearConfigCache(): void {
	cachedConfig = null;
}
