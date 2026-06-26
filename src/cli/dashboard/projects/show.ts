import { Args } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

/**
 * Render the per-project worker image and its validation lifecycle (spec 022).
 * Unset → the global default; otherwise the operator ref plus its status
 * (`pending` validation, `verified` with the pinned digest, or `failed` with the
 * precise reason).
 */
function formatWorkerImage(project: Record<string, unknown>): string {
	const ref = project.workerImage;
	if (typeof ref !== 'string' || ref.length === 0) {
		return '(global default)';
	}
	const status =
		typeof project.workerImageStatus === 'string' ? project.workerImageStatus : 'pending';
	if (status === 'verified') {
		const digest =
			typeof project.workerImageDigest === 'string' ? project.workerImageDigest : 'unknown digest';
		return `${ref} (verified → ${digest})`;
	}
	if (status === 'failed') {
		const reason =
			typeof project.workerImageError === 'string' && project.workerImageError.length > 0
				? project.workerImageError
				: 'no reason recorded';
		return `${ref} (failed: ${reason})`;
	}
	return `${ref} (pending validation)`;
}

export default class ProjectsShow extends DashboardCommand {
	static override description = 'Show project details.';

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsShow);

		try {
			const [project, enginesInUse] = await Promise.all([
				this.client.projects.getById.query({ id: args.id }),
				this.client.agentConfigs.enginesInUse.query({ projectId: args.id }).catch(() => []),
			]);

			if (flags.json) {
				this.outputJson({ ...project, enginesInUse });
				return;
			}

			const projectRecord = project as unknown as Record<string, unknown>;
			const projectWithEngines = {
				...projectRecord,
				enginesInUse: enginesInUse.length > 0 ? enginesInUse.join(', ') : null,
				workerImageDisplay: formatWorkerImage(projectRecord),
			};

			this.outputDetail(projectWithEngines, {
				id: { label: 'ID' },
				name: { label: 'Name' },
				repo: { label: 'Repo' },
				baseBranch: { label: 'Base Branch' },
				branchPrefix: { label: 'Branch Prefix' },
				model: { label: 'Model' },
				workItemBudgetUsd: { label: 'Work Item Budget' },
				agentEngine: { label: 'Engine' },
				maxInFlightItems: { label: 'Max In-Flight Items' },
				enginesInUse: { label: 'Agent Engines In Use' },
				workerImageDisplay: { label: 'Worker Image' },
			});
		} catch (err) {
			this.handleError(err);
		}
	}
}
