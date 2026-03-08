import { githubClient } from '../../../github/client.js';

/**
 * Fetch failed CI run logs for a given ref (head SHA).
 * Returns formatted output with failed job details and log excerpts.
 */
export async function getCIRunLogs(owner: string, repo: string, ref: string): Promise<string> {
	try {
		const { runs, failedJobs } = await githubClient.getFailedWorkflowRunJobs(owner, repo, ref);

		if (runs.length === 0) {
			return `No failed workflow runs found for ref ${ref}.`;
		}

		const sections: string[] = [];
		sections.push(`Found ${runs.length} failed workflow run(s) for ref ${ref.slice(0, 7)}:`);
		sections.push('');

		// Show failed job details with step info
		for (const job of failedJobs) {
			sections.push(`## ${job.runName} > ${job.jobName} (${job.conclusion})`);

			const failedSteps = job.steps.filter(
				(s) => s.conclusion === 'failure' || s.conclusion === 'timed_out',
			);
			if (failedSteps.length > 0) {
				sections.push('Failed steps:');
				for (const step of failedSteps) {
					sections.push(`  ✗ ${step.name} (${step.conclusion})`);
				}
			}
			sections.push('');
		}

		sections.push(
			'Tip: Use Tmux to run specific test/build commands locally for detailed error output.',
		);

		return sections.join('\n');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error fetching CI run logs: ${message}`;
	}
}
