import { githubClient } from '../../../github/client.js';

export async function getPRDiff(owner: string, repo: string, prNumber: number): Promise<string> {
	try {
		const files = await githubClient.getPRDiff(owner, repo, prNumber);

		if (files.length === 0) {
			return 'No files changed in this PR.';
		}

		const formatted = files.map((f) => {
			const lines = [`## ${f.filename}`, `Status: ${f.status} | +${f.additions} -${f.deletions}`];
			if (f.patch) {
				lines.push('```diff', f.patch, '```');
			} else {
				lines.push('[Binary file or too large to display]');
			}
			return lines.join('\n');
		});

		return `${files.length} file(s) changed:\n\n${formatted.join('\n\n')}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error fetching PR diff: ${message}`;
	}
}
