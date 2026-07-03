import { Args } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

/**
 * Render a Dockerfile-sourced project's build lifecycle (spec 023). The launchable
 * `workerImageStatus` and the most-recent build ATTEMPT `workerImageBuildStatus`
 * are surfaced independently: under the no-strand rule a project can be `verified`
 * (still running its last-good image) while its latest rebuild `build failed`.
 */
function formatWorkerDockerfile(project: Record<string, unknown>): string {
	const status =
		typeof project.workerImageStatus === 'string' ? project.workerImageStatus : 'building';
	const buildStatus =
		typeof project.workerImageBuildStatus === 'string' ? project.workerImageBuildStatus : null;
	const digest =
		typeof project.workerImageDigest === 'string' && project.workerImageDigest.length > 0
			? project.workerImageDigest
			: null;
	const error =
		typeof project.workerImageError === 'string' && project.workerImageError.length > 0
			? project.workerImageError
			: null;

	const segments: string[] = ['Dockerfile'];
	if (status === 'verified') {
		segments.push(`verified → ${digest ?? 'unknown image'}`);
	} else if (status === 'failed') {
		segments.push(`failed: ${error ?? 'no reason recorded'}`);
	} else {
		segments.push(status);
	}
	if (buildStatus) segments.push(`build ${buildStatus}`);
	// Surface a recorded error the status branch above did not already show (e.g. a
	// still-verified pin whose most-recent rebuild failed under the no-strand rule).
	if (error && status !== 'failed') segments.push(`error: ${error}`);
	return segments.join(' · ');
}

/**
 * Render the per-project worker image and its lifecycle. A Dockerfile-sourced
 * project (spec 023) renders its build state; otherwise the referenced-image
 * path (spec 022): unset → the global default, else the operator ref plus its
 * status (`pending`, `verified` with the pinned digest, or `failed` with reason).
 */
function formatWorkerImage(project: Record<string, unknown>): string {
	const dockerfile = project.workerDockerfile;
	if (typeof dockerfile === 'string' && dockerfile.length > 0) {
		return formatWorkerDockerfile(project);
	}

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
				setupTimeoutMs: { label: 'Setup Timeout (ms)' },
				enginesInUse: { label: 'Agent Engines In Use' },
				workerImageDisplay: { label: 'Worker Image' },
			});
		} catch (err) {
			this.handleError(err);
		}
	}
}
