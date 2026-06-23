import { Link } from '@tanstack/react-router';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table.js';
import { formatCost, formatRelativeTime } from '@/lib/utils.js';
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
		<div className="rounded-lg border border-border">
			<Table>
				<TableHeader>
					<TableRow className="bg-muted/50 hover:bg-muted/50">
						<TableHead className="px-4 py-3">Agent</TableHead>
						<TableHead className="px-4 py-3">Engine</TableHead>
						<TableHead className="px-4 py-3">Model</TableHead>
						<TableHead className="px-4 py-3">Status</TableHead>
						<TableHead className="px-4 py-3">Started</TableHead>
						<TableHead className="px-4 py-3 text-right">Duration</TableHead>
						<TableHead className="px-4 py-3 text-right">Cost</TableHead>
						<TableHead className="px-4 py-3 text-right">Iters</TableHead>
						<TableHead className="px-4 py-3 text-center">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{runs.map((run) => (
						<TableRow key={run.id}>
							<TableCell className="px-4 py-3">
								<Link
									to="/runs/$runId"
									params={{ runId: run.id }}
									className="font-medium text-primary hover:underline"
								>
									{run.agentType}
								</Link>
							</TableCell>
							<TableCell className="px-4 py-3 text-muted-foreground">{run.engine}</TableCell>
							<TableCell className="px-4 py-3 text-muted-foreground">{run.model ?? '-'}</TableCell>
							<TableCell className="px-4 py-3">
								<RunStatusBadge status={run.status} />
							</TableCell>
							<TableCell className="px-4 py-3 text-muted-foreground">
								{formatRelativeTime(run.startedAt)}
							</TableCell>
							<TableCell className="px-4 py-3 text-right tabular-nums text-muted-foreground">
								<LiveDuration
									startedAt={run.startedAt}
									durationMs={run.durationMs}
									status={run.status}
								/>
							</TableCell>
							<TableCell className="px-4 py-3 text-right tabular-nums text-muted-foreground">
								{formatCost(run.costUsd)}
							</TableCell>
							<TableCell className="px-4 py-3 text-right tabular-nums text-muted-foreground">
								{run.llmIterations ?? '-'}
							</TableCell>
							<TableCell className="px-4 py-3 text-center">
								<CancelRunButton runId={run.id} status={run.status} />
								<RetryRunButton runId={run.id} status={run.status} />
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
