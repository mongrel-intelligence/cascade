import type { ProjectConfig } from '../types/index.js';
import { getIntegrationCredentialOrNull } from './provider.js';

export async function getProjectGitHubToken(project: ProjectConfig): Promise<string> {
	const implementerToken = await getIntegrationCredentialOrNull(
		project.id,
		'scm',
		'implementer_token',
	);
	if (implementerToken) return implementerToken;

	throw new Error(`Missing implementer token (SCM integration) for project '${project.id}'`);
}
