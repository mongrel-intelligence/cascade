import { type CheckSuiteStatus, githubClient } from '../../../github/client.js';

export function formatCheckStatus(prNumber: number, checkStatus: CheckSuiteStatus): string {
	if (checkStatus.totalCount === 0) {
		return `PR #${prNumber}: No CI checks configured`;
	}

	const lines: string[] = [];
	const passing = checkStatus.checkRuns.filter(
		(cr) =>
			cr.status === 'completed' && (cr.conclusion === 'success' || cr.conclusion === 'skipped'),
	).length;

	lines.push(`PR #${prNumber} Check Status: ${passing}/${checkStatus.totalCount}`);
	lines.push('');

	for (const cr of checkStatus.checkRuns) {
		const icon = getStatusIcon(cr.status, cr.conclusion);
		const status = cr.status === 'completed' ? cr.conclusion || 'unknown' : cr.status;
		lines.push(`${icon} ${cr.name} (${status})`);
	}

	lines.push('');
	lines.push(`All checks passing: ${checkStatus.allPassing}`);

	return lines.join('\n');
}

function getStatusIcon(status: string, conclusion: string | null): string {
	if (status !== 'completed') {
		return status === 'in_progress' ? '⏳' : '⏸';
	}
	switch (conclusion) {
		case 'success':
		case 'skipped':
		case 'neutral':
			return '✓';
		case 'failure':
		case 'timed_out':
			return '✗';
		case 'cancelled':
			return '⊘';
		default:
			return '?';
	}
}

export async function getPRChecks(owner: string, repo: string, prNumber: number): Promise<string> {
	try {
		const pr = await githubClient.getPR(owner, repo, prNumber);
		const checkStatus = await githubClient.getCheckSuiteStatus(owner, repo, pr.headSha);
		return formatCheckStatus(prNumber, checkStatus);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error fetching PR check status: ${message}`;
	}
}
