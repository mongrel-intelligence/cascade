import { githubClient } from '../../../github/client.js';

export async function replyToReviewComment(
	owner: string,
	repo: string,
	prNumber: number,
	commentId: number,
	body: string,
): Promise<string> {
	try {
		const reply = await githubClient.replyToReviewComment(owner, repo, prNumber, commentId, body);
		return `Reply posted successfully: ${reply.htmlUrl}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error replying to comment: ${message}`;
	}
}
