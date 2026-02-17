import type { ProjectConfig } from '../types/index.js';
import { getProjectSecretOrNull } from './provider.js';

export async function getProjectGitHubToken(project: ProjectConfig): Promise<string> {
	// Prefer GITHUB_TOKEN_IMPLEMENTER (new dual-persona model)
	const implementerToken = await getProjectSecretOrNull(project.id, 'GITHUB_TOKEN_IMPLEMENTER');
	if (implementerToken) return implementerToken;

	// Fall back to legacy GITHUB_TOKEN for projects not yet migrated
	const legacyToken = await getProjectSecretOrNull(project.id, 'GITHUB_TOKEN');
	if (legacyToken) return legacyToken;

	throw new Error(
		`Missing GITHUB_TOKEN_IMPLEMENTER (or legacy GITHUB_TOKEN) in database for project '${project.id}'`,
	);
}
