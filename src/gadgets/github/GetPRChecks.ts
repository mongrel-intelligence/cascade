import { Gadget, z } from 'llmist';
import { type CheckSuiteStatus, githubClient } from '../../github/client.js';
import { formatGadgetError } from '../utils.js';

/**
 * Format check status into a human-readable string.
 * Exported for use in synthetic gadget calls.
 */
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

export class GetPRChecks extends Gadget({
	name: 'GetPRChecks',
	description:
		'Get the CI check status for a GitHub pull request. Shows all workflow runs and their status/conclusion.',
	timeoutMs: 30000,
	schema: z.object({
		owner: z.string().describe('The repository owner (username or organization)'),
		repo: z.string().describe('The repository name'),
		prNumber: z.number().describe('The pull request number'),
	}),
	examples: [
		{
			params: {
				owner: 'acme',
				repo: 'myapp',
				prNumber: 42,
			},
			comment: 'Get CI check status for PR #42',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		try {
			// Get PR to find head SHA
			const pr = await githubClient.getPR(params.owner, params.repo, params.prNumber);
			const checkStatus = await githubClient.getCheckSuiteStatus(
				params.owner,
				params.repo,
				pr.headSha,
			);
			return formatCheckStatus(params.prNumber, checkStatus);
		} catch (error) {
			return formatGadgetError('fetching PR check status', error);
		}
	}
}
