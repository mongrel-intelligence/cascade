import { githubClient } from '../../../github/client.js';

export async function getPRComments(
	owner: string,
	repo: string,
	prNumber: number,
): Promise<string> {
	try {
		const comments = await githubClient.getPRReviewComments(owner, repo, prNumber);

		if (comments.length === 0) {
			return 'No review comments found on this PR.';
		}

		const formatted = comments.map((c) => {
			const lines = [
				`Comment #${c.id} by @${c.user.login}`,
				`File: ${c.path}${c.line ? `:${c.line}` : ''}`,
				`URL: ${c.htmlUrl}`,
				c.inReplyToId ? `In reply to: #${c.inReplyToId}` : null,
				'',
				c.body,
				'---',
			]
				.filter(Boolean)
				.join('\n');
			return lines;
		});

		return `Found ${comments.length} review comment(s):\n\n${formatted.join('\n')}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error fetching PR comments: ${message}`;
	}
}
