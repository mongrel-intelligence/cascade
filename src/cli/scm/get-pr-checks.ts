import { getPRChecks } from '../../gadgets/github/core/getPRChecks.js';
import { getPRChecksDef } from '../../gadgets/github/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';
import { gitlabClient } from '../../gitlab/client.js';
import { detectSCMProvider, resolveProjectPath } from '../base.js';

export default createCLICommand(getPRChecksDef, async (params) => {
	if (detectSCMProvider() === 'gitlab') {
		const projectPath = resolveProjectPath();
		const mrIid = params.prNumber as number;
		try {
			const mr = await gitlabClient.getMR(projectPath, mrIid);
			// Look up latest pipelines for the MR's source branch
			const pipelines = await gitlabClient.listPipelines(projectPath, mr.sourceBranch);
			const lines = [
				`MR !${mr.iid}: ${mr.title}`,
				`Source branch: ${mr.sourceBranch}`,
				`Head SHA: ${mr.sha.slice(0, 7)}`,
				`Has conflicts: ${mr.hasConflicts}`,
				'',
			];
			if (pipelines.length > 0) {
				lines.push('Recent pipelines:');
				for (const p of pipelines) {
					const statusIcon = p.status === 'success' ? '✅' : p.status === 'failed' ? '❌' : '⏳';
					lines.push(
						`  ${statusIcon} Pipeline #${p.id}: ${p.status} (${p.sha.slice(0, 7)}) ${p.webUrl}`,
					);
				}
				const latest = pipelines[0];
				if (latest.status === 'failed') {
					lines.push('');
					lines.push(`Use GetCIRunLogs with ref "${mr.sourceBranch}" to see failure details.`);
				}
			} else {
				lines.push('No pipelines found for this branch.');
			}
			return lines.join('\n');
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return `Error fetching MR pipeline status: ${message}`;
		}
	}
	return getPRChecks(params.owner as string, params.repo as string, params.prNumber as number);
});
