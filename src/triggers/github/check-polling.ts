/**
 * GitHub CI check polling.
 *
 * Polls until all CI checks pass before allowing an agent to start.
 * Used when a trigger sets `waitForChecks: true`.
 */

import { withGitHubToken } from '../../github/client.js';
import { logger } from '../../utils/index.js';
import { parseRepoFullName } from '../../utils/repo.js';
import type { TriggerResult } from '../types.js';

/**
 * Poll until all CI checks pass before starting the agent.
 * Returns false if checks don't pass after polling (agent should be skipped).
 */
export async function pollWaitForChecks(
	result: TriggerResult,
	repoFullName: string,
	githubToken: string,
): Promise<boolean> {
	const { waitForChecks } = await import('./check-suite-success.js');
	const { owner, repo } = parseRepoFullName(repoFullName);
	const headSha = result.agentInput.headSha as string;
	const prNumber = result.prNumber ?? 0;

	logger.info('Waiting for all checks to pass before starting agent', { prNumber, headSha });

	const checkStatus = await withGitHubToken(githubToken, () =>
		waitForChecks(owner, repo, headSha, prNumber),
	);

	if (!checkStatus.allPassing) {
		logger.info('Not all checks passing after polling, skipping agent', {
			prNumber,
			headSha,
			failedChecks: checkStatus.checkRuns
				.filter((c) => c.conclusion !== 'success')
				.map((c) => c.name),
		});
		return false;
	}

	logger.info('All checks passing, proceeding with agent', { prNumber });
	return true;
}
