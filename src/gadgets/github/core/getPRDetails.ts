import { githubClient } from '../../../github/client.js';

export async function getPRDetails(owner: string, repo: string, prNumber: number): Promise<string> {
	try {
		const pr = await githubClient.getPR(owner, repo, prNumber);

		return [
			`PR #${pr.number}: ${pr.title}`,
			`State: ${pr.state}`,
			`Branch: ${pr.headRef} -> ${pr.baseRef}`,
			`URL: ${pr.htmlUrl}`,
			'',
			'Description:',
			pr.body || '(no description)',
		].join('\n');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error fetching PR details: ${message}`;
	}
}
