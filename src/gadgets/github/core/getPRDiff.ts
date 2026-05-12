import { githubClient } from '../../../github/client.js';

export async function getPRDiff(
	owner: string,
	repo: string,
	prNumber: number,
	path?: string,
): Promise<string> {
	try {
		const files = await githubClient.getPRDiff(owner, repo, prNumber);
		const filteredFiles = path
			? files.filter((f) => f.filename === path || f.previousFilename === path)
			: files;

		if (filteredFiles.length === 0) {
			return path ? `No changed file matched path: ${path}` : 'No files changed in this PR.';
		}

		const formatted = filteredFiles.map((f) => {
			const lines = [`## ${f.filename}`, `Status: ${f.status} | +${f.additions} -${f.deletions}`];
			if (f.previousFilename) {
				lines.push(`Previous filename: ${f.previousFilename}`);
			}
			if (f.patch) {
				lines.push('```diff', f.patch, '```');
			} else {
				lines.push('[Binary file or too large to display]');
			}
			return lines.join('\n');
		});

		return `${filteredFiles.length} file(s) changed:\n\n${formatted.join('\n\n')}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error fetching PR diff: ${message}`;
	}
}
