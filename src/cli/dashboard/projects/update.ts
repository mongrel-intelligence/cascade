import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class ProjectsUpdate extends DashboardCommand {
	static override description = 'Update a project.';

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		name: Flags.string({ description: 'Project name' }),
		repo: Flags.string({ description: 'GitHub repo (owner/name)' }),
		'base-branch': Flags.string({ description: 'Base branch' }),
		'branch-prefix': Flags.string({ description: 'Branch prefix' }),
		model: Flags.string({ description: 'Default model' }),
		'max-iterations': Flags.integer({ description: 'Max iterations per agent run' }),
		'watchdog-timeout': Flags.integer({ description: 'Watchdog timeout (ms)' }),
		'work-item-budget': Flags.string({ description: 'Per-work-item budget in USD' }),
		'agent-engine': Flags.string({ description: 'Agent engine' }),
		'progress-model': Flags.string({ description: 'Model for progress updates' }),
		'progress-interval': Flags.string({ description: 'Progress update interval (minutes)' }),
		'run-links-enabled': Flags.boolean({
			description: 'Enable run links in agent comments (requires CASCADE_DASHBOARD_URL env var)',
			allowNo: true,
		}),
		'max-in-flight-items': Flags.integer({
			description: 'Max in-flight items (pipeline throughput)',
		}),
		'snapshot-enabled': Flags.boolean({
			description: 'Enable container snapshots for this project',
			allowNo: true,
		}),
		'snapshot-ttl': Flags.integer({
			description: 'Container snapshot TTL (ms)',
		}),
		'setup-timeout-ms': Flags.integer({
			description:
				'Wall timeout (ms) for .cascade/setup.sh; 0 disables (rely on global worker timeout)',
		}),
		'worker-image': Flags.string({
			description: 'Per-project worker image reference (superadmin only; validated router-side)',
			exclusive: ['clear-worker-image'],
		}),
		'clear-worker-image': Flags.boolean({
			description: 'Clear the per-project worker image (revert to the global default)',
			exclusive: ['worker-image'],
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsUpdate);

		// `--worker-image <ref>` sets it; `--clear-worker-image` sends an explicit
		// null (revert to the global default). Absent → omitted (left untouched).
		const workerImage = flags['clear-worker-image'] ? null : flags['worker-image'];

		try {
			await this.withSpinner('Updating project...', () =>
				this.client.projects.update.mutate({
					id: args.id,
					name: flags.name,
					repo: flags.repo,
					baseBranch: flags['base-branch'],
					branchPrefix: flags['branch-prefix'],
					model: flags.model,
					maxIterations: flags['max-iterations'],
					watchdogTimeoutMs: flags['watchdog-timeout'],
					workItemBudgetUsd: flags['work-item-budget'],
					agentEngine: flags['agent-engine'],
					progressModel: flags['progress-model'],
					progressIntervalMinutes: flags['progress-interval'],
					...(flags['run-links-enabled'] !== undefined
						? { runLinksEnabled: flags['run-links-enabled'] }
						: {}),
					...(flags['max-in-flight-items'] !== undefined
						? { maxInFlightItems: flags['max-in-flight-items'] }
						: {}),
					...(flags['snapshot-enabled'] !== undefined
						? { snapshotEnabled: flags['snapshot-enabled'] }
						: {}),
					...(flags['snapshot-ttl'] !== undefined ? { snapshotTtlMs: flags['snapshot-ttl'] } : {}),
					...(flags['setup-timeout-ms'] !== undefined
						? { setupTimeoutMs: flags['setup-timeout-ms'] }
						: {}),
					...(workerImage !== undefined ? { workerImage } : {}),
				}),
			);

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.success(`Updated project '${args.id}'`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
