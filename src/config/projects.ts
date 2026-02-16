import type { ProjectConfig } from '../types/index.js';
import { getProjectSecretOrNull } from './provider.js';

export async function getProjectGitHubToken(project: ProjectConfig): Promise<string> {
	const secret = await getProjectSecretOrNull(project.id, 'GITHUB_TOKEN');
	if (secret) return secret;

	throw new Error(`Missing GITHUB_TOKEN in database for project '${project.id}'`);
}
