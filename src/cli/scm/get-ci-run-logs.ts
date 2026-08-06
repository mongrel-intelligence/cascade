import { getCIRunLogs } from '../../gadgets/github/core/getCIRunLogs.js';
import { getCIRunLogsDef } from '../../gadgets/github/definitions.js';
import { getFailedPipelineJobs } from '../../gadgets/gitlab/core/getFailedPipelineJobs.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';
import { gitlabClient } from '../../gitlab/client.js';
import { detectSCMProvider, resolveProjectPath } from '../base.js';

export default createCLICommand(getCIRunLogsDef, async (params) => {
	if (detectSCMProvider() === 'gitlab') {
		const projectPath = resolveProjectPath();
		const ref = params.ref as string;
		try {
			// Try as a numeric pipeline ID first
			const pipelineId = Number(ref);
			if (Number.isFinite(pipelineId) && pipelineId > 0) {
				return getFailedPipelineJobs(projectPath, pipelineId);
			}

			// For SHA or branch ref, look up the latest pipeline automatically
			const pipelines = await gitlabClient.listPipelines(projectPath, ref);
			if (pipelines.length === 0) {
				return `No pipelines found for ref "${ref}" in ${projectPath}`;
			}
			// Use the most recent pipeline
			const latestPipeline = pipelines[0];
			return getFailedPipelineJobs(projectPath, latestPipeline.id);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return `Error fetching CI run logs: ${message}`;
		}
	}
	return getCIRunLogs(params.owner as string, params.repo as string, params.ref as string);
});
