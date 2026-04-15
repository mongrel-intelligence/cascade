import { formatCost, formatRelativeTime } from '@/lib/utils.js';
import { Link } from '@tanstack/react-router';
import { CancelRunButton } from './cancel-run-button.js';
import { LiveDuration } from './live-duration.js';
import { RetryRunButton } from './retry-run-button.js';
import { RunStatusBadge } from './run-status-badge.js';

interface WorkItemRun {
	id: string;
	agentType: string;
	status: string;
	startedAt: string | null;
	durationMs: number | null;
	costUsd: string | null;
	llmIterations: number | null;
	engine: string;
	model: string | null;
}

interface WorkItemRunsTableProps {
	runs: WorkItemRun[] | undefined;
	isLoading: boolean;
	isError: boolean;
	error?: { message: string } | null;
}

export function WorkItemRunsTable({ runs, isLoading, isError, error }: WorkItemRunsTableProps) {
	if (isLoading) {
		return <div className="py-8 text-center text-muted-foreground">Loading runs...</div>;
	}

	if (isError) {
		return (
			<div className="py-8 text-center text-destructive">
				Failed to load runs: {error?.message ?? 'Unknown error'}
			</div>
		);
	}

	if (!runs || runs.length === 0) {
		return <div className="py-8 text-center text-muted-foreground italic">No runs found</div>;
	}

	return (
		<div className="overflow-x-auto rounded-lg border border-border">
			<table className="w-full text-sm">
				<thead>
					<tr className="border-b border-border bg-muted/50">
						<th className="px-4 py-3 text-left font-medium text-muted-foreground">Agent</th>
						<th className="px-4 py-3 text-left font-medium text-muted-foreground">Engine</th>
						<th className="px-4 py-3 text-left font-medium text-muted-foreground">Model</th>
						<th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
						<th className="px-4 py-3 text-left font-medium text-muted-foreground">Started</th>
						<th className="px-4 py-3 text-right font-medium text-muted-foreground">Duration</th>
						<th className="px-4 py-3 text-right font-medium text-muted-foreground">Cost</th>
						<th className="px-4 py-3 text-right font-medium text-muted-foreground">Iters</th>
						<th className="px-4 py-3 text-center font-medium text-muted-foreground">Actions</th>
					</tr>
				</thead>
				<tbody>
					{runs.map((run) => (
						<tr
							key={run.id}
							className="border-b border-border transition-colors hover:bg-muted/30 last:border-0"
						>
							<td className="px-4 py-3">
								<Link
									to="/runs/$runId"
									params={{ runId: run.id }}
									className="font-medium text-primary hover:underline"
								>
									{run.agentType}
								</Link>
							</td>
							<td className="px-4 py-3 text-muted-foreground">{run.engine}</td>
							<td className="px-4 py-3 text-muted-foreground">{run.model ?? '-'}</td>
							<td className="px-4 py-3">
								<RunStatusBadge status={run.status} />
							</td>
							<td className="px-4 py-3 text-muted-foreground">
								{formatRelativeTime(run.startedAt)}
							</td>
							<td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
								<LiveDuration
									startedAt={run.startedAt}
									durationMs={run.durationMs}
									status={run.status}
								/>
							</td>
							<td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
								{formatCost(run.costUsd)}
							</td>
							<td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
								{run.llmIterations ?? '-'}
							</td>
							<td className="px-4 py-3 text-center">
								<CancelRunButton runId={run.id} status={run.status} />
								<RetryRunButton runId={run.id} status={run.status} />
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
