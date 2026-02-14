import { githubClient } from '../../../github/client.js';

export async function updatePRComment(
	owner: string,
	repo: string,
	commentId: number,
	body: string,
): Promise<string> {
	try {
		const result = await githubClient.updatePRComment(owner, repo, commentId, body);
		return `Comment updated (id: ${result.id}): ${result.htmlUrl}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error updating PR comment: ${message}`;
	}
}
