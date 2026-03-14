import { githubClient } from '../../../github/client.js';
import { buildRunLinkFooterFromEnv } from '../../../utils/runLink.js';

export async function postPRComment(
	owner: string,
	repo: string,
	prNumber: number,
	body: string,
): Promise<string> {
	try {
		const runLinkFooter = buildRunLinkFooterFromEnv();
		const fullBody = runLinkFooter ? body + runLinkFooter : body;
		const result = await githubClient.createPRComment(owner, repo, prNumber, fullBody);
		return `Comment posted (id: ${result.id}): ${result.htmlUrl}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error posting PR comment: ${message}`;
	}
}
