import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class RunsDebug extends DashboardCommand {
	static override description = 'Show or trigger debug analysis for an agent run.';

	static override args = {
		id: Args.string({ description: 'Run ID (UUID)', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		analyze: Flags.boolean({
			description: 'Trigger a new debug analysis',
			default: false,
		}),
		wait: Flags.boolean({
			description: 'Wait for analysis to complete (use with --analyze)',
			default: false,
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(RunsDebug);

		try {
			if (flags.analyze) {
				await this.triggerAnalysis(args.id, flags);
				return;
			}

			const analysis = await this.client.runs.getDebugAnalysis.query({ runId: args.id });

			if (flags.json) {
				this.outputJson(analysis);
				return;
			}

			if (!analysis) {
				this.log('No debug analysis found for this run. Use --analyze to trigger one.');
				return;
			}

			console.log(JSON.stringify(analysis, null, 2));
		} catch (err) {
			this.handleError(err);
		}
	}

	private async triggerAnalysis(
		runId: string,
		flags: { json?: boolean; wait?: boolean },
	): Promise<void> {
		const result = await this.client.runs.triggerDebugAnalysis.mutate({ runId });

		if (!flags.wait) {
			if (flags.json) {
				this.outputJson(result);
			} else {
				this.log('Debug analysis triggered.');
			}
			return;
		}

		this.log('Debug analysis triggered. Waiting for completion...');

		const timeoutMs = 5 * 60 * 1000;
		const pollMs = 5000;
		const deadline = Date.now() + timeoutMs;

		while (Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, pollMs));
			const status = await this.client.runs.getDebugAnalysisStatus.query({ runId });

			if (status.status === 'completed') {
				const analysis = await this.client.runs.getDebugAnalysis.query({ runId });
				if (flags.json) {
					this.outputJson(analysis);
				} else {
					this.log('Debug analysis completed.');
					console.log(JSON.stringify(analysis, null, 2));
				}
				return;
			}

			if (status.status === 'idle') {
				// Analysis finished but no result — likely failed
				this.log('Debug analysis finished but no result was stored (analysis may have failed).');
				return;
			}
		}

		this.log('Timed out waiting for debug analysis to complete.');
	}
}
