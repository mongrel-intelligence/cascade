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

/**
 * Format an operator/agent-facing message for the case where CI check status
 * could NOT be fetched (MNG-1750). This is deliberately distinct from
 * {@link formatCheckStatus}'s `No CI checks configured` string: the agent must
 * be able to tell "CASCADE tried to read CI status and failed" apart from
 * "there is nothing to check".
 *
 * Takes a plain `errorMessage` string (never a raw Octokit `RequestError`
 * object) — callers pass only `error.message` to avoid leaking the
 * `Authorization` header carried on the request object.
 */
export function formatCheckStatusUnavailable(prNumber: number, errorMessage: string): string {
	return [
		`PR #${prNumber}: CI check status UNAVAILABLE (could not be fetched)`,
		'',
		`Upstream error: ${errorMessage}`,
		'',
		'Probable cause: the reviewer credential is a fine-grained PAT lacking the',
		'"Actions: Read" repository permission (GitHub returns 403 "Resource not',
		'accessible by personal access token" for the Actions API).',
		'',
		'IMPORTANT: This is NOT the same as "No CI checks configured" — CASCADE',
		'attempted to read CI status and failed. Do NOT assume checks are green or',
		'red. You may retry with the GetPRChecks gadget later, or explicitly note in',
		'your review that CI status could not be verified.',
	].join('\n');
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
