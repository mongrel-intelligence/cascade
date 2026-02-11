import type { githubClient } from '../../github/client.js';

type PRDetails = Awaited<ReturnType<typeof githubClient.getPR>>;
type PRDiff = Awaited<ReturnType<typeof githubClient.getPRDiff>>;

export type { PRDetails, PRDiff };

export function formatPRDetails(prDetails: PRDetails): string {
	return [
		`PR #${prDetails.number}: ${prDetails.title}`,
		`State: ${prDetails.state}`,
		`Branch: ${prDetails.headRef} -> ${prDetails.baseRef}`,
		`URL: ${prDetails.htmlUrl}`,
		'',
		'Description:',
		prDetails.body || '(no description)',
	].join('\n');
}

export function formatPRDiff(prDiff: PRDiff): string {
	if (prDiff.length === 0) {
		return 'No files changed in this PR.';
	}

	const formatted = prDiff.map((f) => {
		const lines = [`## ${f.filename}`, `Status: ${f.status} | +${f.additions} -${f.deletions}`];
		if (f.patch) {
			lines.push('```diff', f.patch, '```');
		} else {
			lines.push('[Binary file or too large to display]');
		}
		return lines.join('\n');
	});

	return `${prDiff.length} file(s) changed:\n\n${formatted.join('\n\n')}`;
}
