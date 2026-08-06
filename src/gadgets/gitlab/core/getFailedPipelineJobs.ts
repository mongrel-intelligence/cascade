import { gitlabClient } from '../../../gitlab/client.js';
import { logger } from '../../../utils/logging.js';

/** Max characters of job log to include per job (tail). */
const MAX_LOG_CHARS = 8000;

/**
 * Fetch failed jobs from a GitLab pipeline, including job logs.
 * Returns formatted output with failed job details and the tail of each log.
 */
export async function getFailedPipelineJobs(
	projectPath: string,
	pipelineId: number,
): Promise<string> {
	try {
		const { pipeline, failedJobs } = await gitlabClient.getFailedPipelineJobs(
			projectPath,
			pipelineId,
		);

		if (failedJobs.length === 0) {
			return `No failed jobs in pipeline #${pipeline.id} (status: ${pipeline.status}).`;
		}

		const sections: string[] = [];
		sections.push(
			`Found ${failedJobs.length} failed job(s) in pipeline #${pipeline.id} (${pipeline.status}):`,
		);

		for (const job of failedJobs) {
			sections.push('');
			sections.push(`## ${job.name} (stage: ${job.stage})`);
			if (job.failureReason) {
				sections.push(`Failure reason: ${job.failureReason}`);
			}
			sections.push(`URL: ${job.webUrl}`);

			// Fetch and include the job log
			try {
				let log = await gitlabClient.getJobLog(projectPath, job.id);
				// Strip ANSI escape codes for readability
				// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes use ESC (0x1b)
				log = log.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
				// Take the tail if too long
				if (log.length > MAX_LOG_CHARS) {
					log = `... (truncated, showing last ${MAX_LOG_CHARS} chars)\n${log.slice(-MAX_LOG_CHARS)}`;
				}
				sections.push('');
				sections.push('```');
				sections.push(log.trim());
				sections.push('```');
			} catch (err) {
				logger.debug('Failed to fetch job log', { jobId: job.id, error: String(err) });
				sections.push('(Job log unavailable)');
			}
		}

		return sections.join('\n');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error fetching failed pipeline jobs: ${message}`;
	}
}
