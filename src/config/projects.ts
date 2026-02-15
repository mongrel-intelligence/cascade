import type { ProjectConfig } from '../types/index.js';
import { getProjectSecretOrNull } from './provider.js';

export async function getProjectGitHubToken(project: ProjectConfig): Promise<string> {
	// Try DB secret first, then fall back to env var
	const secret = await getProjectSecretOrNull(project.id, 'GITHUB_TOKEN');
	if (secret) return secret;

	const token = process.env.GITHUB_TOKEN;
	if (!token) {
		throw new Error(`Missing GitHub token for project ${project.id}: GITHUB_TOKEN not set`);
	}
	return token;
}

export async function getProjectReviewerToken(project: ProjectConfig): Promise<string | null> {
	// Try DB secret first
	const secret = await getProjectSecretOrNull(project.id, 'GITHUB_REVIEWER_TOKEN');
	if (secret) return secret;

	return process.env.GITHUB_REVIEWER_TOKEN ?? null;
}
