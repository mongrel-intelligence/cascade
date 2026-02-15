import type { ProjectConfig } from '../types/index.js';
import { getProjectSecretOrNull } from './provider.js';

export async function getProjectGitHubToken(project: ProjectConfig): Promise<string> {
	const secret = await getProjectSecretOrNull(project.id, 'GITHUB_TOKEN');
	if (secret) return secret;

	throw new Error(`Missing GITHUB_TOKEN in database for project '${project.id}'`);
}

export async function getProjectReviewerToken(project: ProjectConfig): Promise<string | null> {
	return getProjectSecretOrNull(project.id, 'GITHUB_REVIEWER_TOKEN');
}
